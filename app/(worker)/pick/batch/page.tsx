'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseBarcode } from '@/lib/barcode'
import { playSuccess, playError } from '@/lib/feedback'
import { writeAudit } from '@/lib/audit'
import {
  Scan, CheckCircle, XCircle, Package, LogOut, Camera, AlertTriangle, MapPin, Layers, Trash2, Loader2, LayoutGrid, Undo2,
} from 'lucide-react'
import CameraScanner from '@/components/CameraScanner'
import WorkerOnboarding from '@/components/WorkerOnboarding'
import ScanFeedback from '@/components/ScanFeedback'
import Link from 'next/link'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }

type ClaimedOrder = {
  id: string
  order_number: string
  customer_name: string | null
  is_rush: boolean
  is_bulk: boolean
  notes: string | null
  status: string
}

type BatchOrderItem = {
  id: string
  order_id: string
  order_number: string
  product_id: string
  quantity_ordered: number
  quantity_picked: number
  status: string
  bin_location: string | null
  products: { name: string; sku: string; image_url: string | null }
}

type BatchStep = 'scan_orders' | 'picking' | 'scan_to_rack' | 'complete'
type AvailableOrder = { id: string; order_number: string; customer_name: string | null; is_rush: boolean; is_bulk: boolean; notes: string | null; created_at: string; item_count: number }

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  return `${hours}h`
}

function sortByBin(a: BatchOrderItem, b: BatchOrderItem) {
  if (!a.bin_location && !b.bin_location) return 0
  if (!a.bin_location) return 1
  if (!b.bin_location) return -1
  return a.bin_location.localeCompare(b.bin_location)
}

// Group items by bin location
function groupByBin(items: BatchOrderItem[]): { bin: string | null; items: BatchOrderItem[] }[] {
  const sorted = [...items].sort(sortByBin)
  const groups: { bin: string | null; items: BatchOrderItem[] }[] = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && last.bin === item.bin_location) {
      last.items.push(item)
    } else {
      groups.push({ bin: item.bin_location, items: [item] })
    }
  }
  return groups
}

export default function BatchPickPage() {
  const supabase = createClient()
  const scanRef = useRef<HTMLInputElement>(null)

  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [step, setStep] = useState<BatchStep>('scan_orders')
  const [claimedOrders, setClaimedOrders] = useState<ClaimedOrder[]>([])
  const [items, setItems] = useState<BatchOrderItem[]>([])
  const [scanInput, setScanInput] = useState('')
  const [lastScan, setLastScan] = useState<{ result: 'success' | 'error' | 'warning'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCamera, setShowCamera] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [lastAction, setLastAction] = useState<{ item: BatchOrderItem; invId: string | null } | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [todayPickCount, setTodayPickCount] = useState<number | null>(null)

  // Derived: remaining (not fully picked) items
  const remainingItems = useMemo(() => items.filter(i => i.status !== 'picked'), [items])
  const binGroups = useMemo(() => groupByBin(remainingItems), [remainingItems])

  const totalItems = items.reduce((s, i) => s + i.quantity_ordered, 0)
  const pickedItems = items.reduce((s, i) => s + i.quantity_picked, 0)
  const progressPct = totalItems ? Math.round((pickedItems / totalItems) * 100) : 0

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) {
          setWorker(session)
          fetchTodayPickCount(session)
          const key = `wms_onboarded_${session.workerId}_picker`
          if (!localStorage.getItem(key)) setShowOnboarding(true)
        }
        setLoading(false)
      })
    scanRef.current?.focus()
  }, [])

  function dismissOnboarding() {
    if (!worker) return
    localStorage.setItem(`wms_onboarded_${worker.workerId}_picker`, '1')
    setShowOnboarding(false)
  }

  async function handleLogout() {
    await fetch('/api/worker-auth', { method: 'DELETE' })
    window.location.href = '/worker'
  }

  // ── Incoming orders (tap-to-add, alternative to scanning a paper) ───────────

  useEffect(() => {
    if (!worker || step !== 'scan_orders') return
    fetchAvailableOrders(worker)
    const channel = supabase
      .channel(`available-orders-batch-${worker.orgId}`)
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
      .eq('status', 'pending')
      .is('assigned_picker_id', null)
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

  async function addOrderToBatch(target: AvailableOrder) {
    if (!worker || addingId) return
    setAddingId(target.id)
    try {
      // Atomic claim: only succeeds if nobody grabbed it between the list render and this tap.
      const { data: claimed, error } = await supabase
        .from('orders')
        .update({ assigned_picker_id: worker.workerId, status: 'assigned' })
        .eq('id', target.id)
        .is('assigned_picker_id', null)
        .select('id, order_number, customer_name, is_rush, is_bulk, notes, status')
        .single()

      if (error || !claimed) {
        playError()
        setLastScan({ result: 'warning', message: `Order #${target.order_number} was just claimed by someone else.` })
        fetchAvailableOrders(worker)
        return
      }

      await writeAudit(supabase, {
        orgId: worker.orgId, workerId: worker.workerId,
        action: 'order_assigned', entityType: 'order', entityId: claimed.id,
        changes: { assigned_picker_id: worker.workerId, status: 'assigned', batch_pick: true },
      })
      await fetch(`/api/orders/${claimed.id}/reserve`, { method: 'POST' })

      setClaimedOrders(prev => [...prev, claimed as ClaimedOrder])
      playSuccess()
      setLastScan({ result: 'success', message: `Order #${claimed.order_number} added to batch!` })
    } finally {
      setAddingId(null)
    }
  }

  // ── Scan order step ──────────────────────────────────────────────────────────

  async function handleClearAll() {
    if (!worker || claimedOrders.length === 0) return
    // Release claimed orders back to pending
    for (const o of claimedOrders) {
      await supabase
        .from('orders')
        .update({ assigned_picker_id: null, status: 'pending' })
        .eq('id', o.id)
    }
    setClaimedOrders([])
    setLastScan({ result: 'warning', message: 'All orders cleared.' })
  }

  async function handleStartPicking() {
    if (!worker || claimedOrders.length === 0) return
    // Load all items for all claimed orders
    const allItems: BatchOrderItem[] = []

    for (const order of claimedOrders) {
      const { data } = await supabase
        .from('order_items')
        .select('id, product_id, quantity_ordered, quantity_picked, status, products(name, sku, image_url)')
        .eq('order_id', order.id)
        .not('status', 'eq', 'picked')

      const base = (data as unknown as Omit<BatchOrderItem, 'bin_location' | 'order_id' | 'order_number'>[] | null) || []
      const productIds = base.map(i => i.product_id)

      const binMap: Record<string, string | null> = {}
      if (productIds.length > 0) {
        const { data: invData } = await supabase
          .from('inventory')
          .select('product_id, bins(location_code)')
          .in('product_id', productIds)
          .eq('org_id', worker.orgId)
        for (const inv of invData || []) {
          binMap[inv.product_id] = (inv as any).bins?.location_code || null
        }
      }

      // products can come back null if the item's product_id is orphaned (deleted product, bad data, etc.)
      const orderItems: BatchOrderItem[] = base.map(i => ({
        ...i,
        products: i.products || { name: 'Unknown product', sku: '—', image_url: null },
        order_id: order.id,
        order_number: order.order_number,
        bin_location: binMap[i.product_id] || null,
      }))
      allItems.push(...orderItems)
    }

    setItems(allItems)
    setStep('picking')
  }

  // ── Picking step ─────────────────────────────────────────────────────────────

  async function handleItemScan(parsed: ReturnType<typeof parseBarcode>) {
    if (!worker) return

    const { data: productBarcode } = await supabase
      .from('product_barcodes')
      .select('product_id')
      .eq('barcode', parsed.raw)
      .single()

    if (!productBarcode) {
      playError()
      setLastScan({ result: 'error', message: `Barcode not recognized: ${parsed.raw}` })
      return
    }

    // Find the item across all orders (pick from oldest order first — first match)
    const item = remainingItems.find(
      i => i.product_id === productBarcode.product_id && i.quantity_picked < i.quantity_ordered
    )

    if (!item) {
      const anyItem = items.find(i => i.product_id === productBarcode.product_id)
      if (anyItem) {
        playError()
        setLastScan({ result: 'warning', message: `${anyItem.products.name} is already fully picked across all orders.` })
      } else {
        playError()
        setLastScan({ result: 'error', message: `This item is not on any order in your batch.` })
      }
      return
    }

    const newQty = item.quantity_picked + 1
    const done = newQty >= item.quantity_ordered
    const preScanSnapshot = { ...item }

    await supabase
      .from('order_items')
      .update({ quantity_picked: newQty, status: done ? 'picked' : 'pending' })
      .eq('id', item.id)

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
        orgId: worker.orgId, workerId: worker.workerId,
        action: 'item_picked', entityType: 'inventory', entityId: inv.id,
        changes: { product: item.products.name, qty_picked: inv.qty_picked + 1 },
        note: `Batch picked for order #${item.order_number}`,
      })
    }

    playSuccess()
    setLastScan({ result: 'success', message: `✓ ${item.products.name} — Order #${item.order_number} (${newQty}/${item.quantity_ordered})` })
    setLastAction({ item: preScanSnapshot, invId: inv?.id ?? null })

    const updatedItems = items.map(i =>
      i.id === item.id ? { ...i, quantity_picked: newQty, status: done ? 'picked' : 'pending' } : i
    )
    setItems(updatedItems)

    // Check if all items across all orders are picked
    const stillRemaining = updatedItems.filter(i => i.status !== 'picked')
    if (stillRemaining.length === 0) {
      await completeAllOrders()
    }
  }

  // Reverts the single most recent plain-item scan (barcode gun double-fires are common).
  async function undoLastScan() {
    if (!lastAction || !worker || undoing) return
    setUndoing(true)
    try {
      const { item: prevItem, invId } = lastAction
      await supabase.from('order_items').update({ quantity_picked: prevItem.quantity_picked, status: prevItem.status }).eq('id', prevItem.id)

      if (invId) {
        const { data: inv } = await supabase.from('inventory').select('id, qty_reserved, qty_picked').eq('id', invId).single()
        if (inv) {
          await supabase.from('inventory').update({
            qty_reserved: inv.qty_reserved + 1,
            qty_picked: Math.max(0, inv.qty_picked - 1),
          }).eq('id', inv.id)
        }
      }

      setItems(prev => {
        const exists = prev.some(i => i.id === prevItem.id)
        return exists ? prev.map(i => i.id === prevItem.id ? prevItem : i) : [...prev, prevItem]
      })
      playSuccess()
      setLastScan({ result: 'warning', message: `Undid last scan: ${prevItem.products.name}` })
      setLastAction(null)
    } finally {
      setUndoing(false)
    }
  }

  async function fetchTodayPickCount(session: WorkerSession) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('orders')
      .select('id')
      .eq('assigned_picker_id', session.workerId)
      .gte('pick_completed_at', todayStart.toISOString())
    setTodayPickCount(data?.length ?? 0)
  }

  async function markItemPickedManually(item: BatchOrderItem) {
    if (!worker) return
    setLastAction(null)
    const newQty = item.quantity_ordered
    const delta = newQty - item.quantity_picked
    await supabase
      .from('order_items')
      .update({ quantity_picked: newQty, status: 'picked' })
      .eq('id', item.id)

    if (delta > 0) {
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, qty_reserved, qty_picked')
        .eq('product_id', item.product_id)
        .eq('org_id', worker.orgId)
        .single()

      if (inv) {
        await supabase.from('inventory').update({
          qty_reserved: Math.max(0, inv.qty_reserved - delta),
          qty_picked: inv.qty_picked + delta,
        }).eq('id', inv.id)

        await writeAudit(supabase, {
          orgId: worker.orgId, workerId: worker.workerId,
          action: 'item_picked', entityType: 'inventory', entityId: inv.id,
          changes: { product: item.products.name, qty_picked: inv.qty_picked + delta },
          note: `Manually marked picked for order #${item.order_number}`,
        })
      }
    }

    playSuccess()
    setLastScan({ result: 'success', message: `✓ ${item.products.name} marked picked — Order #${item.order_number}` })

    const updatedItems = items.map(i =>
      i.id === item.id ? { ...i, quantity_picked: newQty, status: 'picked' } : i
    )
    setItems(updatedItems)

    const stillRemaining = updatedItems.filter(i => i.status !== 'picked')
    if (stillRemaining.length === 0) {
      await completeAllOrders()
    }
  }

  async function completeAllOrders() {
    if (!worker) return
    setCompleting(true)
    const now = new Date().toISOString()
    for (const order of claimedOrders) {
      await supabase
        .from('orders')
        .update({ status: 'picked', pick_completed_at: now } as any)
        .eq('id', order.id)

      await writeAudit(supabase, {
        orgId: worker.orgId, workerId: worker.workerId,
        action: 'order_status_changed', entityType: 'order', entityId: order.id,
        changes: { status: 'picked' },
        note: 'Batch pick complete',
      })
    }
    setCompleting(false)
    fetchTodayPickCount(worker)
    setStep('scan_to_rack')
  }

  // ── Scan to rack step ────────────────────────────────────────────────────────

  async function handleRackScan(barcode: string) {
    if (!worker) return
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

    // Set current_location on all orders in the batch
    for (const order of claimedOrders) {
      await supabase
        .from('orders')
        .update({ current_location: location.location_code } as any)
        .eq('id', order.id)
    }

    playSuccess()
    setStep('complete')
  }

  // ── Main scan dispatcher ─────────────────────────────────────────────────────

  async function handleScan(raw: string) {
    if (!raw.trim() || scanning) return
    setScanning(true)
    try {
      const parsed = parseBarcode(raw.trim())
      setScanInput('')
      scanRef.current?.focus()

      if (step === 'picking') { await handleItemScan(parsed); return }
      if (step === 'scan_to_rack') { await handleRackScan(parsed.raw); return }
    } finally {
      setScanning(false)
    }
  }

  function resetBatch() {
    setClaimedOrders([])
    setItems([])
    setLastScan(null)
    setStep('scan_orders')
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {showOnboarding && worker && (
        <WorkerOnboarding workerId={worker.workerId} role={worker.role as any} onDismiss={dismissOnboarding} />
      )}

      {/* Clear all confirmation */}
      {confirmClearAll && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm">
            <p className="text-lg font-bold text-white mb-1">Clear entire batch?</p>
            <p className="text-gray-400 text-sm mb-6">
              This releases all {claimedOrders.length} claimed {claimedOrders.length === 1 ? 'order' : 'orders'} back to pending. This can't be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmClearAll(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl font-semibold">Cancel</button>
              <button
                onClick={async () => { setConfirmClearAll(false); await handleClearAll() }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl font-semibold"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-900 rounded-lg flex items-center justify-center">
            <Layers size={18} className="text-indigo-400" />
          </div>
          <div>
            <p className="font-bold text-white">{worker?.name || 'Worker'}</p>
            <p className="text-xs text-gray-500">Batch Pick</p>
          </div>
          {step === 'picking' && claimedOrders.length > 0 && (
            <>
              <span className="text-gray-700 mx-2">|</span>
              <p className="text-sm text-gray-400">
                <span className="text-white font-bold">{claimedOrders.length}</span> orders
              </p>
              {claimedOrders.some(o => o.is_rush) && (
                <span className="text-xs bg-red-600 text-white font-bold px-2 py-0.5 rounded-full">RUSH</span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          {step === 'picking' && totalItems > 0 && (
            <div className="flex items-center gap-3">
              <div className="w-40 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-sm text-indigo-400 font-bold tabular-nums">{pickedItems}/{totalItems}</span>
            </div>
          )}
          {todayPickCount !== null && (
            <span className="hidden sm:inline text-sm text-gray-500">
              <span className="text-white font-bold">{todayPickCount}</span> picked today
            </span>
          )}
          <Link href="/hub" className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
            <LayoutGrid size={16} /> Switch task
          </Link>
          <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
            <LogOut size={16} /> Log out
          </button>
        </div>
      </div>

      {/* Hidden scan input (barcode gun target) */}
      <input
        ref={scanRef}
        value={scanInput}
        onChange={e => setScanInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
        className="opacity-0 absolute w-0 h-0"
        autoFocus
        autoComplete="off"
      />

      {showCamera && (
        <CameraScanner onScan={(barcode) => { setShowCamera(false); handleScan(barcode) }} onClose={() => setShowCamera(false)} />
      )}

      {/* Loading */}
      {loading && (
        <div className="flex-1 flex items-center justify-center text-gray-500">Loading...</div>
      )}

      {/* ── Step: scan_orders ─────────────────────────────────────────────────── */}
      {!loading && step === 'scan_orders' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top scan area */}
          <div className="flex flex-col items-center text-center gap-4 px-6 py-6 shrink-0">
            <div className="w-16 h-16 bg-indigo-900 rounded-2xl flex items-center justify-center">
              <Layers size={32} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-white mb-1">Build Your Batch</p>
              <p className="text-gray-400 text-sm max-w-xs">
                Add orders from the list below. Then tap "Start Picking."
              </p>
            </div>

            <ScanFeedback scan={lastScan} />

            <Link
              href="/pick"
              className="text-xs text-gray-400 hover:text-gray-300 underline transition-colors"
            >
              Single order mode
            </Link>
          </div>

          {/* Claimed batch + incoming orders */}
          <div className="flex-1 overflow-y-auto px-6 pb-6 border-t border-gray-800">
            <div className="max-w-lg mx-auto pt-4">

              {claimedOrders.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
                      Batch ({claimedOrders.length} {claimedOrders.length === 1 ? 'order' : 'orders'})
                    </p>
                    <button
                      onClick={() => setConfirmClearAll(true)}
                      className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} /> Clear All
                    </button>
                  </div>
                  <div className="space-y-2 mb-4">
                    {claimedOrders.map(order => (
                      <div key={order.id} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                        <CheckCircle size={16} className="text-indigo-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white">#{order.order_number}</span>
                            {order.customer_name && (
                              <span className="text-sm text-gray-400">{order.customer_name}</span>
                            )}
                            {order.is_rush && (
                              <span className="text-xs bg-red-600 text-white font-bold px-1.5 py-0.5 rounded-full">RUSH</span>
                            )}
                            {order.is_bulk && (
                              <span className="text-xs bg-orange-700 text-white font-bold px-1.5 py-0.5 rounded-full">BULK</span>
                            )}
                          </div>
                          {order.notes && (
                            <p className="text-xs text-yellow-400 mt-0.5 truncate">{order.notes}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleStartPicking}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-lg rounded-xl transition-colors mb-6"
                  >
                    Start Picking ({claimedOrders.length} {claimedOrders.length === 1 ? 'order' : 'orders'})
                  </button>
                </>
              )}

              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Incoming Orders {availableOrders.length > 0 && `(${availableOrders.length})`}
              </p>

              {loadingAvailable && availableOrders.length === 0 && (
                <p className="text-sm text-gray-500 py-4 text-center">Loading orders...</p>
              )}
              {!loadingAvailable && availableOrders.length === 0 && (
                <p className="text-sm text-gray-500 py-4 text-center">No orders waiting right now.</p>
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
                      onClick={() => addOrderToBatch(o)}
                      disabled={addingId !== null}
                      className="shrink-0 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-semibold text-sm"
                    >
                      {addingId === o.id ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: picking ─────────────────────────────────────────────────────── */}
      {!loading && step === 'picking' && (
        <div className="flex-1 flex overflow-hidden">

          {/* Left panel: order summary */}
          <div className="w-64 xl:w-72 border-r border-gray-800 flex flex-col bg-gray-900/20 shrink-0">
            <div className="px-4 py-4 border-b border-gray-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">{pickedItems}/{totalItems} items</span>
                <span className="text-xs font-bold text-indigo-400">{progressPct}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <div className="px-3 py-3 overflow-y-auto flex-1">
              <p className="text-xs text-gray-600 uppercase tracking-widest font-semibold px-1 mb-2">Orders</p>
              <div className="space-y-1.5 mb-4">
                {claimedOrders.map(order => {
                  const orderItems = items.filter(i => i.order_id === order.id)
                  const orderPicked = orderItems.reduce((s, i) => s + i.quantity_picked, 0)
                  const orderTotal = orderItems.reduce((s, i) => s + i.quantity_ordered, 0)
                  const orderDone = orderPicked >= orderTotal && orderTotal > 0
                  return (
                    <div key={order.id} className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${orderDone ? 'bg-green-950/40 border border-green-900/50' : 'bg-gray-800/50'}`}>
                      {orderDone
                        ? <CheckCircle size={14} className="text-green-400 shrink-0" />
                        : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-600 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-300">#{order.order_number}</p>
                        {order.is_rush && <p className="text-xs text-red-400 font-bold">RUSH</p>}
                      </div>
                      <span className="text-xs text-gray-500 tabular-nums">{orderPicked}/{orderTotal}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right panel: pick list by bin */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Scan bar */}
            <div className="px-6 py-3 border-b border-gray-800 bg-gray-900/30 shrink-0">
              <div className="flex gap-2">
                <input
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
                  disabled={scanning}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                  placeholder="Scan item barcode..."
                  autoComplete="off"
                />
                <button
                  onClick={() => setShowCamera(true)}
                  disabled={scanning}
                  className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-2.5 rounded-lg border border-gray-700 disabled:opacity-60"
                >
                  <Camera size={18} />
                </button>
                <button
                  onClick={() => handleScan(scanInput)}
                  disabled={scanning}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60 flex items-center gap-2"
                >
                  {scanning ? <Loader2 size={16} className="animate-spin" /> : 'Scan'}
                </button>
              </div>
              <ScanFeedback scan={lastScan} size="sm" />
              {lastAction && (
                <button
                  onClick={undoLastScan}
                  disabled={undoing}
                  className="mt-2.5 flex items-center gap-2 text-sm text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
                >
                  {undoing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                  Undo scan: {lastAction.item.products.name}
                </button>
              )}
            </div>

            {/* Pick list grouped by bin */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {completing && (
                <div className="flex items-center justify-center py-12 text-gray-500">
                  Completing all orders...
                </div>
              )}

              {!completing && binGroups.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <CheckCircle size={48} className="text-green-400" />
                  <p className="text-lg font-bold text-white">All items picked!</p>
                  <p className="text-gray-500 text-sm">Completing orders...</p>
                </div>
              )}

              {!completing && binGroups.map((group, gi) => (
                <div key={gi}>
                  {/* Bin header */}
                  <div className="flex items-center gap-3 mb-3">
                    <MapPin size={16} className="text-yellow-400 shrink-0" />
                    {group.bin ? (
                      <span className="text-2xl font-bold font-mono text-yellow-400">{group.bin}</span>
                    ) : (
                      <span className="text-lg font-bold text-gray-500">No bin assigned</span>
                    )}
                    <span className="text-xs text-gray-600 ml-auto">
                      {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>

                  {/* Items at this bin */}
                  <div className="space-y-2">
                    {group.items.map(item => (
                      <div key={item.id} className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                        <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                          {item.products.image_url
                            ? <img src={item.products.image_url} alt="" className="w-full h-full object-cover" />
                            : <Package size={16} className="text-gray-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white truncate">{item.products.name}</p>
                          <p className="text-xs text-gray-500 font-mono">{item.products.sku}</p>
                        </div>
                        {/* Order badge */}
                        <span className="text-xs bg-indigo-900 text-indigo-300 font-bold px-2 py-0.5 rounded-full shrink-0">
                          #{item.order_number}
                        </span>
                        {/* Quantity */}
                        <div className="text-right shrink-0">
                          <p className="text-2xl font-bold tabular-nums text-white leading-none">
                            {item.quantity_picked}
                          </p>
                          <p className="text-xs text-gray-500">/ {item.quantity_ordered}</p>
                        </div>
                        {/* Tap to mark picked */}
                        <button
                          onClick={() => markItemPickedManually(item)}
                          className="shrink-0 w-10 h-10 rounded-full border-2 border-gray-700 hover:border-indigo-500 hover:bg-indigo-900/30 flex items-center justify-center transition-colors"
                          title="Mark as picked"
                        >
                          <CheckCircle size={20} className="text-gray-600 hover:text-indigo-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Step: scan_to_rack ────────────────────────────────────────────────── */}
      {!loading && step === 'scan_to_rack' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
          <div className="w-20 h-20 bg-yellow-900 rounded-2xl flex items-center justify-center">
            <MapPin size={40} className="text-yellow-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white mb-2">Scan Rack Location</p>
            <p className="text-gray-400 max-w-sm">
              Scan the rack barcode where you're placing the{' '}
              <span className="text-white font-bold">{claimedOrders.length}</span>{' '}
              {claimedOrders.length === 1 ? 'order' : 'orders'}.
            </p>
            <p className="text-gray-500 text-sm mt-1">This lets the packer find them quickly.</p>
          </div>

          <ScanFeedback scan={lastScan} />

          <div className="flex gap-3">
            <button
              onClick={() => scanRef.current?.focus()}
              className="flex items-center gap-2 bg-yellow-600 hover:bg-yellow-500 text-white px-6 py-3 rounded-xl font-semibold"
            >
              <Scan size={18} /> Scan Rack
            </button>
            <button
              onClick={() => setShowCamera(true)}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-5 py-3 rounded-xl"
            >
              <Camera size={18} />
            </button>
          </div>
          <button
            onClick={() => setStep('complete')}
            className="text-xs text-gray-400 hover:text-gray-300 underline"
          >
            Skip - no rack barcode yet
          </button>
        </div>
      )}

      {/* ── Step: complete ────────────────────────────────────────────────────── */}
      {!loading && step === 'complete' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
          <div className="w-20 h-20 bg-green-900 rounded-2xl flex items-center justify-center">
            <CheckCircle size={40} className="text-green-400" />
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-2">All done!</p>
            <p className="text-gray-400 text-lg">
              <span className="text-white font-bold">{claimedOrders.length}</span>{' '}
              {claimedOrders.length === 1 ? 'order' : 'orders'} picked and racked.
            </p>
            <p className="text-gray-500 text-sm mt-2">Hand the order papers to the packer.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-center">
            {claimedOrders.map(o => (
              <span key={o.id} className="text-sm bg-green-950 border border-green-800 text-green-300 font-bold px-3 py-1.5 rounded-full">
                #{o.order_number}
              </span>
            ))}
          </div>
          <button
            onClick={resetBatch}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-xl font-bold text-lg"
          >
            <Layers size={20} /> Pick another batch
          </button>
        </div>
      )}
    </div>
  )
}
