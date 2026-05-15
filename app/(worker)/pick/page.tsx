'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseBarcode } from '@/lib/barcode'
import { playSuccess, playError } from '@/lib/feedback'
import { writeAudit } from '@/lib/audit'
import { Scan, CheckCircle, XCircle, Package, ShoppingBasket, LogOut, Camera, AlertTriangle } from 'lucide-react'
import CameraScanner from '@/components/CameraScanner'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type Order = { id: string; order_number: string; customer_name: string | null; is_rush: boolean; is_bulk: boolean; notes: string | null; status: string }
type OrderItem = { id: string; product_id: string; quantity_ordered: number; quantity_picked: number; status: string; products: { name: string; sku: string; image_url: string | null } }

type PickStep = 'scan_basket' | 'picking' | 'complete'

export default function PickPage() {
  const supabase = createClient()
  const scanRef = useRef<HTMLInputElement>(null)
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [step, setStep] = useState<PickStep>('scan_basket')
  const [scanInput, setScanInput] = useState('')
  const [lastScan, setLastScan] = useState<{ result: 'success' | 'error' | 'warning'; message: string } | null>(null)
  const [basketBarcode, setBasketBarcode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCamera, setShowCamera] = useState(false)
  const [hardError, setHardError] = useState<{ message: string } | null>(null)
  const [shortPickItem, setShortPickItem] = useState<OrderItem | null>(null)
  const [shortPickQty, setShortPickQty] = useState(0)

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

  // Poll for new orders every 30 seconds when idle (no current order)
  useEffect(() => {
    if (order || !worker) return
    const interval = setInterval(() => fetchAssignedOrder(worker), 30000)
    return () => clearInterval(interval)
  }, [order, worker])

  async function fetchAssignedOrder(session: WorkerSession) {
    let justAssigned = false

    let { data } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, is_rush, is_bulk, notes, status')
      .eq('assigned_picker_id', session.workerId)
      .in('status', ['assigned', 'picking'])
      .order('is_rush', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (!data && session.orgId) {
      const { data: next } = await supabase
        .from('orders')
        .select('id')
        .eq('org_id', session.orgId)
        .eq('status', 'pending')
        .is('assigned_picker_id', null)
        .order('is_rush', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (next) {
        await supabase.from('orders').update({
          assigned_picker_id: session.workerId,
          status: 'assigned',
        }).eq('id', next.id)

        await writeAudit(supabase, {
          orgId: session.orgId,
          workerId: session.workerId,
          action: 'order_assigned',
          entityType: 'order',
          entityId: next.id,
          changes: { assigned_picker_id: session.workerId, status: 'assigned' },
        })

        const { data: assigned } = await supabase
          .from('orders')
          .select('id, order_number, customer_name, is_rush, is_bulk, notes, status')
          .eq('id', next.id)
          .single()
        data = assigned
        justAssigned = true
      }
    }

    if (data) {
      setOrder(data)
      const fetchedItems = await fetchItems(data.id)

      if (justAssigned && fetchedItems.length > 0) {
        await reserveInventory(fetchedItems, session)
      }

      try {
        const { data: saved } = await supabase
          .from('worker_sessions')
          .select('step, basket_barcode')
          .eq('worker_id', session.workerId)
          .eq('order_id', data.id)
          .single()

        if (saved) {
          if (saved.step === 'picking') setStep('picking')
          if (saved.basket_barcode) setBasketBarcode(saved.basket_barcode)
        } else if (data.status === 'picking') {
          setStep('picking')
        }
      } catch {
        if (data.status === 'picking') setStep('picking')
      }
    }
    setLoading(false)
  }

  async function fetchItems(orderId: string): Promise<OrderItem[]> {
    const { data } = await supabase
      .from('order_items')
      .select('id, product_id, quantity_ordered, quantity_picked, status, products(name, sku, image_url)')
      .eq('order_id', orderId)
      .not('status', 'eq', 'picked')
    const result = data as unknown as OrderItem[] || []
    setItems(result)
    return result
  }

  async function reserveInventory(itemList: OrderItem[], session: WorkerSession) {
    for (const item of itemList) {
      const qty = item.quantity_ordered - item.quantity_picked
      if (qty <= 0) continue
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, qty_available, qty_reserved')
        .eq('product_id', item.product_id)
        .eq('org_id', session.orgId)
        .single()
      if (inv) {
        await supabase.from('inventory').update({
          qty_available: Math.max(0, inv.qty_available - qty),
          qty_reserved: inv.qty_reserved + qty,
        }).eq('id', inv.id)
      }
    }
  }

  async function saveSession(data: { step: PickStep; orderId: string; basketBarcode: string | null }) {
    if (!worker) return
    try {
      await supabase.from('worker_sessions').upsert({
        worker_id: worker.workerId,
        org_id: worker.orgId,
        step: data.step,
        order_id: data.orderId,
        basket_barcode: data.basketBarcode,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'worker_id' })
    } catch {}
  }

  async function clearSession() {
    if (!worker) return
    try {
      await supabase.from('worker_sessions').delete().eq('worker_id', worker.workerId)
    } catch {}
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

    if (step === 'picking') {
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

    if (basket.status === 'in_use' && basket.current_order_id !== order?.id) {
      playError()
      setLastScan({ result: 'error', message: `Basket "${basket.name}" is already in use. Pick a different basket.` })
      return
    }

    if (!order || !worker) return

    await supabase.from('baskets').update({
      status: 'in_use',
      current_order_id: order.id,
      current_worker_id: worker.workerId,
      claimed_at: new Date().toISOString(),
    }).eq('id', basket.id)

    await supabase.from('orders').update({ status: 'picking', basket_id: basket.id }).eq('id', order.id)

    setBasketBarcode(barcode)
    await saveSession({ step: 'picking', orderId: order.id, basketBarcode: barcode })

    playSuccess()
    setLastScan({ result: 'success', message: `Basket "${basket.name}" claimed! Start picking.` })
    setStep('picking')
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
        description: `Unknown barcode scanned during picking: ${parsed.raw}`,
        status: 'open',
      })
      await logScan(parsed.raw, 'unknown', 'pick', 'error', 'Barcode not found in system')
      return
    }

    const anyItemForProduct = items.find(i => i.product_id === productBarcode.product_id)
    const item = items.find(i => i.product_id === productBarcode.product_id && i.quantity_picked < i.quantity_ordered)

    if (!item) {
      playError()
      if (anyItemForProduct) {
        setLastScan({ result: 'warning', message: `${anyItemForProduct.products.name} is already fully picked.` })
      } else {
        setHardError({ message: `This item is not on Order #${order.order_number}.` })
        await supabase.from('exceptions').insert({
          org_id: worker.orgId,
          order_id: order.id,
          worker_id: worker.workerId,
          type: 'wrong_item',
          severity: 'hard',
          description: `Wrong item scanned: barcode ${parsed.raw} is not on this order`,
          status: 'open',
        })
        await logScan(parsed.raw, 'product', 'pick', 'error', 'Item not on order')
      }
      return
    }

    const newQty = item.quantity_picked + 1
    const done = newQty >= item.quantity_ordered

    await supabase.from('order_items').update({
      quantity_picked: newQty,
      status: done ? 'picked' : 'pending',
    }).eq('id', item.id)

    const { data: inv } = await supabase
      .from('inventory')
      .select('id, qty_reserved, qty_picked')
      .eq('product_id', item.product_id)
      .eq('org_id', worker.orgId)
      .single()

    if (inv) {
      await supabase.from('inventory').update({
        qty_reserved: Math.max(0, inv.qty_reserved - 1),
        qty_picked: inv.qty_picked + 1,
      }).eq('id', inv.id)
      await writeAudit(supabase, {
        orgId: worker.orgId,
        workerId: worker.workerId,
        action: 'item_picked',
        entityType: 'inventory',
        entityId: inv.id,
        changes: { product: item.products.name, qty_picked: inv.qty_picked + 1 },
        note: `Picked for order #${order.order_number}`,
      })
    }

    await logScan(parsed.raw, 'product', 'pick', 'success', null)
    playSuccess()
    setLastScan({ result: 'success', message: `✓ ${item.products.name} (${newQty}/${item.quantity_ordered})` })

    const updatedItems = items.map(i => i.id === item.id ? { ...i, quantity_picked: newQty, status: done ? 'picked' : 'pending' } : i)
    const remaining = updatedItems.filter(i => i.status !== 'picked')
    setItems(remaining)

    if (remaining.length === 0) {
      await supabase.from('orders').update({ status: 'picked' }).eq('id', order.id)
      await writeAudit(supabase, {
        orgId: worker.orgId,
        workerId: worker.workerId,
        action: 'order_status_changed',
        entityType: 'order',
        entityId: order.id,
        changes: { status: 'picked' },
      })
      await clearSession()
      setStep('complete')
    }
  }

  async function confirmShortPick() {
    if (!shortPickItem || !worker || !order) return
    const short = shortPickItem.quantity_ordered - shortPickQty

    await supabase.from('order_items').update({
      quantity_short: short,
      quantity_picked: shortPickQty,
      status: 'short',
    }).eq('id', shortPickItem.id)

    await supabase.from('exceptions').insert({
      org_id: worker.orgId,
      order_id: order.id,
      worker_id: worker.workerId,
      type: 'short_pick',
      severity: 'soft',
      description: `Short pick: ${shortPickItem.products.name} — found ${shortPickQty} of ${shortPickItem.quantity_ordered}`,
      status: 'open',
    })

    const { data: inv } = await supabase
      .from('inventory')
      .select('id, qty_reserved, qty_available, qty_picked')
      .eq('product_id', shortPickItem.product_id)
      .eq('org_id', worker.orgId)
      .single()

    if (inv && short > 0) {
      await supabase.from('inventory').update({
        qty_reserved: Math.max(0, inv.qty_reserved - short),
        qty_available: inv.qty_available + short,
        qty_picked: inv.qty_picked + shortPickQty,
      }).eq('id', inv.id)
    }

    playError()
    const remaining = items.filter(i => i.id !== shortPickItem.id)
    setItems(remaining)
    setShortPickItem(null)
    setLastScan({ result: 'warning', message: `Short pick: ${shortPickItem.products.name} (found ${shortPickQty}/${shortPickItem.quantity_ordered})` })

    if (remaining.length === 0) {
      await supabase.from('orders').update({ status: 'picked' }).eq('id', order.id)
      await clearSession()
      setStep('complete')
    }

    scanRef.current?.focus()
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

  const totalItems = items.reduce((s, i) => s + i.quantity_ordered, 0)
  const pickedItems = items.reduce((s, i) => s + i.quantity_picked, 0)

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

      {shortPickItem && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-t-2xl p-6 w-full max-w-lg">
            <p className="text-lg font-bold text-white mb-1">Short Pick</p>
            <p className="text-gray-400 text-sm mb-5">{shortPickItem.products.name}</p>
            <div className="flex items-center gap-3 mb-6">
              <label className="text-gray-400 text-sm shrink-0">Found:</label>
              <input
                type="number"
                min={0}
                max={shortPickItem.quantity_ordered - 1}
                value={shortPickQty}
                onChange={e => setShortPickQty(Math.min(shortPickItem.quantity_ordered - 1, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-24 bg-gray-800 border border-gray-600 rounded-lg px-3 py-3 text-white text-center text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
                autoFocus
              />
              <span className="text-gray-400 text-lg">/ {shortPickItem.quantity_ordered}</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShortPickItem(null); scanRef.current?.focus() }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-4 rounded-xl font-semibold touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={confirmShortPick}
                className="flex-1 bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white py-4 rounded-xl font-semibold touch-manipulation"
              >
                Confirm Short
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <div>
          <p className="font-bold text-white">{worker?.name || 'Worker'}</p>
          <p className="text-xs text-gray-500 capitalize">{worker?.role}</p>
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
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-5 py-3 rounded-xl text-sm font-semibold touch-manipulation"
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
            <p className="text-xl font-bold text-white">No orders assigned</p>
            <p className="text-gray-500 text-sm">Check with your manager for your next assignment.</p>
          </div>
        ) : step === 'scan_basket' ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
            <div className="w-20 h-20 bg-blue-900 rounded-2xl flex items-center justify-center">
              <ShoppingBasket size={40} className="text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white mb-2">Scan Your Basket</p>
              <p className="text-gray-400">Scan the barcode on your basket to begin picking order</p>
              <p className="text-blue-400 font-bold text-xl mt-2">#{order.order_number}</p>
              {order.is_rush && <span className="text-xs bg-red-600 text-white font-bold px-3 py-1 rounded-full mt-2 inline-block">RUSH ORDER</span>}
            </div>
            {lastScan && (
              <div className={`flex items-center gap-3 rounded-xl p-4 w-full ${lastScan.result === 'warning' ? 'bg-orange-950 border border-orange-800' : lastScan.result === 'success' ? 'bg-green-950 border border-green-800' : 'bg-red-950 border border-red-800'}`}>
                {lastScan.result === 'success' ? <CheckCircle size={20} className="text-green-400 shrink-0" /> : lastScan.result === 'warning' ? <AlertTriangle size={20} className="text-orange-400 shrink-0" /> : <XCircle size={20} className="text-red-400 shrink-0" />}
                <p className={`text-sm font-medium ${lastScan.result === 'success' ? 'text-green-300' : lastScan.result === 'warning' ? 'text-orange-300' : 'text-red-300'}`}>{lastScan.message}</p>
              </div>
            )}
            <button onClick={() => scanRef.current?.focus()} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold">
              <Scan size={18} /> Tap to Scan
            </button>
          </div>
        ) : step === 'complete' ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
            <div className="w-20 h-20 bg-green-900 rounded-2xl flex items-center justify-center">
              <CheckCircle size={40} className="text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white mb-2">Pick Complete!</p>
              <p className="text-gray-400">Order #{order.order_number} is fully picked.</p>
              <p className="text-gray-400 mt-1">Take the basket to the packing station.</p>
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
                  <p className="text-2xl font-bold text-blue-400">{pickedItems}/{totalItems}</p>
                  <p className="text-xs text-gray-500">items picked</p>
                </div>
              </div>
              <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${totalItems ? (pickedItems / totalItems) * 100 : 0}%` }} />
              </div>
              {order.notes && <p className="text-xs text-yellow-400 mt-2 bg-yellow-950 rounded px-2 py-1">{order.notes}</p>}
            </div>

            {lastScan && (
              <div className={`flex items-center gap-3 rounded-xl p-4 mb-4 ${lastScan.result === 'warning' ? 'bg-orange-950 border border-orange-800' : lastScan.result === 'success' ? 'bg-green-950 border border-green-800' : 'bg-red-950 border border-red-800'}`}>
                {lastScan.result === 'success' ? <CheckCircle size={20} className="text-green-400 shrink-0" /> : lastScan.result === 'warning' ? <AlertTriangle size={20} className="text-orange-400 shrink-0" /> : <XCircle size={20} className="text-red-400 shrink-0" />}
                <p className={`text-sm font-medium ${lastScan.result === 'success' ? 'text-green-300' : lastScan.result === 'warning' ? 'text-orange-300' : 'text-red-300'}`}>{lastScan.message}</p>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Items to Pick</p>
              {items.map(item => (
                <div key={item.id} className={`bg-gray-900 border rounded-xl p-4 flex items-center gap-4 ${item.quantity_picked > 0 ? 'border-blue-800' : 'border-gray-800'}`}>
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
                    <button
                      onClick={() => { setShortPickItem(item); setShortPickQty(item.quantity_picked) }}
                      className="text-xs text-orange-500 hover:text-orange-400 font-medium mt-1.5 touch-manipulation"
                    >
                      Short pick
                    </button>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-2xl font-bold tabular-nums ${item.quantity_picked >= item.quantity_ordered ? 'text-green-400' : 'text-white'}`}>
                      {item.quantity_picked}/{item.quantity_ordered}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => scanRef.current?.focus()}
              className="mt-6 w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white py-5 rounded-xl font-bold text-xl transition-colors touch-manipulation mb-4"
            >
              <Scan size={24} /> Tap to Scan Item
            </button>
          </>
        )}
      </div>
    </div>
  )
}
