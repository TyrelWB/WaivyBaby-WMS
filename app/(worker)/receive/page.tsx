'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseBarcode } from '@/lib/barcode'
import { Scan, CheckCircle, XCircle, Package, Truck, LogOut, ChevronRight, Camera } from 'lucide-react'
import CameraScanner from '@/components/CameraScanner'
import { toast } from 'sonner'
import { playSuccess, playError } from '@/lib/feedback'
import { writeAudit } from '@/lib/audit'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type ReceivingRecord = { id: string; reference_number: string | null; supplier_name: string | null; status: string }
type ReceivingItem = { id: string; product_id: string; quantity_expected: number | null; quantity_received: number; status: string; products: { name: string; sku: string } }

type ReceiveStep = 'select_record' | 'receiving' | 'complete'

export default function ReceivePage() {
  const supabase = createClient()
  const scanRef = useRef<HTMLInputElement>(null)
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [records, setRecords] = useState<ReceivingRecord[]>([])
  const [activeRecord, setActiveRecord] = useState<ReceivingRecord | null>(null)
  const [items, setItems] = useState<ReceivingItem[]>([])
  const [step, setStep] = useState<ReceiveStep>('select_record')
  const [scanInput, setScanInput] = useState('')
  const [lastScan, setLastScan] = useState<{ result: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCamera, setShowCamera] = useState(false)
  const [receiveProgress, setReceiveProgress] = useState<Record<string, number>>({})

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) {
          setWorker(session)
          fetchOpenRecords(session)
        } else {
          setLoading(false)
        }
      })
    scanRef.current?.focus()
  }, [])

  async function fetchOpenRecords(session: WorkerSession) {
    const { data } = await supabase
      .from('receiving')
      .select('id, reference_number, supplier_name, status')
      .eq('org_id', session.orgId)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
    setRecords(data || [])
    setLoading(false)
  }

  async function selectRecord(record: ReceivingRecord) {
    const { data } = await supabase
      .from('receiving_items')
      .select('id, product_id, quantity_expected, quantity_received, status, products(name, sku)')
      .eq('receiving_id', record.id)
    setItems(data as unknown as ReceivingItem[] || [])
    setActiveRecord(record)
    setStep('receiving')
    scanRef.current?.focus()
  }

  async function handleScan(raw: string) {
    if (!raw.trim() || step !== 'receiving') return
    const parsed = parseBarcode(raw.trim())
    setScanInput('')
    scanRef.current?.focus()
    await handleItemScan(parsed)
  }

  async function handleItemScan(parsed: ReturnType<typeof parseBarcode>) {
    if (!worker || !activeRecord) return

    const { data: productBarcode } = await supabase
      .from('product_barcodes')
      .select('product_id')
      .eq('barcode', parsed.raw)
      .single()

    if (!productBarcode) {
      playError()
      setLastScan({ result: 'error', message: `Unknown barcode: ${parsed.raw}` })
      await logScan(parsed.raw, 'unknown', 'receive', 'error', 'Barcode not found in system')
      return
    }

    const item = items.find(i => i.product_id === productBarcode.product_id)
    if (!item) {
      playError()
      setLastScan({ result: 'error', message: 'This item is not on this receiving record.' })
      await logScan(parsed.raw, 'product', 'receive', 'error', 'Item not on receiving record')
      return
    }

    const already = receiveProgress[item.id] ?? item.quantity_received
    const newQty = already + 1
    const expected = item.quantity_expected || 0
    const done = expected > 0 && newQty >= expected

    const newProgress = { ...receiveProgress, [item.id]: newQty }
    setReceiveProgress(newProgress)

    await supabase.from('receiving_items').update({
      quantity_received: newQty,
      status: done ? 'received' : newQty > 0 ? 'partial' : 'pending',
    }).eq('id', item.id)

    // Update inventory
    const { data: inv } = await supabase.from('inventory').select('id, qty_on_hand, qty_available').eq('product_id', item.product_id).eq('org_id', worker.orgId).single()
    if (inv) {
      await supabase.from('inventory').update({
        qty_on_hand: inv.qty_on_hand + 1,
        qty_available: inv.qty_available + 1,
      }).eq('id', inv.id)
      await writeAudit(supabase, {
        orgId: worker.orgId,
        workerId: worker.workerId,
        action: 'inventory_adjusted',
        entityType: 'inventory',
        entityId: inv.id,
        changes: { product: item.products.name, qty_on_hand: inv.qty_on_hand + 1, qty_available: inv.qty_available + 1 },
        note: `Received via receiving record`,
      })
    }

    await logScan(parsed.raw, 'product', 'receive', 'success', null)
    playSuccess()
    setLastScan({ result: 'success', message: `✓ ${item.products.name} (${newQty}${expected > 0 ? `/${expected}` : ''})` })

    // Check if all received
    const allDone = items.every(i => {
      const q = i.id === item.id ? newQty : (newProgress[i.id] ?? i.quantity_received)
      return !i.quantity_expected || q >= i.quantity_expected
    })
    if (allDone) {
      await supabase.from('receiving').update({ status: 'complete', received_date: new Date().toISOString() }).eq('id', activeRecord.id)
      setStep('complete')
    }
  }

  async function logScan(barcode: string, type: string, action: string, result: string, errorMsg: string | null) {
    if (!worker || !activeRecord) return
    await supabase.from('scan_events').insert({
      org_id: worker.orgId,
      worker_id: worker.workerId,
      barcode,
      barcode_type: type,
      scan_action: action,
      result,
      error_message: errorMsg,
    })
  }

  async function handleLogout() {
    await fetch('/api/worker-auth', { method: 'DELETE' })
    window.location.href = '/worker'
  }

  const totalExpected = items.reduce((s, i) => s + (i.quantity_expected || 0), 0)
  const totalReceived = items.reduce((s, i) => s + (receiveProgress[i.id] ?? i.quantity_received), 0)

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <div>
          <p className="font-bold text-white">{worker?.name || 'Worker'}</p>
          <p className="text-xs text-gray-500">Receiver</p>
        </div>
        <button onClick={handleLogout} className="p-2 text-gray-600 hover:text-gray-400">
          <LogOut size={18} />
        </button>
      </div>

      <input
        ref={scanRef}
        value={scanInput}
        onChange={e => setScanInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
        className="opacity-0 absolute w-0 h-0"
        autoFocus
        autoComplete="off"
      />
      <div className="px-4 pt-3 max-w-lg mx-auto w-full">
        <div className="flex gap-2">
          <input
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Barcode..."
            autoComplete="off"
          />
          <button
            onClick={() => setShowCamera(true)}
            className="bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white px-4 py-3 rounded-xl touch-manipulation"
            title="Use camera"
          >
            <Camera size={20} />
          </button>
          <button
            onClick={() => handleScan(scanInput)}
            className="bg-green-600 hover:bg-green-500 active:bg-green-700 text-white px-5 py-3 rounded-xl text-sm font-semibold touch-manipulation"
          >
            Scan
          </button>
        </div>
      </div>

      {showCamera && (
        <CameraScanner
          onScan={(barcode) => { setShowCamera(false); handleScan(barcode) }}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div className="flex-1 flex flex-col px-4 py-6 max-w-lg mx-auto w-full">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">Loading...</div>
        ) : step === 'select_record' ? (
          <>
            <p className="text-xl font-bold text-white mb-1">Select Shipment</p>
            <p className="text-gray-500 text-sm mb-6">Choose the shipment you're receiving.</p>
            {records.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                <Truck size={48} className="text-gray-600" />
                <p className="text-gray-400">No open shipments. Ask your manager to create a receiving record first.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {records.map(record => (
                  <button key={record.id} onClick={() => selectRecord(record)} className="w-full flex items-center gap-4 bg-gray-900 border border-gray-800 hover:border-green-700 active:bg-gray-800 rounded-xl p-5 transition-colors text-left touch-manipulation">
                    <div className="w-12 h-12 bg-green-900 rounded-lg flex items-center justify-center shrink-0">
                      <Truck size={20} className="text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white text-base">{record.reference_number || 'No reference'}</p>
                      {record.supplier_name && <p className="text-sm text-gray-400 mt-0.5">{record.supplier_name}</p>}
                    </div>
                    <ChevronRight size={20} className="text-gray-600" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : step === 'complete' ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
            <div className="w-20 h-20 bg-green-900 rounded-2xl flex items-center justify-center">
              <CheckCircle size={40} className="text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white mb-2">Receiving Complete!</p>
              <p className="text-gray-400">All items have been checked in and added to inventory.</p>
            </div>
            <button onClick={() => { setStep('select_record'); setActiveRecord(null); setItems([]); setReceiveProgress({}) }} className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-xl font-semibold">
              Receive Another
            </button>
          </div>
        ) : (
          <>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">{activeRecord?.reference_number || 'Receiving'}</p>
                  <p className="text-xs text-gray-400">{activeRecord?.supplier_name || 'No supplier'}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-400">{totalReceived}{totalExpected > 0 ? `/${totalExpected}` : ''}</p>
                  <p className="text-xs text-gray-500">items received</p>
                </div>
              </div>
              {totalExpected > 0 && (
                <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(totalReceived / totalExpected) * 100}%` }} />
                </div>
              )}
            </div>

            {lastScan && (
              <div className={`flex items-center gap-3 rounded-xl p-4 mb-4 ${lastScan.result === 'success' ? 'bg-green-950 border border-green-800' : 'bg-red-950 border border-red-800'}`}>
                {lastScan.result === 'success' ? <CheckCircle size={20} className="text-green-400 shrink-0" /> : <XCircle size={20} className="text-red-400 shrink-0" />}
                <p className={`text-sm font-medium ${lastScan.result === 'success' ? 'text-green-300' : 'text-red-300'}`}>{lastScan.message}</p>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Items</p>
              {items.map(item => {
                const received = receiveProgress[item.id] ?? item.quantity_received
                const expected = item.quantity_expected || 0
                const done = expected > 0 && received >= expected
                return (
                  <div key={item.id} className={`bg-gray-900 border rounded-xl p-4 flex items-center gap-4 ${done ? 'border-green-800 opacity-60' : received > 0 ? 'border-green-900' : 'border-gray-800'}`}>
                    <div className="w-14 h-14 bg-gray-800 rounded-lg flex items-center justify-center shrink-0">
                      <Package size={22} className="text-gray-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white text-base leading-tight">{item.products.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">SKU: {item.products.sku}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-2xl font-bold tabular-nums ${done ? 'text-green-400' : 'text-white'}`}>
                        {received}{expected > 0 ? `/${expected}` : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            <button onClick={() => scanRef.current?.focus()} className="mt-6 w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white py-5 rounded-xl font-bold text-xl transition-colors touch-manipulation mb-4">
              <Scan size={24} /> Tap to Scan Item
            </button>
          </>
        )}
      </div>
    </div>
  )
}
