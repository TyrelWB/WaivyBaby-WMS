'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseBarcode } from '@/lib/barcode'
import { playSuccess, playError } from '@/lib/feedback'
import { writeAudit } from '@/lib/audit'
import { Scan, CheckCircle, XCircle, Package, ShoppingBasket, LogOut, Camera, AlertTriangle, MapPin, SkipForward, Layers, Loader2, LayoutGrid, Undo2 } from 'lucide-react'
import CameraScanner from '@/components/CameraScanner'
import WorkerOnboarding from '@/components/WorkerOnboarding'
import ScanFeedback from '@/components/ScanFeedback'
import { useWorkerHeartbeat, ONLINE_WINDOW_MS } from '@/lib/presence'
import Link from 'next/link'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type Order = { id: string; order_number: string; customer_name: string | null; is_rush: boolean; is_bulk: boolean; notes: string | null; status: string }
type OrderItem = {
  id: string
  product_id: string
  quantity_ordered: number
  quantity_picked: number
  status: string
  bin_location: string | null
  products: { name: string; sku: string; image_url: string | null }
}
type SubComponent = { sub_product_id: string; quantity: number; name: string; sku: string; image_url: string | null }
type CollectionProduct = { product_id: string; name: string; sku: string; image_url: string | null; quantity: number; sub_products: SubComponent[] }
type BundleEntry = { type: 'bundle'; items: SubComponent[] }
type CollectionEntry = { type: 'collection'; products: CollectionProduct[] }
type ComponentMapEntry = BundleEntry | CollectionEntry
type ComponentMap = { [productId: string]: ComponentMapEntry }
type SubPickProgress = { [orderItemId: string]: { [subProductId: string]: number } }
type PickStep = 'scan_order' | 'picking' | 'complete' | 'scan_to_rack'
type AvailableOrder = { id: string; order_number: string; customer_name: string | null; is_rush: boolean; is_bulk: boolean; notes: string | null; created_at: string; item_count: number }

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  return `${hours}h`
}

function sortByBin(a: OrderItem, b: OrderItem) {
  if (!a.bin_location && !b.bin_location) return 0
  if (!a.bin_location) return 1
  if (!b.bin_location) return -1
  return a.bin_location.localeCompare(b.bin_location)
}

export default function PickPage() {
  const supabase = createClient()
  const scanRef = useRef<HTMLInputElement>(null)
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [step, setStep] = useState<PickStep>('scan_order')
  const [scanInput, setScanInput] = useState('')
  const [lastScan, setLastScan] = useState<{ result: 'success' | 'error' | 'warning'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCamera, setShowCamera] = useState(false)
  const [hardError, setHardError] = useState<{ message: string } | null>(null)
  const [shortPickItem, setShortPickItem] = useState<OrderItem | null>(null)
  const [shortPickQty, setShortPickQty] = useState(0)
  const [componentMap, setComponentMap] = useState<ComponentMap>({})
  const [subPickProgress, setSubPickProgress] = useState<SubPickProgress>({})
  const [skippedItemIds, setSkippedItemIds] = useState<Set<string>>(new Set())
  const [collectionIndex, setCollectionIndex] = useState<{ [orderItemId: string]: number }>({})
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<{ item: OrderItem; invId: string | null } | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [todayPickCount, setTodayPickCount] = useState<number | null>(null)

  // Derived: sorted items with skipped items moved to end
  const sortedItems = useMemo(() => {
    const nonSkipped = items.filter(i => !skippedItemIds.has(i.id)).sort(sortByBin)
    const skipped = items.filter(i => skippedItemIds.has(i.id)).sort(sortByBin)
    return [...nonSkipped, ...skipped]
  }, [items, skippedItemIds])

  const currentItem = sortedItems[0] ?? null
  const upNextItems = sortedItems.slice(1)

  useWorkerHeartbeat(worker?.workerId, 'pick')

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) {
          setWorker(session)
          fetchAssignedOrder(session)
          fetchTodayPickCount(session)
          const key = `wms_onboarded_${session.workerId}_${session.role}`
          if (!localStorage.getItem(key)) setShowOnboarding(true)
        } else setLoading(false)
      })
    scanRef.current?.focus()
  }, [])

  // Realtime: instant order push — replaces 30s polling
  useEffect(() => {
    if (!worker) return
    const channel = supabase
      .channel(`picker-${worker.workerId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `assigned_picker_id=eq.${worker.workerId}`,
      }, () => {
        setOrder(prev => { if (!prev) fetchAssignedOrder(worker); return prev })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [worker])

  // Incoming orders list: only relevant while the picker hasn't claimed anything yet.
  // If an admin assigns them an order directly, the effect above pulls them out of this step.
  useEffect(() => {
    if (!worker || step !== 'scan_order') return
    fetchAvailableOrders(worker)
    const channel = supabase
      .channel(`available-orders-${worker.orgId}`)
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

  async function claimOrderFromList(target: AvailableOrder) {
    if (!worker || claimingId) return
    setClaimingId(target.id)
    try {
      // Atomic claim: only succeeds if nobody grabbed it between the list render and this tap.
      const { data: claimed, error } = await supabase
        .from('orders')
        .update({ assigned_picker_id: worker.workerId, status: 'picking', pick_started_at: new Date().toISOString() } as any)
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
        changes: { assigned_picker_id: worker.workerId, status: 'picking' },
      })
      await fetch(`/api/orders/${claimed.id}/reserve`, { method: 'POST' })

      setOrder(claimed)
      await fetchItems(claimed.id, worker.orgId)
      playSuccess()
      setLastScan({ result: 'success', message: `Order #${claimed.order_number} claimed! Start picking.` })
      setStep('picking')
    } finally {
      setClaimingId(null)
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

  async function fetchAssignedOrder(session: WorkerSession) {
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, is_rush, is_bulk, notes, status')
      .eq('assigned_picker_id', session.workerId)
      .in('status', ['assigned', 'picking'])
      .order('is_rush', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (data) {
      setOrder(data)
      await fetchItems(data.id, session.orgId)
      setStep('picking')
    }
    // If no order found, stay on scan_order step
    setLoading(false)
  }

  async function fetchItems(orderId: string, orgId: string): Promise<OrderItem[]> {
    const { data } = await supabase
      .from('order_items')
      .select('id, product_id, quantity_ordered, quantity_picked, status, products(name, sku, image_url)')
      .eq('order_id', orderId)
      .not('status', 'eq', 'picked')

    const base = (data as unknown as Omit<OrderItem, 'bin_location'>[] | null) || []
    const productIds = base.map(i => i.product_id)

    const binMap: Record<string, string | null> = {}
    if (productIds.length > 0) {
      const { data: invData } = await supabase
        .from('inventory')
        .select('product_id, bins(location_code)')
        .in('product_id', productIds)
        .eq('org_id', orgId)
      for (const inv of invData || []) {
        binMap[inv.product_id] = (inv as any).bins?.location_code || null
      }
    }

    // products can come back null if the item's product_id is orphaned (deleted product,
    // bad data, etc.) — guard here so every downstream render can trust item.products exists.
    const result: OrderItem[] = base.map(i => ({
      ...i,
      products: i.products || { name: 'Unknown product', sku: '—', image_url: null },
      bin_location: binMap[i.product_id] || null,
    }))
    setItems(result)

    const res = await fetch(`/api/orders/${orderId}/pick-components`)
    if (res.ok) setComponentMap(await res.json())

    return result
  }

  function dismissOnboarding() {
    if (!worker) return
    localStorage.setItem(`wms_onboarded_${worker.workerId}_${worker.role}`, '1')
    setShowOnboarding(false)
  }

  // Decide what happens to the order the moment picking finishes:
  // - someone else is actively on the pack screen right now -> push it straight to them
  // - nobody else is packing -> route it back to this same worker so they can pack it themselves
  // Returns true if the order was routed to this worker (caller should jump into packing).
  async function autoRoutePacking(orderId: string): Promise<boolean> {
    if (!worker) return false
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString()
    const { data: onlinePackers } = await supabase
      .from('workers')
      .select('id')
      .eq('org_id', worker.orgId)
      .eq('active_task', 'pack')
      .neq('id', worker.workerId)
      .gt('last_active_at', cutoff)
      .limit(1)

    if (onlinePackers && onlinePackers.length > 0) {
      await supabase.from('orders').update({ assigned_packer_id: onlinePackers[0].id }).eq('id', orderId)
      return false
    }

    await supabase.from('orders').update({ assigned_packer_id: worker.workerId }).eq('id', orderId)
    return true
  }

  async function completeOrder() {
    if (!order || !worker) return
    await supabase.from('orders').update({
      status: 'picked',
      pick_completed_at: new Date().toISOString(),
    } as any).eq('id', order.id)
    fetchTodayPickCount(worker)

    const routedToSelf = await autoRoutePacking(order.id)
    if (routedToSelf) {
      // Nobody else is packing right now - go straight into packing this same order.
      window.location.href = '/pack'
      return
    }
    setStep('scan_to_rack')
  }

  function skipItem(item: OrderItem) {
    // If all remaining items are already skipped, un-skip everything instead of looping forever
    const willBeAllSkipped = sortedItems.every(i => i.id === item.id || skippedItemIds.has(i.id))
    if (willBeAllSkipped) {
      setSkippedItemIds(new Set())
      setLastScan({ result: 'warning', message: `Can't skip — ${item.products.name} is the last item.` })
      return
    }
    setSkippedItemIds(prev => new Set([...prev, item.id]))
    setLastScan({ result: 'warning', message: `Skipped ${item.products.name} — moved to end` })
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

  async function handleSubProductScan(subProductId: string, bundleItem: OrderItem, raw: string, subProducts: SubComponent[]) {
    if (!worker || !order) return
    setLastAction(null)
    const component = subProducts.find(c => c.sub_product_id === subProductId)
    if (!component) return

    const progress = subPickProgress[bundleItem.id] || {}
    const currentCount = progress[subProductId] || 0
    const totalRequired = component.quantity * bundleItem.quantity_ordered

    if (currentCount >= totalRequired) {
      playError()
      setLastScan({ result: 'warning', message: `${component.name} already fully picked.` })
      return
    }

    const newItemProgress = { ...progress, [subProductId]: currentCount + 1 }
    const newSubPick = { ...subPickProgress, [bundleItem.id]: newItemProgress }
    setSubPickProgress(newSubPick)

    const { data: inv } = await supabase.from('inventory').select('id, qty_reserved, qty_picked').eq('product_id', subProductId).eq('org_id', worker.orgId).single()
    if (inv) {
      await supabase.from('inventory').update({ qty_reserved: Math.max(0, inv.qty_reserved - 1), qty_picked: inv.qty_picked + 1 }).eq('id', inv.id)
    }

    const bundleComplete = subProducts.every(c => (newItemProgress[c.sub_product_id] || 0) >= c.quantity * bundleItem.quantity_ordered)

    if (bundleComplete) {
      await supabase.from('order_items').update({ quantity_picked: bundleItem.quantity_ordered, status: 'picked' }).eq('id', bundleItem.id)
      playSuccess()
      setLastScan({ result: 'success', message: `✓ ${bundleItem.products.name} complete!` })
      if (skippedItemIds.has(bundleItem.id)) setSkippedItemIds(prev => { const n = new Set(prev); n.delete(bundleItem.id); return n })
      const remaining = items.filter(i => i.id !== bundleItem.id)
      setItems(remaining)
      if (remaining.length === 0) await completeOrder()
    } else {
      const totalPicked = Object.values(newItemProgress).reduce((a, b) => a + (b as number), 0)
      const totalNeeded = subProducts.reduce((a, c) => a + c.quantity * bundleItem.quantity_ordered, 0)
      playSuccess()
      setLastScan({ result: 'success', message: `✓ ${component.name} (${totalPicked}/${totalNeeded} items)` })
    }

    await logScan(raw, 'product', 'pick', 'success', null)
  }

  async function handleCollectionSubProductScan(subProductId: string, collectionItem: OrderItem, raw: string) {
    if (!worker || !order) return
    setLastAction(null)
    const entry = componentMap[collectionItem.product_id]
    if (!entry || entry.type !== 'collection') return

    const currentIdx = collectionIndex[collectionItem.id] || 0
    const currentProduct = entry.products[currentIdx]
    if (!currentProduct) return

    // Check if this sub-product belongs to the current product
    const belongsToCurrent = currentProduct.sub_products.some(s => s.sub_product_id === subProductId)
    if (!belongsToCurrent) {
      // Check if it belongs to a future product in the collection
      const futureProduct = entry.products.slice(currentIdx + 1).find(p => p.sub_products.some(s => s.sub_product_id === subProductId))
      if (futureProduct) {
        playError()
        setLastScan({ result: 'error', message: `Finish "${currentProduct.name}" first before scanning items from "${futureProduct.name}".` })
      } else {
        playError()
        setLastScan({ result: 'error', message: `Item not found in current product. Scan items from "${currentProduct.name}".` })
      }
      return
    }

    const component = currentProduct.sub_products.find(s => s.sub_product_id === subProductId)!
    const progress = subPickProgress[collectionItem.id] || {}
    const currentCount = progress[subProductId] || 0
    const totalRequired = component.quantity * collectionItem.quantity_ordered

    if (currentCount >= totalRequired) {
      playError()
      setLastScan({ result: 'warning', message: `${component.name} already fully picked.` })
      return
    }

    const newProgress = { ...progress, [subProductId]: currentCount + 1 }
    setSubPickProgress({ ...subPickProgress, [collectionItem.id]: newProgress })

    const { data: inv } = await supabase.from('inventory').select('id, qty_reserved, qty_picked').eq('product_id', subProductId).eq('org_id', worker.orgId).single()
    if (inv) {
      await supabase.from('inventory').update({ qty_reserved: Math.max(0, inv.qty_reserved - 1), qty_picked: inv.qty_picked + 1 }).eq('id', inv.id)
    }

    const currentProductDone = currentProduct.sub_products.every(s => (newProgress[s.sub_product_id] || 0) >= s.quantity * collectionItem.quantity_ordered)

    if (currentProductDone) {
      const isLastProduct = currentIdx >= entry.products.length - 1
      if (isLastProduct) {
        // All products in collection done
        await supabase.from('order_items').update({ quantity_picked: collectionItem.quantity_ordered, status: 'picked' }).eq('id', collectionItem.id)
        playSuccess()
        setLastScan({ result: 'success', message: `✓ ${collectionItem.products.name} collection complete!` })
        const remaining = items.filter(i => i.id !== collectionItem.id)
        setItems(remaining)
        if (remaining.length === 0) await completeOrder()
      } else {
        // Advance to next product in collection
        const nextIdx = currentIdx + 1
        setCollectionIndex(prev => ({ ...prev, [collectionItem.id]: nextIdx }))
        const nextProduct = entry.products[nextIdx]
        playSuccess()
        setLastScan({ result: 'success', message: `✓ "${currentProduct.name}" done! Now pick: ${nextProduct.name} (${nextIdx + 1}/${entry.products.length})` })
      }
    } else {
      const totalPicked = currentProduct.sub_products.reduce((a, s) => a + (newProgress[s.sub_product_id] || 0), 0)
      const totalNeeded = currentProduct.sub_products.reduce((a, s) => a + s.quantity * collectionItem.quantity_ordered, 0)
      playSuccess()
      setLastScan({ result: 'success', message: `✓ ${component.name} (${totalPicked}/${totalNeeded} in ${currentProduct.name})` })
    }

    await logScan(raw, 'product', 'pick', 'success', null)
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
        description: `Unknown barcode scanned during picking: ${parsed.raw}`, status: 'open',
      })
      await logScan(parsed.raw, 'unknown', 'pick', 'error', 'Barcode not found in system')
      return
    }

    // Collection: check if this sub-product belongs to any collection item
    const collectionItem = items.find(i => {
      const entry = componentMap[i.product_id]
      return entry?.type === 'collection' && entry.products.some(p => p.sub_products.some(s => s.sub_product_id === productBarcode.product_id))
    })
    if (collectionItem) { await handleCollectionSubProductScan(productBarcode.product_id, collectionItem, parsed.raw); return }

    // Bundle: check if this sub-product belongs to any bundle item
    const bundleItem = items.find(i => {
      const entry = componentMap[i.product_id]
      return entry?.type === 'bundle' && entry.items.some(c => c.sub_product_id === productBarcode.product_id)
    })
    if (bundleItem) {
      const entry = componentMap[bundleItem.product_id] as BundleEntry
      await handleSubProductScan(productBarcode.product_id, bundleItem, parsed.raw, entry.items)
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
          org_id: worker.orgId, order_id: order.id, worker_id: worker.workerId,
          type: 'wrong_item', severity: 'hard',
          description: `Wrong item scanned: barcode ${parsed.raw} is not on this order`, status: 'open',
        })
        await logScan(parsed.raw, 'product', 'pick', 'error', 'Item not on order')
      }
      return
    }

    const newQty = item.quantity_picked + 1
    const done = newQty >= item.quantity_ordered
    const preScanSnapshot = { ...item }

    await supabase.from('order_items').update({ quantity_picked: newQty, status: done ? 'picked' : 'pending' }).eq('id', item.id)

    const { data: inv } = await supabase.from('inventory').select('id, qty_reserved, qty_picked').eq('product_id', item.product_id).eq('org_id', worker.orgId).single()
    if (inv) {
      await supabase.from('inventory').update({ qty_reserved: Math.max(0, inv.qty_reserved - 1), qty_picked: inv.qty_picked + 1 }).eq('id', inv.id)
      await writeAudit(supabase, {
        orgId: worker.orgId, workerId: worker.workerId,
        action: 'item_picked', entityType: 'inventory', entityId: inv.id,
        changes: { product: item.products.name, qty_picked: inv.qty_picked + 1 },
        note: `Picked for order #${order.order_number}`,
      })
    }

    await logScan(parsed.raw, 'product', 'pick', 'success', null)
    playSuccess()
    setLastScan({ result: 'success', message: `✓ ${item.products.name} (${newQty}/${item.quantity_ordered})` })
    setLastAction({ item: preScanSnapshot, invId: inv?.id ?? null })

    if (skippedItemIds.has(item.id)) setSkippedItemIds(prev => { const n = new Set(prev); n.delete(item.id); return n })

    const updatedItems = items.map(i => i.id === item.id ? { ...i, quantity_picked: newQty, status: done ? 'picked' : 'pending' } : i)
    const remaining = updatedItems.filter(i => i.status !== 'picked')
    setItems(remaining)

    if (remaining.length === 0) {
      await writeAudit(supabase, {
        orgId: worker.orgId, workerId: worker.workerId,
        action: 'order_status_changed', entityType: 'order', entityId: order.id,
        changes: { status: 'picked' },
      })
      await completeOrder()
    }
  }

  // Reverts the single most recent plain-item scan (barcode gun double-fires are common).
  // Only covers the simple per-unit scan path — bundle/collection sub-picks and short
  // picks clear lastAction instead of setting it, since their state is too tangled to
  // safely reconstruct with a single snapshot.
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

  async function confirmShortPick() {
    setLastAction(null)
    if (!shortPickItem || !worker || !order) return
    const short = shortPickItem.quantity_ordered - shortPickQty

    await supabase.from('order_items').update({ quantity_short: short, quantity_picked: shortPickQty, status: 'short' }).eq('id', shortPickItem.id)
    await supabase.from('exceptions').insert({
      org_id: worker.orgId, order_id: order.id, worker_id: worker.workerId,
      type: 'short_pick', severity: 'soft',
      description: `Short pick: ${shortPickItem.products.name} — found ${shortPickQty} of ${shortPickItem.quantity_ordered}`,
      status: 'open',
    })

    const { data: inv } = await supabase.from('inventory').select('id, qty_reserved, qty_available, qty_picked').eq('product_id', shortPickItem.product_id).eq('org_id', worker.orgId).single()
    if (inv && short > 0) {
      await supabase.from('inventory').update({
        qty_reserved: Math.max(0, inv.qty_reserved - short),
        qty_available: inv.qty_available + short,
        qty_picked: inv.qty_picked + shortPickQty,
      }).eq('id', inv.id)
    }

    playError()
    if (skippedItemIds.has(shortPickItem.id)) setSkippedItemIds(prev => { const n = new Set(prev); n.delete(shortPickItem.id); return n })
    const remaining = items.filter(i => i.id !== shortPickItem.id)
    setItems(remaining)
    setShortPickItem(null)
    setLastScan({ result: 'warning', message: `Short pick: ${shortPickItem.products.name} (found ${shortPickQty}/${shortPickItem.quantity_ordered})` })

    if (remaining.length === 0) await completeOrder()
    scanRef.current?.focus()
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

  const totalItems = items.reduce((s, i) => s + i.quantity_ordered, 0)
  const pickedItems = items.reduce((s, i) => s + i.quantity_picked, 0)
  const progressPct = totalItems ? Math.round((pickedItems / totalItems) * 100) : 0

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

      {/* Short pick modal */}
      {shortPickItem && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm">
            <p className="text-lg font-bold text-white mb-1">Short Pick</p>
            <p className="text-gray-400 text-sm mb-5">{shortPickItem.products.name}</p>
            <div className="flex items-center gap-3 mb-6">
              <label className="text-gray-400 text-sm shrink-0">Found:</label>
              <input
                type="number" min={0} max={shortPickItem.quantity_ordered - 1}
                value={shortPickQty}
                onChange={e => setShortPickQty(Math.min(shortPickItem.quantity_ordered - 1, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-24 bg-gray-800 border border-gray-600 rounded-lg px-3 py-3 text-white text-center text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
                autoFocus
              />
              <span className="text-gray-400 text-lg">/ {shortPickItem.quantity_ordered}</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShortPickItem(null); scanRef.current?.focus() }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl font-semibold">Cancel</button>
              <button onClick={confirmShortPick} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-3 rounded-xl font-semibold">Confirm Short</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 bg-blue-900 rounded-lg flex items-center justify-center shrink-0">
            <ShoppingBasket size={18} className="text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white truncate">{worker?.name || 'Worker'}</p>
            <p className="text-xs text-gray-500 capitalize">{worker?.role}</p>
          </div>
          {order && step === 'picking' && (
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
          {order && step === 'picking' && (
            <div className="flex items-center gap-3">
              <div className="w-40 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-sm text-blue-400 font-bold tabular-nums">{pickedItems}/{totalItems}</span>
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
      <input ref={scanRef} value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }} className="opacity-0 absolute w-0 h-0" autoFocus autoComplete="off" />

      {showCamera && <CameraScanner onScan={(barcode) => { setShowCamera(false); handleScan(barcode) }} onClose={() => setShowCamera(false)} />}

      {/* Loading */}
      {loading && <div className="flex-1 flex items-center justify-center text-gray-500">Loading your orders...</div>}

      {/* Scan order paper + incoming orders list */}
      {!loading && step === 'scan_order' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex flex-col items-center text-center gap-4 px-4 py-6 shrink-0">
            <div className="w-16 h-16 bg-blue-900 rounded-2xl flex items-center justify-center">
              <ShoppingBasket size={32} className="text-blue-400" />
            </div>
            <div className="max-w-lg w-full">
              <p className="text-xl font-bold text-white mb-1">Get an Order</p>
              <p className="text-gray-400 text-sm max-w-xs mx-auto">Pick one from the list below.</p>
            </div>
            <ScanFeedback scan={lastScan} />
            <Link
              href="/pick/batch"
              className="flex items-center justify-center gap-2 w-full max-w-lg bg-gray-800 hover:bg-gray-700 text-gray-200 px-6 py-3 rounded-xl font-semibold transition-colors"
            >
              <Layers size={18} /> Batch mode - pick multiple orders
            </Link>
          </div>

          {/* Incoming orders */}
          <div className="flex-1 overflow-y-auto px-4 pb-6 border-t border-gray-800">
            <div className="max-w-lg mx-auto pt-4">
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
                      onClick={() => claimOrderFromList(o)}
                      disabled={claimingId !== null}
                      className="shrink-0 flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-semibold text-sm"
                    >
                      {claimingId === o.id ? <Loader2 size={16} className="animate-spin" /> : 'Pick This'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scan basket */}
      {/* Scan to rack */}
      {!loading && order && step === 'scan_to_rack' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 px-4">
          <div className="w-20 h-20 bg-yellow-900 rounded-2xl flex items-center justify-center">
            <MapPin size={40} className="text-yellow-400" />
          </div>
          <div className="max-w-lg w-full">
            <p className="text-2xl font-bold text-white mb-2">Scan Rack Location</p>
            <p className="text-gray-400">Scan the rack barcode where you're placing order #{order.order_number}.</p>
            <p className="text-gray-500 text-sm mt-1">This lets the packer find it quickly.</p>
          </div>
          <ScanFeedback scan={lastScan} />
          <div className="flex gap-3 w-full max-w-lg">
            <button onClick={() => scanRef.current?.focus()} className="flex-1 flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-500 text-white px-6 py-4 rounded-xl font-semibold text-lg">
              <Scan size={20} /> Scan Rack
            </button>
            <button onClick={() => setShowCamera(true)} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-5 py-4 rounded-xl">
              <Camera size={20} />
            </button>
          </div>
          <button onClick={() => setStep('complete')} className="text-sm text-gray-400 hover:text-gray-300 underline">
            Skip - no rack barcode yet
          </button>
        </div>
      )}

      {/* Complete */}
      {!loading && order && step === 'complete' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
          <div className="w-20 h-20 bg-green-900 rounded-2xl flex items-center justify-center">
            <CheckCircle size={40} className="text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white mb-2">Pick Complete!</p>
            <p className="text-gray-400">Order #{order.order_number} is fully picked.</p>
            <p className="text-gray-400 mt-1">Hand the paper to the packer.</p>
          </div>
        </div>
      )}

      {/* Picking — two-column desktop layout, single column on mobile */}
      {!loading && order && step === 'picking' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

          {/* Left panel: order info + queue */}
          <div className="md:w-72 xl:w-80 border-b md:border-b-0 md:border-r border-gray-800 flex flex-col bg-gray-900/20 md:shrink-0 max-h-48 md:max-h-none">
            <div className="px-4 py-4 border-b border-gray-800">
              {order.notes && (
                <div className="flex items-start gap-1.5 mb-3 bg-yellow-950 rounded px-2.5 py-2">
                  <AlertTriangle size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-300">{order.notes}</p>
                </div>
              )}
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">{pickedItems}/{totalItems} items picked</span>
                <span className="text-xs font-bold text-blue-400">{progressPct}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <div className="px-3 py-3 flex-1 overflow-y-auto">
              <p className="text-xs text-gray-600 uppercase tracking-widest font-semibold px-1 mb-2">
                {upNextItems.length > 0 ? `Up Next (${upNextItems.length})` : 'Last Item'}
              </p>
              <div className="space-y-1.5">
                {upNextItems.map(item => {
                  const isSkipped = skippedItemIds.has(item.id)
                  return (
                    <div key={item.id} className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 ${isSkipped ? 'bg-orange-950/30 border border-orange-900/50' : 'bg-gray-800/50'}`}>
                      <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center shrink-0 overflow-hidden">
                        {item.products.image_url
                          ? <img src={item.products.image_url} alt="" className="w-full h-full object-cover" />
                          : <Package size={12} className="text-gray-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-300 truncate">{item.products.name}</p>
                        {item.bin_location
                          ? <p className="text-xs text-yellow-600 font-mono">{item.bin_location}</p>
                          : <p className="text-xs text-gray-400">No bin</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold text-gray-400 tabular-nums">{item.quantity_picked}/{item.quantity_ordered}</p>
                        {isSkipped && <p className="text-xs text-orange-500">skip</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right panel: scan + current item */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Scan bar */}
            <div className="px-4 sm:px-6 py-3 border-b border-gray-800 bg-gray-900/30 shrink-0">
              <div className="flex gap-2">
                <input
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
                  disabled={scanning}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-4 text-lg text-center text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  placeholder="Scan or type..."
                  autoComplete="off"
                />
                <button onClick={() => setShowCamera(true)} disabled={scanning} className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-4 rounded-lg border border-gray-700 disabled:opacity-60">
                  <Camera size={20} />
                </button>
                <button onClick={() => handleScan(scanInput)} disabled={scanning} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-4 rounded-lg text-lg font-semibold disabled:opacity-60 flex items-center gap-2">
                  {scanning ? <Loader2 size={20} className="animate-spin" /> : 'Scan'}
                </button>
              </div>
              <ScanFeedback scan={lastScan} size="sm" />
            </div>

            {/* Current item */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col items-center gap-2">
              {/* Mobile reprint link */}
              <div className="flex sm:hidden items-center justify-between w-full max-w-xl mb-1">
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
              {currentItem && (() => {
                const entry = componentMap[currentItem.product_id]
                const isBundle = entry?.type === 'bundle'
                const isCollection = entry?.type === 'collection'
                const progress = subPickProgress[currentItem.id] || {}
                const isSkipped = skippedItemIds.has(currentItem.id)

                // Collection helpers
                const currentColIdx = collectionIndex[currentItem.id] || 0
                const collectionProducts = isCollection ? (entry as CollectionEntry).products : []
                const currentColProduct = collectionProducts[currentColIdx] ?? null

                return (
                  <div className={`w-full max-w-xl rounded-2xl border-2 p-6 ${isSkipped ? 'border-orange-700 bg-orange-950/30' : isCollection ? 'border-indigo-500 bg-gray-900' : 'border-blue-600 bg-gray-900'}`}>
                    <div className="flex items-center justify-between mb-5">
                      <span className={`text-xs font-bold tracking-widest uppercase ${isSkipped ? 'text-orange-400' : isCollection ? 'text-indigo-400' : 'text-blue-400'}`}>
                        {isSkipped ? 'SKIPPED — COME BACK' : isCollection ? `COLLECTION — PRODUCT ${currentColIdx + 1} OF ${collectionProducts.length}` : 'NOW PICKING'}
                      </span>
                      {isBundle && <span className="text-xs bg-purple-900 text-purple-300 font-bold px-2.5 py-1 rounded-full">BUNDLE</span>}
                      {isCollection && <span className="text-xs bg-indigo-900 text-indigo-300 font-bold px-2.5 py-1 rounded-full">COLLECTION</span>}
                    </div>

                    {/* Collection: show collection name + current product */}
                    {isCollection && currentColProduct ? (
                      <>
                        <p className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-3">{currentItem.products.name}</p>

                        {/* Collection product progress dots */}
                        <div className="flex gap-2 mb-5">
                          {collectionProducts.map((p, idx) => {
                            const productDone = p.sub_products.every(s => (progress[s.sub_product_id] || 0) >= s.quantity * currentItem.quantity_ordered)
                            return (
                              <div key={p.product_id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${idx === currentColIdx ? 'bg-indigo-600 border-indigo-500 text-white' : productDone ? 'bg-green-950 border-green-700 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                                {productDone ? <CheckCircle size={11} /> : null}
                                {p.name}
                              </div>
                            )
                          })}
                        </div>

                        {/* Current collection product */}
                        <div className="flex items-start gap-4 mb-5 bg-gray-800 rounded-xl p-4">
                          <div className="w-20 h-20 bg-gray-700 rounded-xl overflow-hidden shrink-0 flex items-center justify-center">
                            {currentColProduct.image_url
                              ? <img src={currentColProduct.image_url} alt="" className="w-full h-full object-cover" />
                              : <Package size={28} className="text-gray-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xl font-bold text-white leading-tight mb-0.5">{currentColProduct.name}</p>
                            <p className="text-xs text-gray-500 font-mono mb-2">{currentColProduct.sku}</p>
                            <p className="text-xs text-indigo-400 font-semibold">
                              {currentColProduct.sub_products.filter(s => (progress[s.sub_product_id] || 0) >= s.quantity * currentItem.quantity_ordered).length}
                              /{currentColProduct.sub_products.length} items picked
                            </p>
                          </div>
                        </div>

                        {/* Sub-products for current collection product */}
                        <div className="space-y-2 mb-5">
                          {currentColProduct.sub_products.map(c => {
                            const picked = progress[c.sub_product_id] || 0
                            const required = c.quantity * currentItem.quantity_ordered
                            const done = picked >= required
                            return (
                              <div key={c.sub_product_id} className={`flex items-center justify-between px-4 py-3 rounded-xl ${done ? 'bg-green-950 border border-green-800' : 'bg-gray-800'}`}>
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-gray-700 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                                    {c.image_url
                                      ? <img src={c.image_url} alt="" className="w-full h-full object-cover" />
                                      : <Package size={14} className="text-gray-500" />}
                                  </div>
                                  {done ? <CheckCircle size={16} className="text-green-400 shrink-0" /> : <div className="w-4 h-4 rounded-full border-2 border-gray-600 shrink-0" />}
                                  <div>
                                    <p className={`text-sm font-medium ${done ? 'text-green-400' : 'text-white'}`}>{c.name}</p>
                                    <p className="text-xs text-gray-500 font-mono">{c.sku}</p>
                                  </div>
                                </div>
                                <p className={`text-lg font-bold tabular-nums ${done ? 'text-green-400' : 'text-white'}`}>{picked}/{required}</p>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-start gap-6 mb-5">
                          <div className="w-32 h-32 bg-gray-800 rounded-xl flex items-center justify-center shrink-0 overflow-hidden">
                            {currentItem.products.image_url
                              ? <img src={currentItem.products.image_url} alt="" className="w-full h-full object-cover" />
                              : <Package size={40} className="text-gray-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-2xl font-bold text-white leading-tight mb-1">{currentItem.products.name}</p>
                            <p className="text-sm text-gray-500 font-mono mb-3">{currentItem.products.sku}</p>
                            {currentItem.bin_location ? (
                              <div className="flex items-center gap-2">
                                <MapPin size={16} className="text-yellow-400 shrink-0" />
                                <span className="text-2xl font-bold text-yellow-400 font-mono">{currentItem.bin_location}</span>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-600">No bin assigned</p>
                            )}
                          </div>
                          {!isBundle && (
                            <div className="text-right shrink-0">
                              <p className="text-6xl font-bold tabular-nums text-white leading-none">{currentItem.quantity_picked}</p>
                              <p className="text-lg text-gray-500 mt-1">/ {currentItem.quantity_ordered}</p>
                            </div>
                          )}
                        </div>

                        {/* Bundle sub-products */}
                        {isBundle && (
                          <div className="space-y-2 mb-5">
                            {(entry as BundleEntry).items.map(c => {
                              const picked = progress[c.sub_product_id] || 0
                              const required = c.quantity * currentItem.quantity_ordered
                              const done = picked >= required
                              return (
                                <div key={c.sub_product_id} className={`flex items-center justify-between px-4 py-3 rounded-xl ${done ? 'bg-green-950 border border-green-800' : 'bg-gray-800'}`}>
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gray-700 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                                      {c.image_url
                                        ? <img src={c.image_url} alt="" className="w-full h-full object-cover" />
                                        : <Package size={16} className="text-gray-500" />}
                                    </div>
                                    {done ? <CheckCircle size={16} className="text-green-400 shrink-0" /> : <div className="w-4 h-4 rounded-full border-2 border-gray-600 shrink-0" />}
                                    <div>
                                      <p className={`text-sm font-medium ${done ? 'text-green-400' : 'text-white'}`}>{c.name}</p>
                                      <p className="text-xs text-gray-500 font-mono">{c.sku}</p>
                                    </div>
                                  </div>
                                  <p className={`text-lg font-bold tabular-nums ${done ? 'text-green-400' : 'text-white'}`}>{picked}/{required}</p>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}

                    {/* Actions */}
                    {!isCollection && (
                      <div className="flex gap-3">
                        {!isBundle && (
                          <button
                            onClick={() => { setShortPickItem(currentItem); setShortPickQty(currentItem.quantity_picked) }}
                            className="flex-1 py-4 bg-gray-800 hover:bg-gray-700 text-orange-400 font-semibold rounded-xl text-lg"
                          >
                            Short Pick
                          </button>
                        )}
                        <button
                          onClick={() => skipItem(currentItem)}
                          className="flex-1 flex items-center justify-center gap-2 py-4 bg-gray-800 hover:bg-gray-700 text-gray-400 font-semibold rounded-xl text-lg"
                        >
                          <SkipForward size={18} /> Skip
                        </button>
                      </div>
                    )}

                    {lastAction && (
                      <button
                        onClick={undoLastScan}
                        disabled={undoing}
                        className="w-full mt-3 py-2.5 flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
                      >
                        {undoing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                        Undo scan: {lastAction.item.products.name}
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
