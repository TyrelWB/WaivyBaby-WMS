'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseBarcode } from '@/lib/barcode'
import { playSuccess, playError } from '@/lib/feedback'
import { writeAudit } from '@/lib/audit'
import { Scan, CheckCircle, XCircle, Package, LogOut, Box, ChevronRight, Camera, AlertTriangle, MapPin, LayoutGrid, Loader2 } from 'lucide-react'
import CameraScanner from '@/components/CameraScanner'
import WorkerOnboarding from '@/components/WorkerOnboarding'
import { useWorkerHeartbeat } from '@/lib/presence'
import { toast } from 'sonner'
import Link from 'next/link'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type Order = { id: string; order_number: string; customer_name: string | null; is_rush: boolean; is_bulk: boolean; notes: string | null; total_boxes: number | null; basket_id: string | null; current_location: string | null }
type OrderItem = { id: string; product_id: string; quantity_ordered: number; quantity_picked: number; status: string; products: { name: string; sku: string; image_url: string | null } }
type AvailableOrder = { id: string; order_number: string; customer_name: string | null; is_rush: boolean; is_bulk: boolean; notes: string | null; created_at: string; item_count: number }

type PackStep = 'scan_order' | 'packing' | 'complete' | 'scan_to_rack'

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  return `${hours}h`
}

export default function PackPage() {
  const supabase = createClient()
  const scanRef = useRef<HTMLInputElement>(null)
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [step, setStep] = useState<PackStep>('scan_order')
  const [scanInput, setScanInput] = useState('')
  const [lastScan, setLastScan] = useState<{ result: 'success' | 'error' | 'warning'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCamera, setShowCamera] = useState(false)
  const [currentBox, setCurrentBox] = useState(1)
  const [boxIds, setBoxIds] = useState<string[]>([])
  const [packProgress, setPackProgress] = useState<Record<string, number>>({})
  const [hardError, setHardError] = useState<{ message: string } | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [lastScannedItem, setLastScannedItem] = useState<OrderItem | null>(null)
  const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)

  useWorkerHeartbeat(worker?.workerId, 'pack')

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) {
          setWorker(session)
          fetchAssignedOrder(session)
          const key = `wms_onboarded_${session.workerId}_${session.role}`
          if (!localStorage.getItem(key)) setShowOnboarding(true)
        } else setLoading(false)
      })
    scanRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!worker) return
    const channel = supabase
      .channel(`packer-${worker.workerId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `status=eq.picked`,
      }, () => {
        setOrder(prev => { if (!prev) fetchAssignedOrder(worker); return prev })
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `assigned_packer_id=eq.${worker.workerId}`,
      }, () => {
        setOrder(prev => { if (!prev) fetchAssignedOrder(worker); return prev })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [worker])

  function dismissOnboarding() {
    if (!worker) return
    localStorage.setItem(`wms_onboarded_${worker.workerId}_${worker.role}`, '1')
    setShowOnboarding(false)
  }

  // Incoming orders list: workers tap to claim instead of scanning an order paper.
  useEffect(() => {
    if (!worker || step !== 'scan_order') return
    fetchAvailableOrders(worker)
    const channel = supabase
      .channel(`available-orders-pack-${worker.orgId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `org_id=eq.${worker.orgId}`,
      }, () => fetchAvailableOrders(worker))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [worker, step])

  async function fetchAvailableOrders(session: WorkerSession) {
    setLoadingAvailable(true)
    let query = supabase
      .from('orders')
      .select('id, order_number, customer_name, is_rush, is_bulk, notes, created_at')
      .eq('org_id', session.orgId)
      .eq('status', 'picked')
      .is('assigned_packer_id', null)
    if (session.warehouseId) query = query.eq('warehouse_id', session.warehouseId)
    const { data } = await query
      .order('is_rush', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(30)

    const orders = data || []
    const orderIds = orders.map(o => o.id)
    const countMap: Record<string, number> = {}
    if (orderIds.length > 0) {
      const { data: itemRows } = await supabase.from('order_items').select('order_id').in('order_id', orderIds)
      for (const row of itemRows || []) countMap[row.order_id] = (countMap[row.order_id] || 0) + 1
    }
    setAvailableOrders(orders.map(o => ({ ...o, item_count: countMap[o.id] || 0 })))
    setLoadingAvailable(false)
  }

  async function claimOrderFromList(target: AvailableOrder) {
    if (!worker || claimingId) return
    setClaimingId(target.id)
    try {
      const { data: claimed, error } = await supabase
        .from('orders')
        .update({ assigned_packer_id: worker.workerId })
        .eq('id', target.id)
        .is('assigned_packer_id', null)
        .select('id, order_number, customer_name, is_rush, is_bulk, notes, total_boxes, basket_id, current_location')
        .single()

      if (error || !claimed) {
        playError()
        setLastScan({ result: 'warning', message: `Order #${target.order_number} was just claimed by someone else.` })
        fetchAvailableOrders(worker)
        return
      }

      setOrder(claimed as Order)
      await fetchItems(claimed.id)
      await startPacking(claimed.id)
      playSuccess()
      const locationMsg = claimed.current_location ? ` · Find it at rack ${claimed.current_location}` : ''
      setLastScan({ result: 'success', message: `Order #${claimed.order_number} claimed! Box 1 open.${locationMsg}` })
      setStep('packing')
    } finally {
      setClaimingId(null)
    }
  }

  // Opens Box 1 and flips the order into packing. Skipped if it's already packing
  // (e.g. a page reload after this already ran once for this order).
  async function startPacking(orderId: string) {
    if (!worker) return
    const { data: boxData } = await supabase.from('boxes').insert({
      org_id: worker.orgId,
      order_id: orderId,
      box_number: 1,
      status: 'open',
    }).select('id').single()
    if (boxData) setBoxIds([boxData.id])
    await supabase.from('orders').update({ status: 'packing' }).eq('id', orderId)
  }

  async function fetchAssignedOrder(session: WorkerSession) {
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, is_rush, is_bulk, notes, total_boxes, basket_id, current_location, status')
      .eq('assigned_packer_id', session.workerId)
      .in('status', ['picked', 'packing'])
      .order('is_rush', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (data) {
      setOrder(data as Order)
      await fetchItems(data.id)
      if (data.status === 'picked') await startPacking(data.id)
      setStep('packing')
    }
    // If no order, stay on scan_order step
    setLoading(false)
  }

  async function fetchItems(orderId: string) {
    const { data } = await supabase
      .from('order_items')
      .select('id, product_id, quantity_ordered, quantity_picked, status, products(name, sku, image_url)')
      .eq('order_id', orderId)
    const base = (data as unknown as OrderItem[]) || []
    // products can come back null if the item's product_id is orphaned (deleted product, bad data, etc.)
    setItems(base.map(i => ({ ...i, products: i.products || { name: 'Unknown product', sku: '—', image_url: null } })))
  }

  async function handleRackScan(barcode: string) {
    if (!order || !worker) return
    const { data: location } = await supabase
      .from('locations')
      .select('id, location_code, name')
      .eq('location_code', barcode)
      .eq('org_id', worker.orgId)
      .single()

    if (!location) {
      playError()
      setLastScan({ result: 'error', message: `Location "${barcode}" not found.` })
      return
    }
    await supabase.from('orders').update({ current_location: location.location_code } as any).eq('id', order.id)
    playSuccess()
    setStep('complete')
  }

  async function handleScan(raw: string) {
    if (!raw.trim()) return
    const parsed = parseBarcode(raw.trim())
    setScanInput('')
    scanRef.current?.focus()
    if (step === 'packing') await handleItemScan(parsed)
    if (step === 'scan_to_rack') { await handleRackScan(parsed.raw); return }
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
        org_id: worker.orgId, order_id: order.id, worker_id: worker.workerId,
        type: 'unknown_barcode', severity: 'hard',
        description: `Unknown barcode scanned during packing: ${parsed.raw}`, status: 'open',
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
          org_id: worker.orgId, order_id: order.id, worker_id: worker.workerId,
          type: 'wrong_item', severity: 'hard',
          description: `Wrong item scanned during packing: barcode ${parsed.raw} is not on this order`, status: 'open',
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
      await supabase.from('box_items').insert({ box_id: activeBoxId, order_item_id: item.id, quantity: 1 })
    }

    await logScan(parsed.raw, 'product', 'pack', 'success', null)
    playSuccess()
    setLastScannedItem(item)
    setLastScan({ result: 'success', message: `✓ ${item.products.name} (${newQty}/${item.quantity_ordered})` })

    const allPacked = items.every(i => (newProgress[i.id] || 0) >= i.quantity_ordered)
    if (allPacked) await completePacking()
  }

  async function closeCurrentBox() {
    if (!order || !worker) return
    const activeBoxId = boxIds[currentBox - 1]
    if (activeBoxId) await supabase.from('boxes').update({ status: 'closed' }).eq('id', activeBoxId)

    const nextBox = currentBox + 1
    const { data: newBox } = await supabase.from('boxes').insert({
      org_id: worker.orgId,
      order_id: order.id,
      box_number: nextBox,
      status: 'open',
    }).select('id').single()

    if (newBox) setBoxIds(prev => [...prev, newBox.id])
    setCurrentBox(nextBox)
    toast.success(`Box ${currentBox} closed. Box ${nextBox} opened.`)
    scanRef.current?.focus()
  }

  async function completePacking() {
    if (!order || !worker) return

    const activeBoxId = boxIds[currentBox - 1]
    if (activeBoxId) await supabase.from('boxes').update({ status: 'closed' }).eq('id', activeBoxId)

    if (order.basket_id) {
      await supabase.from('baskets').update({
        status: 'available', current_order_id: null, current_worker_id: null, claimed_at: null,
      }).eq('id', order.basket_id)
    }

    await supabase.from('orders').update({ status: 'packed', packed_at: new Date().toISOString() } as any).eq('id', order.id)
    await writeAudit(supabase, {
      orgId: worker.orgId, workerId: worker.workerId,
      action: 'order_status_changed', entityType: 'order', entityId: order.id,
      changes: { status: 'packed', boxes: boxIds.length },
      note: `Packed by ${worker.name}`,
    })

    setStep('scan_to_rack')
  }

  async function logScan(barcode: string, type: string, action: string, result: string, errorMsg: string | null) {
    if (!worker || !order) return
    await supabase.from('scan_events').insert({
      org_id: worker.orgId, worker_id: worker.workerId, order_id: order.id,
      barcode, barcode_type: type, scan_action: action, result, error_message: errorMsg,
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
      {showOnboarding && worker && (
        <WorkerOnboarding workerId={worker.workerId} role={worker.role as any} onDismiss={dismissOnboarding} />
      )}

      {/* Hard error overlay */}
      {hardError && (
        <div className="fixed inset-0 z-50 bg-red-950 flex flex-col items-center justify-center text-center px-8 gap-6">
          <XCircle size={72} className="text-red-400" />
          <div>
            <p className="text-3xl font-bold text-white">Stop!</p>
            <p className="text-red-300 mt-3 text-lg">{hardError.message}</p>
          </div>
          <button onClick={() => { setHardError(null); scanRef.current?.focus() }} className="bg-red-700 hover:bg-red-600 text-white px-10 py-4 rounded-xl font-bold text-xl">
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 bg-purple-900 rounded-lg flex items-center justify-center shrink-0">
            <Package size={18} className="text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white truncate">{worker?.name || 'Worker'}</p>
            <p className="text-xs text-gray-500">Packer</p>
          </div>
          {order && step === 'packing' && (
            <>
              <span className="text-gray-700 mx-2 hidden sm:inline">|</span>
              <div className="hidden sm:flex items-center gap-2 min-w-0">
                <p className="text-sm text-gray-400">Order <span className="text-white font-bold">#{order.order_number}</span></p>
                {order.customer_name && <p className="text-sm text-gray-500 truncate">{order.customer_name}</p>}
                {order.is_rush && <span className="text-xs bg-red-600 text-white font-bold px-2 py-0.5 rounded-full shrink-0">RUSH</span>}
                <a
                  href={`/print/order/${order.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 shrink-0 transition-colors"
                >
                  Reprint sheet
                </a>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          {order && step === 'packing' && (
            <div className="flex items-center gap-3">
              <div className="w-40 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${totalQty ? (packedQty / totalQty) * 100 : 0}%` }} />
              </div>
              <span className="text-sm text-purple-400 font-bold tabular-nums">{packedQty}/{totalQty}</span>
            </div>
          )}
          <Link href="/hub" className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
            <LayoutGrid size={16} /> Switch task
          </Link>
          <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
            <LogOut size={16} /> Log out
          </button>
        </div>
      </div>

      {/* Hidden scan input */}
      <input ref={scanRef} value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }} className="opacity-0 absolute w-0 h-0" autoFocus autoComplete="off" />

      {showCamera && <CameraScanner onScan={(barcode) => { setShowCamera(false); handleScan(barcode) }} onClose={() => setShowCamera(false)} />}

      {/* Content */}
      {loading && <div className="flex-1 flex items-center justify-center text-gray-500">Loading your orders...</div>}

      {/* Scan order paper */}
      {!loading && step === 'scan_order' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex flex-col items-center text-center gap-4 px-4 py-6 shrink-0">
            <div className="w-16 h-16 bg-purple-900 rounded-2xl flex items-center justify-center">
              <Package size={32} className="text-purple-400" />
            </div>
            <div className="max-w-lg w-full">
              <p className="text-xl font-bold text-white mb-1">Get an Order to Pack</p>
              <p className="text-gray-400 text-sm max-w-xs mx-auto">Pick one from the list below.</p>
            </div>
            {lastScan && (
              <div className={`flex items-center gap-3 rounded-xl p-4 max-w-lg w-full ${lastScan.result === 'success' ? 'bg-green-950 border border-green-800' : lastScan.result === 'warning' ? 'bg-orange-950 border border-orange-800' : 'bg-red-950 border border-red-800'}`}>
                {lastScan.result === 'success' ? <CheckCircle size={18} className="text-green-400 shrink-0" /> : lastScan.result === 'warning' ? <AlertTriangle size={18} className="text-orange-400 shrink-0" /> : <XCircle size={18} className="text-red-400 shrink-0" />}
                <p className={`text-base font-medium ${lastScan.result === 'success' ? 'text-green-300' : lastScan.result === 'warning' ? 'text-orange-300' : 'text-red-300'}`}>{lastScan.message}</p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-6 border-t border-gray-800">
            <div className="max-w-lg mx-auto pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Incoming Orders {availableOrders.length > 0 && `(${availableOrders.length})`}
              </p>

              {loadingAvailable && availableOrders.length === 0 && (
                <p className="text-sm text-gray-500 py-4 text-center">Loading orders...</p>
              )}
              {!loadingAvailable && availableOrders.length === 0 && (
                <p className="text-sm text-gray-500 py-4 text-center">No orders ready to pack right now.</p>
              )}

              <div className="space-y-2">
                {availableOrders.map(o => (
                  <div key={o.id} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white">#{o.order_number}</span>
                        {o.customer_name && <span className="text-sm text-gray-400 truncate">{o.customer_name}</span>}
                        {o.is_rush && <span className="text-xs bg-red-600 text-white font-bold px-1.5 py-0.5 rounded-full shrink-0">RUSH</span>}
                        {o.is_bulk && <span className="text-xs bg-orange-700 text-white font-bold px-1.5 py-0.5 rounded-full shrink-0">BULK</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {o.item_count} {o.item_count === 1 ? 'item' : 'items'} - waiting {timeAgo(o.created_at)}
                      </p>
                      {o.notes && <p className="text-xs text-yellow-400 mt-0.5 truncate">{o.notes}</p>}
                    </div>
                    <button
                      onClick={() => claimOrderFromList(o)}
                      disabled={claimingId !== null}
                      className="shrink-0 flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-semibold text-sm"
                    >
                      {claimingId === o.id ? <Loader2 size={16} className="animate-spin" /> : 'Pack This'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scan to rack after packing */}
      {!loading && order && step === 'scan_to_rack' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 px-4">
          <div className="w-20 h-20 bg-yellow-900 rounded-2xl flex items-center justify-center">
            <MapPin size={40} className="text-yellow-400" />
          </div>
          <div className="max-w-lg w-full">
            <p className="text-2xl font-bold text-white mb-2">Scan Rack Location</p>
            <p className="text-gray-400">Scan the rack where you're placing order #{order.order_number}.</p>
            <p className="text-gray-500 text-sm mt-1">This lets the shipper find it quickly.</p>
          </div>
          {lastScan && (
            <div className={`flex items-center gap-3 rounded-xl p-4 max-w-lg w-full ${lastScan.result === 'success' ? 'bg-green-950 border border-green-800' : 'bg-red-950 border border-red-800'}`}>
              {lastScan.result === 'success' ? <CheckCircle size={18} className="text-green-400 shrink-0" /> : <XCircle size={18} className="text-red-400 shrink-0" />}
              <p className={`text-base font-medium ${lastScan.result === 'success' ? 'text-green-300' : 'text-red-300'}`}>{lastScan.message}</p>
            </div>
          )}
          <div className="flex gap-3 w-full max-w-lg">
            <button onClick={() => scanRef.current?.focus()} className="flex-1 flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-500 text-white px-6 py-4 rounded-xl font-semibold text-lg">
              <Scan size={20} /> Scan Rack
            </button>
            <button onClick={() => setShowCamera(true)} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-5 py-4 rounded-xl">
              <Camera size={20} />
            </button>
          </div>
          <button onClick={() => setStep('complete')} className="text-sm text-gray-600 hover:text-gray-400 underline">
            Skip — no rack barcode yet
          </button>
        </div>
      )}

      {!loading && order && step === 'complete' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
          <div className="w-20 h-20 bg-green-900 rounded-2xl flex items-center justify-center">
            <CheckCircle size={40} className="text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white mb-2">Packing Complete!</p>
            <p className="text-gray-400">Order #{order.order_number} packed in {boxIds.length} box{boxIds.length !== 1 ? 'es' : ''}.</p>
            <p className="text-gray-400 mt-1">Hand the order paper to the shipping team.</p>
          </div>
        </div>
      )}

      {!loading && order && step === 'packing' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left panel: items checklist */}
          <div className="md:w-80 xl:w-96 border-b md:border-b-0 md:border-r border-gray-800 flex flex-col bg-gray-900/20 md:shrink-0 max-h-44 md:max-h-none">
            <div className="px-5 py-4 border-b border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Items to Pack</p>
              {order.notes && (
                <div className="flex items-start gap-1.5 mt-2 bg-yellow-950 rounded px-2 py-1.5">
                  <AlertTriangle size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-300">{order.notes}</p>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {items.map(item => {
                const packed = packProgress[item.id] || 0
                const done = packed >= item.quantity_ordered
                const inProgress = packed > 0 && !done
                return (
                  <div key={item.id} className={`flex items-center gap-3 rounded-xl px-3 py-3 border transition-colors ${done ? 'border-green-800 bg-green-950/30 opacity-60' : inProgress ? 'border-purple-800 bg-gray-800' : 'border-gray-800 bg-gray-800/50'}`}>
                    <div className="w-10 h-10 bg-gray-700 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                      {item.products.image_url
                        ? <img src={item.products.image_url} alt="" className="w-full h-full object-cover rounded-lg" />
                        : <Package size={16} className="text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{item.products.name}</p>
                      <p className="text-xs text-gray-500 font-mono">{item.products.sku}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-base font-bold tabular-nums ${done ? 'text-green-400' : 'text-white'}`}>{packed}/{item.quantity_ordered}</p>
                      {done && <p className="text-xs text-green-500">Done</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right panel: scan + controls */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Scan bar */}
            <div className="px-4 sm:px-6 py-4 border-b border-gray-800 bg-gray-900/30 shrink-0">
              <div className="flex gap-2">
                <input
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-4 text-lg text-center text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Scan or type..."
                  autoComplete="off"
                />
                <button onClick={() => setShowCamera(true)} className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-4 rounded-lg border border-gray-700">
                  <Camera size={20} />
                </button>
                <button onClick={() => handleScan(scanInput)} className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-4 rounded-lg text-lg font-semibold">
                  Scan
                </button>
              </div>
            </div>

            {/* Main area */}
            <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 gap-5 overflow-y-auto py-6 sm:py-8">
              {/* Mobile reprint link */}
              <div className="flex sm:hidden items-center justify-between w-full max-w-lg">
                <p className="text-sm text-gray-400">Order <span className="text-white font-bold">#{order.order_number}</span></p>
                <a
                  href={`/print/order/${order.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
                >
                  Reprint sheet
                </a>
              </div>
              {/* Last scan feedback */}
              {lastScan && (
                <div className={`flex items-center gap-3 rounded-xl px-4 py-3 w-full max-w-lg ${lastScan.result === 'warning' ? 'bg-orange-950 border border-orange-800' : lastScan.result === 'success' ? 'bg-green-950 border border-green-800' : 'bg-red-950 border border-red-800'}`}>
                  {lastScan.result === 'success' ? <CheckCircle size={18} className="text-green-400 shrink-0" /> : lastScan.result === 'warning' ? <AlertTriangle size={18} className="text-orange-400 shrink-0" /> : <XCircle size={18} className="text-red-400 shrink-0" />}
                  <p className={`text-sm font-medium ${lastScan.result === 'success' ? 'text-green-300' : lastScan.result === 'warning' ? 'text-orange-300' : 'text-red-300'}`}>{lastScan.message}</p>
                </div>
              )}

              {/* Last scanned item */}
              {lastScannedItem && (
                <div className="bg-gray-900 border border-purple-800 rounded-xl p-4 w-full max-w-lg flex items-center gap-4">
                  <div className="w-20 h-20 bg-gray-800 rounded-xl overflow-hidden shrink-0 flex items-center justify-center">
                    {lastScannedItem.products.image_url
                      ? <img src={lastScannedItem.products.image_url} alt="" className="w-full h-full object-cover" />
                      : <Package size={28} className="text-gray-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-purple-400 font-semibold uppercase tracking-wider mb-1">Last Scanned</p>
                    <p className="text-lg font-bold text-white leading-tight">{lastScannedItem.products.name}</p>
                    <p className="text-sm text-gray-500 font-mono">{lastScannedItem.products.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-3xl font-bold text-white tabular-nums">{packProgress[lastScannedItem.id] || 0}</p>
                    <p className="text-sm text-gray-500">/ {lastScannedItem.quantity_ordered}</p>
                  </div>
                </div>
              )}

              {/* Box controls */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 w-full max-w-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-purple-900 rounded-xl flex items-center justify-center">
                    <Box size={20} className="text-purple-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">Box {currentBox}</p>
                    <p className="text-xs text-gray-500">of {totalBoxes} expected</p>
                  </div>
                </div>
                <button onClick={closeCurrentBox} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  Next Box <ChevronRight size={14} />
                </button>
              </div>

              {/* Scan prompt */}
              <button
                onClick={() => scanRef.current?.focus()}
                className="w-full max-w-lg flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white py-4 rounded-xl font-bold text-lg transition-colors"
              >
                <Scan size={20} /> Click to Focus Scanner
              </button>

              {/* Complete button */}
              {packedQty >= totalQty && totalQty > 0 && (
                <button
                  onClick={completePacking}
                  className="w-full max-w-lg flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white py-4 rounded-xl font-bold text-lg transition-colors"
                >
                  <CheckCircle size={22} /> Complete Packing
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
