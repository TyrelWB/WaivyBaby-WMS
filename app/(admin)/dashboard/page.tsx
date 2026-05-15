'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ShoppingCart, Package, AlertTriangle, CheckCircle, Clock, Truck, RefreshCw } from 'lucide-react'
import { useAdminContext } from '../admin-context'

type Stats = {
  pending: number
  picking: number
  packing: number
  shipped: number
  exceptions: number
  lowStock: number
}

type RecentOrder = {
  id: string
  order_number: string
  customer_name: string | null
  status: string
  is_rush: boolean
  is_bulk: boolean
  created_at: string
  workers: { name: string } | null
}

type ExceptionItem = {
  id: string
  type: string
  severity: string
  description: string | null
  created_at: string
  orders: { order_number: string } | null
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  assigned: 'bg-blue-100 text-blue-700',
  picking: 'bg-yellow-100 text-yellow-700',
  picked: 'bg-indigo-100 text-indigo-700',
  packing: 'bg-purple-100 text-purple-700',
  packed: 'bg-pink-100 text-pink-700',
  shipping: 'bg-orange-100 text-orange-700',
  shipped: 'bg-green-100 text-green-700',
  complete: 'bg-green-100 text-green-700',
  on_hold: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export default function DashboardPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [stats, setStats] = useState<Stats>({ pending: 0, picking: 0, packing: 0, shipped: 0, exceptions: 0, lowStock: 0 })
  const [orders, setOrders] = useState<RecentOrder[]>([])
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  async function fetchAll() {
    if (!orgId) { setLoading(false); return }

    const [
      { data: orderData },
      { data: exceptionData },
      { data: inventoryData },
    ] = await Promise.all([
      supabase.from('orders').select('id, order_number, customer_name, status, is_rush, is_bulk, created_at, workers!assigned_picker_id(name)').eq('org_id', orgId).not('status', 'in', '(complete,cancelled)').order('is_rush', { ascending: false }).order('created_at', { ascending: true }).limit(20),
      supabase.from('exceptions').select('id, type, severity, description, created_at, orders(order_number)').eq('org_id', orgId).eq('status', 'open').order('created_at', { ascending: false }).limit(10),
      supabase.from('inventory').select('qty_available, products(reorder_point)').eq('org_id', orgId),
    ])

    const all = orderData || []
    setStats({
      pending: all.filter(o => o.status === 'pending' || o.status === 'assigned').length,
      picking: all.filter(o => o.status === 'picking' || o.status === 'picked').length,
      packing: all.filter(o => o.status === 'packing' || o.status === 'packed').length,
      shipped: all.filter(o => o.status === 'shipped').length,
      exceptions: (exceptionData || []).length,
      lowStock: (inventoryData || []).filter((i: any) => i.qty_available <= (i.products?.reorder_point ?? 0)).length,
    })

    setOrders(all as unknown as RecentOrder[])
    setExceptions(exceptionData as unknown as ExceptionItem[] || [])
    setLastRefresh(new Date())
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [orgId])

  const statCards = [
    { label: 'Pending / Assigned', value: stats.pending, icon: Clock, color: 'text-gray-600', bg: 'bg-gray-100' },
    { label: 'Picking / Picked', value: stats.picking, icon: Package, color: 'text-yellow-600', bg: 'bg-yellow-100' },
    { label: 'Packing / Packed', value: stats.packing, icon: ShoppingCart, color: 'text-purple-600', bg: 'bg-purple-100' },
    { label: 'Shipped Today', value: stats.shipped, icon: Truck, color: 'text-green-600', bg: 'bg-green-100' },
    { label: 'Open Exceptions', value: stats.exceptions, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100' },
    { label: 'Low Stock SKUs', value: stats.lowStock, icon: Package, color: 'text-orange-600', bg: 'bg-orange-100' },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
          <p className="text-sm text-gray-400 mt-0.5">Live warehouse overview · refreshes every 30s</p>
        </div>
        <button onClick={fetchAll} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 bg-white px-3 py-1.5 rounded-lg transition-colors">
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {statCards.map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
                <Icon size={17} className={s.color} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{loading ? '—' : s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-tight">{s.label}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active orders */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Active Orders</h2>
            <a href="/orders" className="text-sm text-blue-600 hover:underline">See all</a>
          </div>
          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="p-6 text-sm text-gray-400">Loading...</div>
            ) : orders.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                <p className="text-sm text-gray-400">All caught up!</p>
              </div>
            ) : orders.map(order => (
              <div key={order.id} className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">#{order.order_number}</p>
                      {order.is_rush && <span className="text-xs bg-red-100 text-red-600 font-semibold px-1.5 py-0.5 rounded">RUSH</span>}
                      {order.is_bulk && <span className="text-xs bg-purple-100 text-purple-600 font-semibold px-1.5 py-0.5 rounded">BULK</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {order.customer_name || 'No name'} · {(order as any).workers?.name ? `Picker: ${(order as any).workers.name}` : 'Unassigned'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${statusColors[order.status] || 'bg-gray-100 text-gray-600'}`}>
                    {order.status.replace('_', ' ')}
                  </span>
                  <a href={`/orders/${order.id}`} className="text-xs text-blue-600 hover:underline">View</a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Exceptions */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-500" />
              Exceptions
              {exceptions.length > 0 && (
                <span className="bg-red-100 text-red-600 text-xs font-semibold px-2 py-0.5 rounded-full">{exceptions.length}</span>
              )}
            </h2>
            <a href="/exceptions" className="text-sm text-blue-600 hover:underline">See all</a>
          </div>
          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="p-6 text-sm text-gray-400">Loading...</div>
            ) : exceptions.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle size={28} className="text-green-400 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No open exceptions</p>
              </div>
            ) : exceptions.map(ex => (
              <div key={ex.id} className="px-6 py-3.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ex.severity === 'hard' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {ex.severity.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-500 capitalize">{ex.type.replace('_', ' ')}</span>
                </div>
                <p className="text-sm text-gray-700">{ex.description || '—'}</p>
                {(ex as any).orders?.order_number && (
                  <p className="text-xs text-gray-400 mt-0.5">Order #{(ex as any).orders.order_number}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-300 mt-4 text-right">Last updated: {lastRefresh.toLocaleTimeString()}</p>
    </div>
  )
}
