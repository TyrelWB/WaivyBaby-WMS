'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseBarcode } from '@/lib/barcode'
import { playSuccess, playError } from '@/lib/feedback'
import { writeAudit } from '@/lib/audit'
import { Scan, CheckCircle, XCircle, Package, ShoppingBasket, LogOut, Box, ChevronRight, Camera, AlertTriangle } from 'lucide-react'
import CameraScanner from '@/components/CameraScanner'
import { toast } from 'sonner'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type Order = { id: string; order_number: string; customer_name: string | null; is_rush: boolean; is_bulk: boolean; notes: string | null; total_boxes: number | null; basket_id: string | null }
type OrderItem = { id: string; product_id: string; quantity_ordered: number; quantity_picked: number; status: string; products: { name: string; sku: string; image_url: string | null } }

type PackStep = 'scan_basket' | 'packing' | 'complete'

export default function PackPage() {
  const supabase = createClient()
  const scanRef = useRef<HTMLInputElement>(null)
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [step, setStep] = useState<PackStep>('scan_basket')
  const [scanInput, setScanInput] = useState('')
  const [lastScan, setLastScan] = useState<{ result: 'success' | 'error' | 'warning'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCamera, setShowCamera] = useState(false)
  const [currentBox, setCurrentBox] = useState(1)
  const [boxIds, setBoxIds] = useState<string[]>([])
  const [packProgress, setPackProgress] = useState<Record<string, number>>({})
  const [hardError, setHardError] = useState<{ message: string } | null>(null)

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) {
          setWorker(session)
          fetchAssignedOrder(session)
        } else {
          setLoading(false)
        }
      })
    scanRef.current?.focus()
  }, [])

  async function fetchAssignedOrder(session: WorkerSession) {
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, is_rush, is_bulk, notes, total_boxes, basket_id')
      .eq('assigned_packer_id', session.workerId)
      .in('status', ['picked', 'packing'])
      .order('is_rush', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (data) {
      setOrder(data)
      await fetchItems(data.id)
      if (data.basket_id) setStep('packing')
    }
    setLoading(false)
  }

  async function fetchItems(orderId: string) {
    const { data } = await supabase
      .from('order_items')
      .select('id, product_id, quantity_ordered, quantity_picked, status, products(name, sku, image_url)')
      .eq('order_id', orderId)
    setItems(data as unknown as OrderItem[] || [])
  }

  async function handleScan(raw: string) {
    if (!raw.trim()) return
    const parsed = parseBarcode(raw.trim())
    setScanInput('')
    scanRef.current?.focus()

    if (step === 'scan_basket') {
      await handleBasketScan(parsed.raw)
      return
    }

    if (step === 'packing') {
      await handleItemScan(parsed)
    }
  }

  async function handleBasketScan(barcode: string) {
    const { data: basket } = await supabase
      .from('baskets')
      .select('id, status, name, current_order_id')
      .eq('barcode', barcode)
      .single()

    if (!basket) {
      playError()
      setLastScan({ result: 'error', message: 'Basket not found. Check the barcode.' })
      return
    }

    if (!order || !worker) return

    if (basket.status === 'in_use' && basket.current_order_id !== order.id) {
      playError()
      setLastScan({ result: 'error', message: `Basket "${basket.name}" is already in use for a different order.` })
      return
    }

    const { data: boxData } = await supabase.from('boxes').insert({
      org_id: worker.orgId,
      order_id: order.id,
      box_number: 1,
      status: 'open',
    }).select('id').single()

    if (boxData) setBoxIds([boxData.id])

    await supabase.from('orders').update({
      status: 'packing',
      basket_id: basket.id,
    }).eq('id', order.id)

    await supabase.from('baskets').update({
      status: 'in_use',
      current_order_id: order.id,
      current_worker_id: worker.workerId,
    }).eq('id', basket.id)

    playSuccess()
    setLastScan({ result: 'success', message: `Basket ready — Box 1 of ${order.total_boxes || '?'} open. Start scanning items.` })
    setStep('packing')
  }

  async function handleItemScan(parsed: ReturnType<typeof parseBarcode>) {
    if (!order || !worker) return

    const { data: productBarcode } = await supabase
      .from('product_barcodes')
      .select('product_id')
      .eq('barcode', parsed.raw)
      .single()

    if (!productBarcode) {
      playError()
      setHardError({ message: `Barcode not recognized: ${parsed.raw}` })
      await supabase.from('exceptions').insert({
        org_id: worker.orgId,
        order_id: order.id,
        worker_id: worker.workerId,
        type: 'unknown_barcode',
        severity: 'hard',
        description: `Unknown barcode scanned during packing: ${parsed.raw}`,
        status: 'open',
      })
      await logScan(parsed.raw, 'unknown', 'pack', 'error', 'Barcode not found in system')
      return
    }

    const item = items.find(i => i.product_id === productBarcode.product_id && (packProgress[i.id] || 0) < i.quantity_ordered)
    if (!item) {
      playError()
      const anyItem = items.find(i => i.product_id === productBarcode.product_id)
      if (anyItem) {
        setLastScan({ result: 'warning', message: `${anyItem.products.name} is already fully packed.` })
      } else {
        setHardError({ message: 'This item is not on this order.' })
        await supabase.from('exceptions').insert({
          org_id: worker.orgId,
          order_id: order.id,
          worker_id: worker.workerId,
          type: 'wrong_item',
          severity: 'hard',
          description: `Wrong item scanned during packing: barcode ${parsed.raw} is not on this order`,
          status: 'open',
        })
        await logScan(parsed.raw, 'product', 'pack', 'error', 'Item not on order')
      }
      return
    }

    const already = packProgress[item.id] || 0
    const newQty = already + 1
    const newProgress = { ...packProgress, [item.id]: newQty }
    setPackProgress(newProgress)

    const activeBoxId = boxIds[currentBox - 1]
    if (activeBoxId) {
      await supabase.from('box_items').insert({
        box_id: activeBoxId,
        order_item_id: item.id,
        quantity: 1,
      })
    }

    await logScan(parsed.raw, 'product', 'pack', 'success', null)
    playSuccess()
    setLastScan({ result: 'success', message: `✓ ${item.products.name} (${newQty}/${item.quantity_ordered})` })

    const allPacked = items.every(i => (newProgress[i.id] || 0) >= i.quantity_ordered)
    if (allPacked) {
      await completePacking()
    }
  }

  async function closeCurrentBox() {
    if (!order || !worker) return
    const activeBoxId = boxIds[currentBox - 1]
    if (activeBoxId) {
      await supabase.from('boxes').update({ status: 'closed' }).eq('id', activeBoxId)
    }

    const nextBox = currentBox + 1
    const { data: newBox } = await supabase.from('boxes').insert({
      org_id: worker.orgId,
      order_id: order.id,
      box_number: nextBox,
      status: 'open',
    }).select('id').single()

    if (newBox) {
      setBoxIds(prev => [...prev, newBox.id])
    }
    setCurrentBox(nextBox)
    toast.success(`Box ${currentBox} closed. Box ${nextBox} opened.`)
    scanRef.current?.focus()
  }

  async function completePacking() {
    if (!order || !worker) return

    const activeBoxId = boxIds[currentBox - 1]
    if (activeBoxId) {
      await supabase.from('boxes').update({ status: 'closed' }).eq('id', activeBoxId)
    }

    if (order.basket_id) {
      await supabase.from('baskets').update({
        status: 'available',
        current_order_id: null,
        current_worker_id: null,
        claimed_at: null,
      }).eq('id', order.basket_id)
    }

    await supabase.from('orders').update({ status: 'packed' }).eq('id', order.id)
    await writeAudit(supabase, {
      orgId: worker.orgId,
      workerId: worker.workerId,
      action: 'order_status_changed',
      entityType: 'order',
      entityId: order.id,
      changes: { status: 'packed', boxes: boxIds.length },
      note: `Packed by ${worker.name}`,
    })

    setStep('complete')
  }

  async function logScan(barcode: string, type: string, action: string, result: string, errorMsg: string | null) {
    if (!worker || !order) return
    await supabase.from('scan_events').insert({
      org_id: worker.orgId,
      worker_id: worker.workerId,
      order_id: order.id,
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

  const totalQty = items.reduce((s, i) => s + i.quantity_ordered, 0)
  const packedQty = items.reduce((s, i) => s + (packProgress[i.id] || 0), 0)
  const totalBoxes = order?.total_boxes || boxIds.length || 1

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {hardError && (
        <div className="fixed inset-0 z-50 bg-red-950 flex flex-col items-center justify-center text-center px-8 gap-6">
          <XCircle size={72} className="text-red-400" />
          <div>
            <p className="text-3xl font-bold text-white">Stop!</p>
            <p className="text-red-300 mt-3 text-lg">{hardError.message}</p>
          </div>
          <button
            onClick={() => { setHardError(null); scanRef.current?.focus() }}
            className="bg-red-700 hover:bg-red-600 active:bg-red-800 text-white px-10 py-5 rounded-2xl font-bold text-xl touch-manipulation"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <div>
          <p className="font-bold text-white">{worker?.name || 'Worker'}</p>
          <p className="text-xs text-gray-500">Packer</p>
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
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
            className="bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white px-5 py-3 rounded-xl text-sm font-semibold touch-manipulation"
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
          <div className="flex-1 flex items-center justify-center text-gray-500">Loading your orders...</div>
        ) : !order ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <CheckCircle size={48} className="text-green-400" />
            <p className="text-xl font-bold text-white">No orders to pack</p>
            <p className="text-gray-500 text-sm">Check with your manager for your next assignment.</p>
          </div>
        ) : step === 'scan_basket' ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
            <div className="w-20 h-20 bg-purple-900 rounded-2xl flex items-center justify-center">
              <ShoppingBasket size={40} className="text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white mb-2">Scan Basket to Pack</p>
              <p className="text-gray-400">Scan the basket barcode for order</p>
              <p className="text-purple-400 font-bold text-xl mt-2">#{order.order_number}</p>
              {order.is_rush && <span className="text-xs bg-red-600 text-white font-bold px-3 py-1 rounded-full mt-2 inline-block">RUSH ORDER</span>}
              {order.total_boxes && (
                <p className="text-xs text-gray-500 mt-2">{order.total_boxes} box{order.total_boxes !== 1 ? 'es' : ''} expected</p>
              )}
            </div>
            {lastScan && (
              <div className={`flex items-center gap-3 rounded-xl p-4 w-full ${lastScan.result === 'warning' ? 'bg-orange-950 border border-orange-800' : lastScan.result === 'success' ? 'bg-green-950 border border-green-800' : 'bg-red-950 border border-red-800'}`}>
                {lastScan.result === 'success' ? <CheckCircle size={20} className="text-green-400 shrink-0" /> : lastScan.result === 'warning' ? <AlertTriangle size={20} className="text-orange-400 shrink-0" /> : <XCircle size={20} className="text-red-400 shrink-0" />}
                <p className={`text-sm font-medium ${lastScan.result === 'success' ? 'text-green-300' : lastScan.result === 'warning' ? 'text-orange-300' : 'text-red-300'}`}>{lastScan.message}</p>
              </div>
            )}
            <button onClick={() => scanRef.current?.focus()} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-xl font-semibold">
              <Scan size={18} /> Tap to Scan
            </button>
          </div>
        ) : step === 'complete' ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
            <div className="w-20 h-20 bg-green-900 rounded-2xl flex items-center justify-center">
              <CheckCircle size={40} className="text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white mb-2">Packing Complete!</p>
              <p className="text-gray-400">Order #{order.order_number} packed in {boxIds.length} box{boxIds.length !== 1 ? 'es' : ''}.</p>
              <p className="text-gray-400 mt-1">Basket has been released. Place boxes in the shipping area.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">Order #{order.order_number}</p>
                  <p className="text-xs text-gray-400">{order.customer_name || 'No name'}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-purple-400">{packedQty}/{totalQty}</p>
                  <p className="text-xs text-gray-500">items packed</p>
                </div>
              </div>
              <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${totalQty ? (packedQty / totalQty) * 100 : 0}%` }} />
              </div>
              {order.notes && <p className="text-xs text-yellow-400 mt-2 bg-yellow-950 rounded px-2 py-1">{order.notes}</p>}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-900 rounded-lg flex items-center justify-center">
                  <Box size={18} className="text-purple-400" />
                </div>
                <div>
                  <p className="font-semibold text-white text-sm">Box {currentBox}</p>
                  <p className="text-xs text-gray-500">of {totalBoxes} expected</p>
                </div>
              </div>
              <button
                onClick={closeCurrentBox}
                className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                Close Box <ChevronRight size={14} />
              </button>
            </div>

            {lastScan && (
              <div className={`flex items-center gap-3 rounded-xl p-4 mb-4 ${lastScan.result === 'warning' ? 'bg-orange-950 border border-orange-800' : lastScan.result === 'success' ? 'bg-green-950 border border-green-800' : 'bg-red-950 border border-red-800'}`}>
                {lastScan.result === 'success' ? <CheckCircle size={20} className="text-green-400 shrink-0" /> : lastScan.result === 'warning' ? <AlertTriangle size={20} className="text-orange-400 shrink-0" /> : <XCircle size={20} className="text-red-400 shrink-0" />}
                <p className={`text-sm font-medium ${lastScan.result === 'success' ? 'text-green-300' : lastScan.result === 'warning' ? 'text-orange-300' : 'text-red-300'}`}>{lastScan.message}</p>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Items to Pack</p>
              {items.map(item => {
                const packed = packProgress[item.id] || 0
                const done = packed >= item.quantity_ordered
                return (
                  <div key={item.id} className={`bg-gray-900 border rounded-xl p-4 flex items-center gap-4 ${done ? 'border-green-800 opacity-60' : packed > 0 ? 'border-purple-800' : 'border-gray-800'}`}>
                    <div className="w-14 h-14 bg-gray-800 rounded-lg flex items-center justify-center shrink-0">
                      {item.products.image_url ? (
                        <img src={item.products.image_url} alt="" className="w-full h-full object-cover rounded-lg" />
                      ) : (
                        <Package size={22} className="text-gray-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white text-base leading-tight">{item.products.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">SKU: {item.products.sku}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-2xl font-bold tabular-nums ${done ? 'text-green-400' : 'text-white'}`}>
                        {packed}/{item.quantity_ordered}
                      </p>
                      {done && <p className="text-xs text-green-500">Done</p>}
                    </div>
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => scanRef.current?.focus()}
              className="mt-6 w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white py-5 rounded-xl font-bold text-xl transition-colors touch-manipulation mb-4"
            >
              <Scan size={24} /> Tap to Scan Item
            </button>

            {packedQty >= totalQty && totalQty > 0 && (
              <button
                onClick={completePacking}
                className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 active:bg-green-800 text-white py-5 rounded-xl font-bold text-xl transition-colors touch-manipulation mb-4"
              >
                <CheckCircle size={24} /> Complete Packing
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
