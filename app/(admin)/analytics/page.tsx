'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TrendingUp, Package, Users, AlertTriangle, ShoppingCart, Truck } from 'lucide-react'
import { useAdminContext } from '../admin-context'

type DailyCount = { date: string; count: number }

type Stats = {
  ordersCreated: number
  ordersShipped: number
  openExceptions: number
  totalWorkers: number
  activeWorkers: number
  lowStockItems: number
  topWorkers: { name: string; picked: number; packed: number }[]
  ordersByStatus: { status: string; count: number }[]
  shippedByDay: DailyCount[]
  createdByDay: DailyCount[]
}

const statusColors: Record<string, string> = {
  pending:   'bg-gray-200',
  assigned:  'bg-yellow-300',
  picking:   'bg-blue-400',
  picked:    'bg-cyan-500',
  packing:   'bg-purple-400',
  packed:    'bg-purple-600',
  shipped:   'bg-green-500',
  complete:  'bg-green-700',
  on_hold:   'bg-orange-400',
  cancelled: 'bg-red-400',
}

function buildDaySeries(days: number): DailyCount[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (days - 1 - i))
    return { date: d.toISOString().split('T')[0], count: 0 }
  })
}

export default function AnalyticsPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [stats, setStats] = useState<Partial<Stats>>({})
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<7 | 30 | 90>(30)

  async function fetchStats() {
    if (!orgId) { setLoading(false); return }
    setLoading(true)

    const since = new Date()
    since.setDate(since.getDate() - range)
    const sinceIso = since.toISOString()
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()

    const [
      { data: createdOrders },
      { data: shippedOrders },
      { count: openExceptions },
      { count: totalWorkers },
      { count: activeWorkers },
      { data: orderStatusData },
      { data: workerData },
      { data: lowStockData },
      { data: scanData },
    ] = await Promise.all([
      supabase.from('orders').select('created_at').eq('org_id', orgId).gte('created_at', sinceIso),
      supabase.from('orders').select('updated_at').eq('org_id', orgId).eq('status', 'shipped').gte('updated_at', sinceIso),
      supabase.from('exceptions').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'open'),
      supabase.from('workers').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('workers').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
      supabase.from('orders').select('status').eq('org_id', orgId).not('status', 'in', '("complete","cancelled")'),
      supabase.from('workers').select('id, name').eq('org_id', orgId).eq('is_active', true).limit(10),
      supabase.from('inventory').select('qty_available, products(reorder_point)').eq('org_id', orgId),
      supabase.from('scan_events').select('worker_id, scan_action').eq('org_id', orgId).eq('result', 'success').in('scan_action', ['pick', 'pack']).gte('created_at', todayStart),
    ])

    // Build daily series
    const createdSeries = buildDaySeries(range)
    for (const o of (createdOrders || [])) {
      const day = o.created_at.split('T')[0]
      const slot = createdSeries.find(s => s.date === day)
      if (slot) slot.count++
    }

    const shippedSeries = buildDaySeries(range)
    for (const o of (shippedOrders || [])) {
      const day = o.updated_at.split('T')[0]
      const slot = shippedSeries.find(s => s.date === day)
      if (slot) slot.count++
    }

    // Status breakdown
    const statusCounts: Record<string, number> = {}
    for (const o of (orderStatusData || [])) {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
    }

    // Worker scan stats
    const workerStats: Record<string, { picked: number; packed: number }> = {}
    for (const scan of (scanData || [])) {
      if (!workerStats[scan.worker_id]) workerStats[scan.worker_id] = { picked: 0, packed: 0 }
      if (scan.scan_action === 'pick') workerStats[scan.worker_id].picked++
      else workerStats[scan.worker_id].packed++
    }

    setStats({
      ordersCreated: (createdOrders || []).length,
      ordersShipped: (shippedOrders || []).length,
      openExceptions: openExceptions || 0,
      totalWorkers: totalWorkers || 0,
      activeWorkers: activeWorkers || 0,
      lowStockItems: (lowStockData || []).filter((i: any) => i.qty_available <= (i.products?.reorder_point ?? 0)).length,
      ordersByStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
      topWorkers: (workerData || [])
        .map(w => ({ name: w.name, picked: workerStats[w.id]?.picked ?? 0, packed: workerStats[w.id]?.packed ?? 0 }))
        .sort((a, b) => (b.picked + b.packed) - (a.picked + a.packed)),
      shippedByDay: shippedSeries,
      createdByDay: createdSeries,
    })
    setLoading(false)
  }

  useEffect(() => { fetchStats() }, [orgId, range])

  const rangeLabel = range === 7 ? 'last 7 days' : range === 30 ? 'last 30 days' : 'last 90 days'
  const totalActive = (stats.ordersByStatus || []).reduce((s, o) => s + o.count, 0)

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Warehouse performance — {rangeLabel}</p>
        </div>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
          {([7, 30, 90] as const).map(d => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${range === d ? 'bg-cyan-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: `Orders Created`, value: stats.ordersCreated ?? '—', icon: ShoppingCart, color: 'text-cyan-500', bg: 'bg-cyan-50' },
          { label: `Orders Shipped`, value: stats.ordersShipped ?? '—', icon: Truck,        color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Open Exceptions', value: stats.openExceptions ?? '—', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Low Stock SKUs',  value: stats.lowStockItems ?? '—',  icon: Package,    color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Active Workers',  value: loading ? '—' : `${stats.activeWorkers ?? 0}/${stats.totalWorkers ?? 0}`, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Fulfillment Rate', value: loading ? '—' : stats.ordersCreated ? `${Math.round(((stats.ordersShipped ?? 0) / stats.ordersCreated) * 100)}%` : '—', icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{card.label}</span>
              <div className={`w-8 h-8 ${card.bg} rounded-lg flex items-center justify-center`}>
                <card.icon size={16} className={card.color} />
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900">{loading ? '—' : card.value}</p>
            <p className="text-xs text-gray-400 mt-1">{rangeLabel}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Shipped per day chart */}
        <BarChart
          title="Orders Shipped Per Day"
          data={stats.shippedByDay || []}
          color="bg-green-500"
          loading={loading}
          range={range}
        />
        {/* Created per day chart */}
        <BarChart
          title="Orders Created Per Day"
          data={stats.createdByDay || []}
          color="bg-cyan-500"
          loading={loading}
          range={range}
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Order pipeline */}
        {(stats.ordersByStatus || []).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Active Order Pipeline</h2>
            <div className="space-y-3">
              {(stats.ordersByStatus || [])
                .sort((a, b) => {
                  const ord = ['pending', 'assigned', 'picking', 'picked', 'packing', 'packed', 'shipping', 'on_hold']
                  return ord.indexOf(a.status) - ord.indexOf(b.status)
                })
                .map(({ status, count }) => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 capitalize w-20 shrink-0">{status.replace('_', ' ')}</span>
                    <div className="flex-1 h-5 bg-gray-100 rounded-md overflow-hidden">
                      <div
                        className={`h-full ${statusColors[status] || 'bg-gray-300'} rounded-md transition-all flex items-center justify-end pr-2`}
                        style={{ width: `${totalActive ? Math.max((count / totalActive) * 100, 6) : 0}%` }}
                      >
                        <span className="text-xs font-bold text-white">{count}</span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 w-6 text-right">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Worker performance */}
        {(stats.topWorkers || []).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Worker Performance</h2>
            <p className="text-xs text-gray-400 mb-4">Successful scans today</p>
            <div className="divide-y divide-gray-50">
              {(stats.topWorkers || []).map((w, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500">{i + 1}</div>
                  <p className="flex-1 font-medium text-gray-900 text-sm">{w.name}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Package size={11} className="text-blue-400" /> {w.picked} picks</span>
                    <span className="flex items-center gap-1"><Package size={11} className="text-purple-400" /> {w.packed} packs</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BarChart({ title, data, color, loading, range }: {
  title: string
  data: DailyCount[]
  color: string
  loading: boolean
  range: number
}) {
  const max = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0)

  // For 30/90 days, only label every Nth tick
  const labelEvery = range <= 7 ? 1 : range <= 30 ? 7 : 14

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <span className="text-lg font-bold text-gray-900">{loading ? '—' : total}</span>
      </div>
      <p className="text-xs text-gray-400 mb-5">Total in period</p>
      {loading ? (
        <div className="h-24 bg-gray-50 rounded-lg animate-pulse" />
      ) : (
        <div className="flex items-end gap-0.5 h-24">
          {data.map((d, i) => {
            const heightPct = max > 0 ? (d.count / max) * 100 : 0
            const showLabel = i % labelEvery === 0
            const label = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative">
                <div
                  className={`w-full rounded-sm ${color} opacity-80 group-hover:opacity-100 transition-opacity min-h-[2px]`}
                  style={{ height: `${Math.max(heightPct, d.count > 0 ? 4 : 0)}%` }}
                />
                {showLabel && (
                  <span className="text-[9px] text-gray-400 absolute -bottom-4 whitespace-nowrap">{label}</span>
                )}
                {/* Tooltip */}
                <div className="absolute bottom-full mb-1 bg-gray-900 text-white text-xs rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  {label}: {d.count}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-5" />
    </div>
  )
}
