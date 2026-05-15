'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TrendingUp, Package, Users, AlertTriangle, ShoppingCart } from 'lucide-react'
import { useAdminContext } from '../admin-context'

type Stats = {
  ordersToday: number
  ordersThisWeek: number
  ordersThisMonth: number
  packedToday: number
  avgPickTime: string
  openExceptions: number
  totalWorkers: number
  activeWorkers: number
  lowStockItems: number
  topWorkers: { name: string; picked: number; packed: number }[]
  ordersByStatus: { status: string; count: number }[]
  recentActivity: { time: string; description: string; type: string }[]
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-200',
  assigned: 'bg-yellow-300',
  picking: 'bg-blue-400',
  picked: 'bg-blue-600',
  packing: 'bg-purple-400',
  packed: 'bg-purple-600',
  shipped: 'bg-green-500',
  complete: 'bg-green-700',
  on_hold: 'bg-orange-400',
  cancelled: 'bg-red-400',
}

export default function AnalyticsPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [stats, setStats] = useState<Partial<Stats>>({})
  const [loading, setLoading] = useState(true)

  async function fetchStats() {
    if (!orgId) { setLoading(false); return }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [
      { count: ordersToday },
      { count: ordersThisWeek },
      { count: ordersThisMonth },
      { count: packedToday },
      { count: openExceptions },
      { count: totalWorkers },
      { count: activeWorkers },
      { data: orderStatusData },
      { data: workerData },
      { data: lowStockData },
      { data: scanData },
    ] = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', todayStart),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', weekStart),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', monthStart),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'packed').gte('updated_at', todayStart),
      supabase.from('exceptions').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'open'),
      supabase.from('workers').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('workers').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
      supabase.from('orders').select('status').eq('org_id', orgId).not('status', 'in', '("complete","cancelled")'),
      supabase.from('workers').select('id, name').eq('org_id', orgId).eq('is_active', true).limit(10),
      supabase.from('inventory').select('qty_available, products(reorder_point)').eq('org_id', orgId),
      supabase.from('scan_events').select('worker_id, scan_action').eq('org_id', orgId).eq('result', 'success').in('scan_action', ['pick', 'pack']).gte('created_at', todayStart),
    ])

    // Aggregate order statuses
    const statusCounts: Record<string, number> = {}
    for (const order of (orderStatusData || [])) {
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1
    }
    const ordersByStatus = Object.entries(statusCounts).map(([status, count]) => ({ status, count }))

    const workerStats: Record<string, { picked: number; packed: number }> = {}
    for (const scan of (scanData || [])) {
      if (!workerStats[scan.worker_id]) workerStats[scan.worker_id] = { picked: 0, packed: 0 }
      if (scan.scan_action === 'pick') workerStats[scan.worker_id].picked++
      else if (scan.scan_action === 'pack') workerStats[scan.worker_id].packed++
    }

    setStats({
      ordersToday: ordersToday || 0,
      ordersThisWeek: ordersThisWeek || 0,
      ordersThisMonth: ordersThisMonth || 0,
      packedToday: packedToday || 0,
      openExceptions: openExceptions || 0,
      totalWorkers: totalWorkers || 0,
      activeWorkers: activeWorkers || 0,
      ordersByStatus,
      topWorkers: (workerData || [])
        .map(w => ({ name: w.name, picked: workerStats[w.id]?.picked ?? 0, packed: workerStats[w.id]?.packed ?? 0 }))
        .sort((a, b) => (b.picked + b.packed) - (a.picked + a.packed)),
      lowStockItems: (lowStockData || []).filter((i: any) => i.qty_available <= (i.products?.reorder_point ?? 0)).length,
    })
    setLoading(false)
  }

  useEffect(() => { fetchStats() }, [orgId])

  const statCards = [
    { label: 'Orders Today', value: stats.ordersToday ?? '—', icon: ShoppingCart, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'This Week', value: stats.ordersThisWeek ?? '—', icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'This Month', value: stats.ordersThisMonth ?? '—', icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Packed Today', value: stats.packedToday ?? '—', icon: Package, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Open Exceptions', value: stats.openExceptions ?? '—', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Active Workers', value: `${stats.activeWorkers ?? '—'}/${stats.totalWorkers ?? '—'}`, icon: Users, color: 'text-orange-600', bg: 'bg-orange-50' },
  ]

  const totalActive = (stats.ordersByStatus || []).reduce((s, o) => s + o.count, 0)

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">Warehouse performance overview</p>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading stats...</div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {statCards.map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{card.label}</span>
                  <div className={`w-8 h-8 ${card.bg} rounded-lg flex items-center justify-center`}>
                    <card.icon size={16} className={card.color} />
                  </div>
                </div>
                <p className="text-3xl font-bold text-gray-900">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Order pipeline */}
          {(stats.ordersByStatus || []).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
              <h2 className="font-semibold text-gray-900 mb-4">Active Order Pipeline</h2>
              <div className="space-y-3">
                {(stats.ordersByStatus || [])
                  .sort((a, b) => {
                    const order = ['pending', 'assigned', 'picking', 'picked', 'packing', 'packed', 'on_hold']
                    return order.indexOf(a.status) - order.indexOf(b.status)
                  })
                  .map(({ status, count }) => (
                    <div key={status} className="flex items-center gap-4">
                      <span className="text-xs text-gray-500 capitalize w-20 shrink-0">{status.replace('_', ' ')}</span>
                      <div className="flex-1 h-6 bg-gray-100 rounded-lg overflow-hidden">
                        <div
                          className={`h-full ${statusColors[status] || 'bg-gray-300'} rounded-lg transition-all flex items-center justify-end pr-2`}
                          style={{ width: `${totalActive ? Math.max((count / totalActive) * 100, 4) : 0}%` }}
                        >
                          {count > 0 && <span className="text-xs font-bold text-white">{count}</span>}
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-gray-700 w-8 text-right">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Workers */}
          {(stats.topWorkers || []).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h2 className="font-semibold text-gray-900 mb-1">Worker Performance</h2>
              <p className="text-xs text-gray-400 mb-4">Successful scans today</p>
              <div className="divide-y divide-gray-50">
                {(stats.topWorkers || []).map((w, i) => (
                  <div key={i} className="flex items-center gap-4 py-3">
                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500">{i + 1}</div>
                    <p className="flex-1 font-medium text-gray-900 text-sm">{w.name}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1.5"><Package size={11} className="text-blue-400" /> {w.picked} picks</span>
                      <span className="flex items-center gap-1.5"><Package size={11} className="text-purple-400" /> {w.packed} packs</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
