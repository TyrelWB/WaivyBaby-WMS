'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { playSuccess, playError } from '@/lib/feedback'
import { writeAudit } from '@/lib/audit'
import {
  CheckCircle, LogOut, MapPin, Truck, Hash, AlertTriangle,
  Box, ChevronRight, Package, ArrowLeft, XCircle,
  Tag, ExternalLink, Loader2
} from 'lucide-react'
import WorkerOnboarding from '@/components/WorkerOnboarding'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type Order = {
  id: string
  order_number: string
  customer_name: string | null
  is_rush: boolean
  notes: string | null
  total_boxes: number | null
  carrier: string | null
  tracking_number: string | null
  shipping_name: string | null
  shipping_address_1: string | null
  shipping_address_2: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_zip: string | null
  shipping_country: string | null
  current_location: string | null
}
type AvailableOrder = { id: string; order_number: string; customer_name: string | null; is_rush: boolean; notes: string | null; created_at: string; item_count: number }
type ShipStep = 'scan_order' | 'ready'

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  return `${hours}h`
}

export default function ShipPage() {
  const supabase = createClient()
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [boxCount, setBoxCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)
  const [step, setStep] = useState<ShipStep>('scan_order')
  const [lastScan, setLastScan] = useState<{ result: 'success' | 'error' | 'warning'; message: string } | null>(null)
  const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)

  const [showOnboarding, setShowOnboarding] = useState(false)

  // ShipStation state
  const [ssConfigured, setSsConfigured] = useState(false)
  const [weightOz, setWeightOz] = useState('')
  const [rates, setRates] = useState<any[] | null>(null)
  const [selectedRate, setSelectedRate] = useState<any | null>(null)
  const [fetchingRates, setFetchingRates] = useState(false)
  const [creatingLabel, setCreatingLabel] = useState(false)
  const [labelUrl, setLabelUrl] = useState<string | null>(null)

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
    fetch('/api/integrations')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.shipstation?.configured) setSsConfigured(true) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!worker) return
    const channel = supabase
      .channel(`shipper-${worker.workerId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `status=eq.packed` },
        () => { setOrder(prev => { if (!prev) fetchAssignedOrder(worker); return prev }) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `assigned_shipper_id=eq.${worker.workerId}` },
        () => { setOrder(prev => { if (!prev) fetchAssignedOrder(worker); return prev }) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [worker])

  async function fetchAssignedOrder(session: WorkerSession) {
    const fields = 'id, order_number, customer_name, is_rush, notes, total_boxes, carrier, tracking_number, shipping_name, shipping_address_1, shipping_address_2, shipping_city, shipping_state, shipping_zip, shipping_country, current_location'

    const { data } = await supabase
      .from('orders').select(fields)
      .eq('assigned_shipper_id', session.workerId)
      .in('status', ['packed', 'shipping'])
      .order('is_rush', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1).single()

    if (data) {
      setOrder(data as Order)
      setStep('ready')
      const { count } = await supabase.from('boxes').select('id', { count: 'exact', head: true }).eq('order_id', data.id)
      setBoxCount(count || data.total_boxes || 1)
    }
    // If no order found, stay on scan_order step
    setLoading(false)
  }

  function dismissOnboarding() {
    if (!worker) return
    localStorage.setItem(`wms_onboarded_${worker.workerId}_${worker.role}`, '1')
    setShowOnboarding(false)
  }

  function resetSsState() {
    setWeightOz('')
    setRates(null)
    setSelectedRate(null)
    setLabelUrl(null)
  }

  async function fetchRates() {
    if (!order || !weightOz) return
    setFetchingRates(true)
    setRates(null)
    setSelectedRate(null)
    try {
      const res = await fetch('/api/integrations/shipstation/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, weightOz: parseFloat(weightOz) }),
      })
      const data = await res.json()
      if (res.ok && data.rates) {
        setRates(data.rates)
        if (data.rates.length > 0) setSelectedRate(data.rates[0])
      } else {
        setRates([])
      }
    } catch {
      setRates([])
    } finally {
      setFetchingRates(false)
    }
  }

  async function createLabel() {
    if (!order || !selectedRate) return
    setCreatingLabel(true)
    try {
      const res = await fetch('/api/integrations/shipstation/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, carrierCode: selectedRate.carrierCode, serviceCode: selectedRate.serviceCode }),
      })
      const data = await res.json()
      if (res.ok && data.labelUrl) {
        setLabelUrl(data.labelUrl)
        // Refresh order to pick up tracking number now set on the order
        const fields = 'id, order_number, customer_name, is_rush, notes, total_boxes, carrier, tracking_number, shipping_name, shipping_address_1, shipping_address_2, shipping_city, shipping_state, shipping_zip, shipping_country, current_location'
        const { data: refreshed } = await supabase.from('orders').select(fields).eq('id', order.id).single()
        if (refreshed) setOrder(refreshed as Order)
        playSuccess()
      }
    } catch {
      // silently fail — worker can retry
    } finally {
      setCreatingLabel(false)
    }
  }

  // Incoming orders list: workers tap to claim instead of scanning an order paper.
  useEffect(() => {
    if (!worker || step !== 'scan_order') return
    fetchAvailableOrders(worker)
    const channel = supabase
      .channel(`available-orders-ship-${worker.orgId}`)
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
      .select('id, order_number, customer_name, is_rush, notes, created_at')
      .eq('org_id', session.orgId)
      .eq('status', 'packed')
      .is('assigned_shipper_id', null)
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
      const fields = 'id, order_number, customer_name, is_rush, notes, total_boxes, carrier, tracking_number, shipping_name, shipping_address_1, shipping_address_2, shipping_city, shipping_state, shipping_zip, shipping_country, current_location'
      const { data: claimed, error } = await supabase
        .from('orders')
        .update({ assigned_shipper_id: worker.workerId, status: 'shipping' })
        .eq('id', target.id)
        .is('assigned_shipper_id', null)
        .select(fields)
        .single()

      if (error || !claimed) {
        playError()
        setLastScan({ result: 'warning', message: `Order #${target.order_number} was just claimed by someone else.` })
        fetchAvailableOrders(worker)
        return
      }

      setOrder(claimed as Order)
      const { count } = await supabase.from('boxes').select('id', { count: 'exact', head: true }).eq('order_id', claimed.id)
      setBoxCount(count || claimed.total_boxes || 1)
      resetSsState()
      playSuccess()
      setStep('ready')
    } finally {
      setClaimingId(null)
    }
  }

  async function confirmShipped() {
    if (!order || !worker) return
    setConfirming(true)

    await supabase.from('orders').update({ status: 'shipped', shipped_at: new Date().toISOString() } as any).eq('id', order.id)

    await writeAudit(supabase, {
      orgId: worker.orgId, workerId: worker.workerId,
      action: 'order_status_changed', entityType: 'order', entityId: order.id,
      changes: { status: 'shipped' }, note: `Shipped by ${worker.name}`,
    })

    playSuccess()
    setDone(true)
    setConfirming(false)
    setTimeout(() => { setOrder(null); setDone(false); setBoxCount(0); setStep('scan_order'); setLastScan(null); resetSsState(); if (worker) fetchAssignedOrder(worker) }, 2000)
  }

  async function handleLogout() {
    await fetch('/api/worker-auth', { method: 'DELETE' })
    window.location.href = '/worker'
  }

  const address = order ? [
    order.shipping_address_1,
    order.shipping_address_2,
    order.shipping_city && order.shipping_state
      ? `${order.shipping_city}, ${order.shipping_state} ${order.shipping_zip || ''}`.trim()
      : order.shipping_city || order.shipping_state,
    order.shipping_country !== 'US' ? order.shipping_country : null,
  ].filter(Boolean) : []

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {showOnboarding && worker && (
        <WorkerOnboarding workerId={worker.workerId} role={worker.role as any} onDismiss={dismissOnboarding} />
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <a href="/hub" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors shrink-0">
            <ArrowLeft size={18} className="text-gray-500" />
          </a>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
              <Truck size={18} className="text-orange-600" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-900 truncate">{worker?.name || 'Worker'}</p>
              <p className="text-xs text-gray-500">Shipping</p>
            </div>
          </div>
          {order && !done && (
            <div className="flex items-center gap-2 pl-4 border-l border-gray-200 min-w-0">
              <span className="text-base font-bold text-gray-900 shrink-0">#{order.order_number}</span>
              {order.customer_name && <span className="text-sm text-gray-500 truncate hidden sm:inline">· {order.customer_name}</span>}
              {order.is_rush && <span className="text-xs bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full shrink-0">RUSH</span>}
              <a
                href={`/print/order/${order.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 shrink-0 transition-colors hidden sm:inline"
              >
                Reprint sheet
              </a>
            </div>
          )}
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm transition-colors shrink-0">
          <LogOut size={15} /> Log out
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">

        {loading && (
          <div className="text-gray-400 text-sm">Loading...</div>
        )}

        {!loading && step === 'scan_order' && !done && (
          <div className="text-center w-full max-w-lg px-4">
            <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Package size={32} className="text-orange-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900 mb-2">Get an Order to Ship</p>
            <p className="text-gray-500 text-base mb-6">Pick one from the list below.</p>
            {lastScan && (
              <div className={`flex items-center gap-3 rounded-xl p-4 mb-4 text-left ${lastScan.result === 'success' ? 'bg-green-50 border border-green-200' : lastScan.result === 'warning' ? 'bg-orange-50 border border-orange-200' : 'bg-red-50 border border-red-200'}`}>
                {lastScan.result === 'success' ? <CheckCircle size={18} className="text-green-500 shrink-0" /> : lastScan.result === 'warning' ? <AlertTriangle size={18} className="text-orange-500 shrink-0" /> : <XCircle size={18} className="text-red-500 shrink-0" />}
                <p className={`text-base font-medium ${lastScan.result === 'success' ? 'text-green-700' : lastScan.result === 'warning' ? 'text-orange-700' : 'text-red-700'}`}>{lastScan.message}</p>
              </div>
            )}

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3 text-left">
              Incoming Orders {availableOrders.length > 0 && `(${availableOrders.length})`}
            </p>

            {loadingAvailable && availableOrders.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">Loading orders...</p>
            )}
            {!loadingAvailable && availableOrders.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">No orders ready to ship right now.</p>
            )}

            <div className="space-y-2 text-left">
              {availableOrders.map(o => (
                <div key={o.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900">#{o.order_number}</span>
                      {o.customer_name && <span className="text-sm text-gray-500 truncate">{o.customer_name}</span>}
                      {o.is_rush && <span className="text-xs bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full shrink-0">RUSH</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {o.item_count} {o.item_count === 1 ? 'item' : 'items'} - waiting {timeAgo(o.created_at)}
                    </p>
                    {o.notes && <p className="text-xs text-amber-600 mt-0.5 truncate">{o.notes}</p>}
                  </div>
                  <button
                    onClick={() => claimOrderFromList(o)}
                    disabled={claimingId !== null}
                    className="shrink-0 flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-semibold text-sm"
                  >
                    {claimingId === o.id ? <Loader2 size={16} className="animate-spin" /> : 'Ship This'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {done && (
          <div className="text-center">
            <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Truck size={36} className="text-green-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900 mb-2">Shipped!</p>
            <p className="text-gray-400">Loading next order...</p>
          </div>
        )}

        {!loading && order && step === 'ready' && !done && (
          <div className="w-full max-w-5xl">
            {/* Mobile reprint link */}
            <div className="flex sm:hidden items-center justify-between mb-3">
              <p className="text-base font-bold text-gray-900">#{order.order_number}</p>
              <a
                href={`/print/order/${order.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
              >
                Reprint sheet
              </a>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">

              {/* Left col: order info */}
              <div className="lg:col-span-3 space-y-4">
                {/* Order card */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h2 className="text-xl font-bold text-gray-900">Order #{order.order_number}</h2>
                        {order.is_rush && <span className="text-xs bg-red-100 text-red-600 font-bold px-2.5 py-1 rounded-full">RUSH</span>}
                      </div>
                      {order.customer_name && <p className="text-sm text-gray-500">{order.customer_name}</p>}
                    </div>
                    <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                      <Box size={20} className="text-orange-500" />
                      <span className="text-xl font-bold text-gray-900">{boxCount}</span>
                      <span className="text-sm text-gray-500">{boxCount === 1 ? 'box' : 'boxes'}</span>
                    </div>
                  </div>
                  {order.current_location && (
                    <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 mb-3">
                      <MapPin size={14} className="text-orange-500 shrink-0" />
                      <span className="text-sm font-semibold text-orange-800">Find boxes at rack: </span>
                      <span className="font-mono font-bold text-orange-900">{order.current_location}</span>
                    </div>
                  )}
                  {order.notes && (
                    <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                      <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-yellow-800">{order.notes}</p>
                    </div>
                  )}
                </div>

                {/* Ship to card */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <MapPin size={16} className="text-gray-400" />
                    <p className="font-semibold text-gray-900">Ship To</p>
                  </div>
                  {address.length > 0 ? (
                    <div className="space-y-1">
                      {order.shipping_name && <p className="font-semibold text-gray-900">{order.shipping_name}</p>}
                      {address.map((line, i) => (
                        <p key={i} className="text-gray-600">{line}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm">No address on file</p>
                  )}
                </div>
              </div>

              {/* Right col: carrier + confirm */}
              <div className="lg:col-span-2 space-y-4">

                {/* ShipStation Label Card */}
                {ssConfigured && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <Tag size={15} className="text-gray-400" />
                      <p className="font-semibold text-gray-900">Shipping Label</p>
                    </div>

                    {labelUrl ? (
                      /* Label already created */
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full">
                            <CheckCircle size={12} /> Label Created
                          </span>
                        </div>
                        {order.tracking_number && (
                          <p className="text-sm font-mono font-semibold text-blue-600 break-all">{order.tracking_number}</p>
                        )}
                        <a
                          href={labelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                        >
                          <ExternalLink size={14} /> Open Label
                        </a>
                      </div>
                    ) : (
                      /* Label not yet created */
                      <div className="space-y-3">
                        {/* Weight input + Get Rates */}
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Weight (oz)</label>
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              value={weightOz}
                              onChange={e => setWeightOz(e.target.value)}
                              placeholder="e.g. 16"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div className="flex items-end">
                            <button
                              onClick={fetchRates}
                              disabled={!weightOz || fetchingRates}
                              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                            >
                              {fetchingRates ? <Loader2 size={14} className="animate-spin" /> : null}
                              {fetchingRates ? 'Loading...' : 'Get Rates'}
                            </button>
                          </div>
                        </div>

                        {/* Rate list */}
                        {rates && rates.length === 0 && (
                          <p className="text-xs text-red-500">No rates returned. Check ShipStation configuration.</p>
                        )}
                        {rates && rates.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-gray-500">Select a service</p>
                            {rates.map((r, i) => (
                              <button
                                key={i}
                                onClick={() => setSelectedRate(r)}
                                className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                                  selectedRate?.serviceCode === r.serviceCode && selectedRate?.carrierCode === r.carrierCode
                                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                                    : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-800'
                                }`}
                              >
                                <span className="font-medium leading-tight">{r.serviceName}</span>
                                <span className="shrink-0 ml-2 font-semibold">
                                  ${(r.shipmentCost + (r.otherCost || 0)).toFixed(2)}
                                  {r.transitDays != null && (
                                    <span className="text-xs font-normal text-gray-400 ml-1">{r.transitDays}d</span>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Create Label button */}
                        {selectedRate && (
                          <button
                            onClick={createLabel}
                            disabled={creatingLabel}
                            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-lg transition-colors"
                          >
                            {creatingLabel ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
                            {creatingLabel ? 'Creating...' : 'Create Label'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Carrier + tracking */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Truck size={13} className="text-gray-400" />
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Carrier</p>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{order.carrier || <span className="text-gray-300 font-normal">Not set</span>}</p>
                  </div>
                  <div className="border-t border-gray-100 pt-4">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Hash size={13} className="text-gray-400" />
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tracking Number</p>
                    </div>
                    {order.tracking_number
                      ? <p className="text-sm font-mono font-semibold text-blue-600 break-all">{order.tracking_number}</p>
                      : <p className="text-sm text-amber-600 font-medium flex items-center gap-1.5"><AlertTriangle size={14} /> No label yet</p>
                    }
                  </div>
                </div>

                {/* Confirm button */}
                <button
                  onClick={confirmShipped}
                  disabled={confirming}
                  className="w-full flex items-center justify-center gap-3 bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:opacity-50 text-white py-5 rounded-xl font-bold text-xl transition-colors shadow-sm"
                >
                  {confirming ? 'Confirming...' : (
                    <>
                      <Truck size={22} /> Confirm Shipped <ChevronRight size={18} />
                    </>
                  )}
                </button>

                {!order.tracking_number && (
                  <p className="text-center text-xs text-amber-600">
                    Make sure the label is printed before confirming.
                  </p>
                )}

                {/* Next up note */}
                <div className="bg-gray-100 rounded-xl px-4 py-3 flex items-center gap-2">
                  <Package size={14} className="text-gray-400 shrink-0" />
                  <p className="text-xs text-gray-500">Next order will auto-load after confirmation.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
