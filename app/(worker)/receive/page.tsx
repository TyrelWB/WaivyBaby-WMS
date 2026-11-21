'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseBarcode, lookupProductIdByBarcode } from '@/lib/barcode'
import {
  CheckCircle, XCircle, Package, Truck, LogOut, ArrowLeft,
  Camera, Printer, Plus, Minus, X, Scan
} from 'lucide-react'
import CameraScanner from '@/components/CameraScanner'
import WorkerOnboarding from '@/components/WorkerOnboarding'
import { toast } from 'sonner'
import { playSuccess, playError } from '@/lib/feedback'
import JsBarcode from 'jsbarcode'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type ReceivingRecord = { id: string; reference_number: string | null; supplier_name: string | null; status: string }
type ReceivingItem = {
  id: string; product_id: string; quantity_expected: number | null;
  quantity_received: number; status: string; products: { name: string; sku: string }
}
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
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [printCopies, setPrintCopies] = useState<Record<string, number>>({})
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) {
          setWorker(session)
          fetchOpenRecords(session)
          const key = `wms_onboarded_${session.workerId}_${session.role}`
          if (!localStorage.getItem(key)) setShowOnboarding(true)
        } else setLoading(false)
      })
  }, [])

  function dismissOnboarding() {
    if (!worker) return
    localStorage.setItem(`wms_onboarded_${worker.workerId}_${worker.role}`, '1')
    setShowOnboarding(false)
  }

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
    const base = (data as unknown as ReceivingItem[]) || []
    // products can come back null if the item's product_id is orphaned (deleted product, bad data, etc.)
    const loaded = base.map(i => ({ ...i, products: i.products || { name: 'Unknown product', sku: '—' } }))
    setItems(loaded)
    const defaults: Record<string, number> = {}
    for (const item of loaded) defaults[item.id] = item.quantity_expected || 1
    setPrintCopies(defaults)
    setActiveRecord(record)
    setStep('receiving')
    setTimeout(() => scanRef.current?.focus(), 100)
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

    const productId = await lookupProductIdByBarcode(supabase, parsed.raw)

    if (!productId) {
      playError()
      setLastScan({ result: 'error', message: `Unknown barcode: ${parsed.raw}` })
      await logScan(parsed.raw, 'unknown', 'receive', 'error', 'Barcode not found in system')
      return
    }

    const item = items.find(i => i.product_id === productId)
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

    // Update inventory and sync to Wix via API
    await fetch(`/api/products/${item.product_id}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty_change: 1, movement_type: 'receive', note: 'Received via receiving record' }),
    })

    await logScan(parsed.raw, 'product', 'receive', 'success', null)
    playSuccess()
    setLastScan({ result: 'success', message: `${item.products.name} — ${newQty}${expected > 0 ? ` / ${expected}` : ''}` })

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
      org_id: worker.orgId, worker_id: worker.workerId,
      barcode, barcode_type: type, scan_action: action, result, error_message: errorMsg,
    })
  }

  async function handleLogout() {
    await fetch('/api/worker-auth', { method: 'DELETE' })
    window.location.href = '/worker'
  }

  const totalExpected = items.reduce((s, i) => s + (i.quantity_expected || 0), 0)
  const totalReceived = items.reduce((s, i) => s + (receiveProgress[i.id] ?? i.quantity_received), 0)
  const progressPct = totalExpected ? Math.round((totalReceived / totalExpected) * 100) : 0
  const allDone = totalExpected > 0 && totalReceived >= totalExpected

  const printLabels = items.flatMap(item => Array.from({ length: printCopies[item.id] || 0 }, () => item))
  const totalPrintLabels = printLabels.length

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {showOnboarding && worker && (
        <WorkerOnboarding workerId={worker.workerId} role={worker.role as any} onDismiss={dismissOnboarding} />
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #receive-print-area, #receive-print-area * { visibility: visible !important; }
          #receive-print-area { position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
          @page { size: 2.25in 1.25in; margin: 0; }
        }
      `}</style>

      {/* Hidden print area */}
      <div id="receive-print-area" className="hidden print:block">
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {printLabels.map((item, i) => (
            <div key={i} style={{ width: '2.25in', height: '1.25in', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4px 8px', boxSizing: 'border-box', pageBreakAfter: 'always', breakAfter: 'page' }}>
              <PrintBarcode value={item.products.sku} />
              <p style={{ fontSize: '9pt', fontWeight: 'bold', fontFamily: 'monospace', margin: '2px 0 1px', letterSpacing: '0.05em' }}>{item.products.sku}</p>
              <p style={{ fontSize: '7pt', fontFamily: 'sans-serif', margin: 0, textAlign: 'center', lineHeight: 1.2 }}>{item.products.name}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Print modal */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <p className="font-bold text-gray-900">Print Barcode Labels</p>
                <p className="text-xs text-gray-500 mt-0.5">Set label count per item</p>
              </div>
              <button onClick={() => setShowPrintModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {items.map(item => (
                <div key={item.id} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.products.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{item.products.sku}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setPrintCopies(p => ({ ...p, [item.id]: Math.max(0, (p[item.id] || 0) - 1) }))}
                      className="w-7 h-7 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700">
                      <Minus size={12} />
                    </button>
                    <input type="number" min={0} max={999}
                      value={printCopies[item.id] ?? 0}
                      onChange={e => setPrintCopies(p => ({ ...p, [item.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                      className="w-12 text-center border border-gray-200 rounded-lg text-sm font-bold py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button onClick={() => setPrintCopies(p => ({ ...p, [item.id]: (p[item.id] || 0) + 1 }))}
                      className="w-7 h-7 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700">
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500">{totalPrintLabels} label{totalPrintLabels !== 1 ? 's' : ''}</p>
              <div className="flex gap-2">
                <button onClick={() => setShowPrintModal(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">Cancel</button>
                <button
                  onClick={() => { setShowPrintModal(false); setTimeout(() => window.print(), 100) }}
                  disabled={totalPrintLabels === 0}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-5 py-2 rounded-lg text-sm font-semibold"
                >
                  <Printer size={15} /> Print {totalPrintLabels > 0 ? totalPrintLabels : ''} Labels
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {step === 'receiving' ? (
            <button onClick={() => { setStep('select_record'); setActiveRecord(null); setItems([]); setReceiveProgress({}) }}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft size={18} className="text-gray-500" />
            </button>
          ) : (
            <a href="/inventory-control" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft size={18} className="text-gray-500" />
            </a>
          )}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
              <Truck size={18} className="text-green-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900">{worker?.name || 'Worker'}</p>
              <p className="text-xs text-gray-500">Receiving</p>
            </div>
          </div>
          {activeRecord && step === 'receiving' && (
            <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
              <span className="text-sm font-bold text-gray-900">{activeRecord.reference_number || 'No reference'}</span>
              {activeRecord.supplier_name && <span className="text-sm text-gray-500">· {activeRecord.supplier_name}</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-5">
          {step === 'receiving' && totalExpected > 0 && (
            <div className="flex items-center gap-3">
              <div className="w-40 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-sm font-bold text-gray-700 tabular-nums">{totalReceived} / {totalExpected}</span>
              <span className="text-xs text-green-600 font-semibold">{progressPct}%</span>
            </div>
          )}
          <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm transition-colors">
            <LogOut size={15} /> Log out
          </button>
        </div>
      </div>

      {/* Hidden scan input */}
      <input ref={scanRef} value={scanInput} onChange={e => setScanInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
        className="opacity-0 absolute w-0 h-0" autoFocus autoComplete="off"
      />

      {showCamera && (
        <CameraScanner onScan={(barcode) => { setShowCamera(false); handleScan(barcode) }} onClose={() => setShowCamera(false)} />
      )}

      {loading && <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading...</div>}

      {/* Select record */}
      {!loading && step === 'select_record' && (
        <div className="flex-1 p-4 sm:p-8">
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Select Shipment</h1>
              <p className="text-sm text-gray-500 mt-1">Choose the incoming shipment you're receiving today.</p>
            </div>

            {records.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-16 text-center">
                <Truck size={40} className="text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No open shipments</p>
                <p className="text-gray-400 text-sm mt-1">Ask your manager to create a receiving record first.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Reference</th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Supplier</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {records.map(record => (
                      <tr key={record.id} onClick={() => selectRecord(record)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center shrink-0">
                              <Truck size={16} className="text-green-600" />
                            </div>
                            <span className="font-semibold text-gray-900">{record.reference_number || 'No reference'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600">{record.supplier_name || <span className="text-gray-300">—</span>}</td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm text-blue-600 font-medium">Start receiving →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Complete */}
      {!loading && step === 'complete' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center">
            <CheckCircle size={40} className="text-green-600" />
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 mb-2">Receiving Complete!</p>
            <p className="text-gray-500">All items have been checked in and added to inventory.</p>
          </div>
          <button
            onClick={() => { setStep('select_record'); setActiveRecord(null); setItems([]); setReceiveProgress({}) }}
            className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-900 px-6 py-3 rounded-xl font-semibold shadow-sm transition-colors"
          >
            Receive Another Shipment
          </button>
        </div>
      )}

      {/* Receiving */}
      {!loading && step === 'receiving' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

          {/* Left panel: items checklist */}
          <div className="md:w-80 xl:w-96 border-b md:border-b-0 md:border-r border-gray-200 bg-white flex flex-col md:shrink-0 max-h-44 md:max-h-none">
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="font-semibold text-gray-900">{items.length} items on this shipment</p>
              {totalExpected > 0 && (
                <div className="mt-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-gray-500">{totalReceived} of {totalExpected} received</span>
                    <span className="text-xs font-bold text-green-600">{progressPct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {items.map(item => {
                const received = receiveProgress[item.id] ?? item.quantity_received
                const expected = item.quantity_expected || 0
                const done = expected > 0 && received >= expected
                const partial = received > 0 && !done
                return (
                  <div key={item.id} className={`flex items-center gap-3 px-5 py-3.5 ${done ? 'bg-green-50' : ''}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${done ? 'bg-green-100' : 'bg-gray-100'}`}>
                      {done
                        ? <CheckCircle size={15} className="text-green-600" />
                        : <Package size={13} className="text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${done ? 'text-green-800' : 'text-gray-900'}`}>{item.products.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{item.products.sku}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold tabular-nums ${done ? 'text-green-600' : partial ? 'text-blue-600' : 'text-gray-400'}`}>
                        {received}{expected > 0 ? ` / ${expected}` : ''}
                      </p>
                      {done && <p className="text-xs text-green-500">Done</p>}
                      {partial && <p className="text-xs text-blue-500">In progress</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right panel: scan area */}
          <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
            {/* Scan bar */}
            <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 shrink-0">
              <div className="flex gap-2">
                <input
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
                  className="flex-1 border border-gray-200 rounded-lg px-4 py-4 text-lg text-center focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  placeholder="Scan or type SKU..."
                  autoComplete="off"
                />
                <button onClick={() => setShowCamera(true)} className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-4 rounded-lg transition-colors">
                  <Camera size={20} />
                </button>
                <button onClick={() => handleScan(scanInput)} className="bg-green-600 hover:bg-green-700 text-white px-5 py-4 rounded-lg text-lg font-semibold transition-colors">
                  Scan
                </button>
              </div>

              {/* Last scan feedback */}
              {lastScan && (
                <div className={`flex items-center gap-2 mt-3 rounded-lg px-4 py-2.5 ${lastScan.result === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  {lastScan.result === 'success'
                    ? <CheckCircle size={15} className="text-green-600 shrink-0" />
                    : <XCircle size={15} className="text-red-500 shrink-0" />}
                  <p className={`text-sm font-medium ${lastScan.result === 'success' ? 'text-green-800' : 'text-red-700'}`}>
                    {lastScan.message}
                  </p>
                </div>
              )}
            </div>

            {/* Action area */}
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
              <button
                onClick={() => scanRef.current?.focus()}
                className="w-full max-w-md flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-700 py-4 rounded-xl font-semibold border border-gray-200 shadow-sm transition-colors"
              >
                <Scan size={18} className="text-gray-500" /> Click to Focus Scanner
              </button>

              <button
                onClick={() => setShowPrintModal(true)}
                className="w-full max-w-md flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-blue-600 py-4 rounded-xl font-semibold border border-blue-200 shadow-sm transition-colors"
              >
                <Printer size={18} /> Print Barcode Labels
              </button>

              {allDone && (
                <button
                  onClick={async () => {
                    await supabase.from('receiving').update({ status: 'complete', received_date: new Date().toISOString() }).eq('id', activeRecord!.id)
                    setStep('complete')
                  }}
                  className="w-full max-w-md flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-5 rounded-xl font-bold text-lg shadow-sm transition-colors"
                >
                  <CheckCircle size={22} /> Complete Receiving
                </button>
              )}

              {!allDone && totalExpected > 0 && (
                <p className="text-sm text-gray-400 text-center">
                  {totalExpected - totalReceived} items remaining
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PrintBarcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', width: 1.5, height: 40, displayValue: false, margin: 0 })
    } catch {}
  }, [value])
  return <svg ref={ref} style={{ width: '100%', maxHeight: '40px' }} />
}
