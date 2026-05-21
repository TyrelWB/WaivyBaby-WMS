'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { playSuccess, playError } from '@/lib/feedback'
import { writeAudit } from '@/lib/audit'
import { CheckCircle, LogOut, Package, MapPin, Truck, Hash, AlertTriangle, Box, ChevronRight } from 'lucide-react'

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
  basket_id: string | null
}

export default function ShipPage() {
  const supabase = createClient()
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [boxCount, setBoxCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) { setWorker(session); fetchAssignedOrder(session) }
        else setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!worker) return
    const channel = supabase
      .channel(`shipper-${worker.workerId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `status=eq.packed`,
      }, () => {
        setOrder(prev => { if (!prev) fetchAssignedOrder(worker); return prev })
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `assigned_shipper_id=eq.${worker.workerId}`,
      }, () => {
        setOrder(prev => { if (!prev) fetchAssignedOrder(worker); return prev })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [worker])

  async function fetchAssignedOrder(session: WorkerSession) {
    const fields = 'id, order_number, customer_name, is_rush, notes, total_boxes, carrier, tracking_number, shipping_name, shipping_address_1, shipping_address_2, shipping_city, shipping_state, shipping_zip, shipping_country, basket_id'

    let { data } = await supabase
      .from('orders')
      .select(fields)
      .eq('assigned_shipper_id', session.workerId)
      .in('status', ['packed', 'shipping'])
      .order('is_rush', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (!data && session.orgId) {
      const { data: next } = await supabase
        .from('orders')
        .select('id')
        .eq('org_id', session.orgId)
        .eq('status', 'packed')
        .is('assigned_shipper_id', null)
        .order('is_rush', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (next) {
        const { error } = await supabase
          .from('orders')
          .update({ assigned_shipper_id: session.workerId, status: 'shipping' })
          .eq('id', next.id)
          .is('assigned_shipper_id', null)

        if (!error) {
          const { data: assigned } = await supabase.from('orders').select(fields).eq('id', next.id).single()
          data = assigned
        }
      }
    }

    if (data) {
      setOrder(data as Order)
      const { count } = await supabase.from('boxes').select('id', { count: 'exact', head: true }).eq('order_id', data.id)
      setBoxCount(count || data.total_boxes || 1)
    }

    setLoading(false)
  }

  async function confirmShipped() {
    if (!order || !worker) return
    setConfirming(true)

    if (order.basket_id) {
      await supabase.from('baskets').update({
        status: 'available',
        current_order_id: null,
        current_worker_id: null,
        claimed_at: null,
      }).eq('id', order.basket_id)
    }

    await supabase.from('orders').update({ status: 'shipped' }).eq('id', order.id)

    await writeAudit(supabase, {
      orgId: worker.orgId,
      workerId: worker.workerId,
      action: 'order_status_changed',
      entityType: 'order',
      entityId: order.id,
      changes: { status: 'shipped' },
      note: `Shipped by ${worker.name}`,
    })

    if (order.tracking_number) {
      fetch('/api/integrations/wix/fulfill-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      }).catch(() => {})
    }

    playSuccess()
    setDone(true)
    setConfirming(false)

    setTimeout(() => {
      setOrder(null)
      setDone(false)
      setBoxCount(0)
      if (worker) fetchAssignedOrder(worker)
    }, 2000)
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
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-orange-900 rounded-lg flex items-center justify-center">
            <Truck size={18} className="text-orange-400" />
          </div>
          <div>
            <p className="font-bold text-white">{worker?.name || 'Worker'}</p>
            <p className="text-xs text-gray-500">Shipper</p>
          </div>
          {order && !done && (
            <>
              <span className="text-gray-700 mx-2">|</span>
              <p className="text-sm text-gray-400">Order <span className="text-white font-bold">#{order.order_number}</span></p>
              {order.customer_name && <p className="text-sm text-gray-500">{order.customer_name}</p>}
              {order.is_rush && <span className="text-xs bg-red-600 text-white font-bold px-2 py-0.5 rounded-full">RUSH</span>}
            </>
          )}
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
          <LogOut size={16} /> Log out
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-8 py-8">

        {loading && (
          <p className="text-gray-500">Loading...</p>
        )}

        {!loading && !order && !done && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} className="text-green-400" />
            </div>
            <p className="text-2xl font-bold text-white mb-2">No orders to ship</p>
            <p className="text-gray-500">You'll be assigned automatically when packing is complete.</p>
          </div>
        )}

        {done && (
          <div className="text-center">
            <div className="w-20 h-20 bg-green-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Truck size={36} className="text-green-400" />
            </div>
            <p className="text-3xl font-bold text-white mb-2">Shipped!</p>
            <p className="text-gray-400">Loading next order...</p>
          </div>
        )}

        {!loading && order && !done && (
          <div className="w-full max-w-4xl">
            <div className="grid grid-cols-2 gap-6">
              {/* Left column: order details */}
              <div className="space-y-4">
                {/* Order header */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-bold text-white text-lg">Order #{order.order_number}</p>
                    {order.is_rush && <span className="text-xs bg-red-600 text-white font-bold px-2.5 py-1 rounded-full">RUSH</span>}
                  </div>
                  {order.customer_name && <p className="text-sm text-gray-400">{order.customer_name}</p>}
                  {order.notes && (
                    <div className="flex items-start gap-2 mt-3 bg-yellow-950 rounded-lg px-3 py-2">
                      <AlertTriangle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-300">{order.notes}</p>
                    </div>
                  )}
                </div>

                {/* Shipping address */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin size={15} className="text-gray-400" />
                    <p className="font-semibold text-sm text-white">Ship To</p>
                  </div>
                  {address.length > 0 ? (
                    <div className="space-y-0.5">
                      {order.shipping_name && <p className="text-sm font-medium text-white">{order.shipping_name}</p>}
                      {address.map((line, i) => (
                        <p key={i} className="text-sm text-gray-400">{line}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No address on file</p>
                  )}
                </div>
              </div>

              {/* Right column: carrier + action */}
              <div className="space-y-4">
                {/* Carrier + tracking */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Truck size={13} className="text-gray-400" />
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Carrier</p>
                      </div>
                      <p className="text-base font-semibold text-white">{order.carrier || <span className="text-gray-600">Not set</span>}</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Hash size={13} className="text-gray-400" />
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Tracking</p>
                      </div>
                      {order.tracking_number ? (
                        <p className="text-sm font-mono font-semibold text-blue-400 break-all">{order.tracking_number}</p>
                      ) : (
                        <p className="text-sm text-yellow-500 font-medium">⚠ No label yet</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Box count */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-orange-900 rounded-xl flex items-center justify-center shrink-0">
                      <Box size={24} className="text-orange-400" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-3xl">{boxCount} {boxCount === 1 ? 'Box' : 'Boxes'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Confirm all boxes are labeled and ready</p>
                    </div>
                  </div>
                </div>

                {/* Confirm button */}
                <button
                  onClick={confirmShipped}
                  disabled={confirming}
                  className="w-full flex items-center justify-center gap-3 bg-green-700 hover:bg-green-600 active:bg-green-800 disabled:opacity-50 text-white py-5 rounded-xl font-bold text-xl transition-colors"
                >
                  {confirming ? (
                    <span>Confirming...</span>
                  ) : (
                    <>
                      <Truck size={22} />
                      Confirm Shipped
                      <ChevronRight size={18} />
                    </>
                  )}
                </button>

                {!order.tracking_number && (
                  <p className="text-center text-xs text-yellow-500">No tracking number — make sure the label is printed before shipping.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
