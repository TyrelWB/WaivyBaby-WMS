'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ShoppingCart, Package, AlertTriangle, CheckCircle, Clock,
  Truck, RefreshCw, TrendingDown, Ship, ClipboardList, Warehouse, MoreHorizontal
} from 'lucide-react'
import { useAdminContext } from '../admin-context'

type Stats = {
  pending: number
  picking: number
  packing: number
  shippedToday: number
  exceptions: number
  lowStock: number
  inReceiving: number
  activePOs: number
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

type LowStockItem = {
  id: string
  qty_available: number
  products: { id: string; name: string; sku: string; reorder_point: number } | null
}

const statusConfig: Record<string, { label: string; className: string }> = {
  pending:   { label: 'Pending',   className: 'bg-gray-100 text-gray-600' },
  picking:   { label: 'Picking',   className: 'bg-amber-50 text-amber-600' },
  packing:   { label: 'Packing',   className: 'bg-violet-50 text-violet-600' },
  shipped:   { label: 'Shipped',   className: 'bg-emerald-50 text-emerald-600' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-400' },
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {action}
    </div>
  )
}

export default function DashboardPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [stats, setStats] = useState<Stats>({ pending: 0, picking: 0, packing: 0, shippedToday: 0, exceptions: 0, lowStock: 0, inReceiving: 0, activePOs: 0 })
  const [orders, setOrders] = useState<RecentOrder[]>([])
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([])
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [showOnboardingBanner, setShowOnboardingBanner] = useState(false)

  async function fetchAll() {
    if (!orgId) { setLoading(false); return }

    const today = new Date().toISOString().split('T')[0]

    const [
      { data: orderData },
      { data: exceptionData },
      { data: inventoryData },
      { data: receivingData },
      { data: poData },
      { data: shippedTodayData },
      { count: workerCount },
    ] = await Promise.all([
      supabase.from('orders')
        .select('id, order_number, customer_name, status, is_rush, is_bulk, created_at, workers!assigned_picker_id(name)')
        .eq('org_id', orgId)
        .not('status', 'in', '(complete,cancelled,shipped)')
        .order('is_rush', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(20),
      supabase.from('exceptions')
        .select('id, type, severity, description, created_at, orders(order_number)')
        .eq('org_id', orgId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('inventory')
        .select('id, qty_available, products(id, name, sku, reorder_point)')
        .eq('org_id', orgId),
      supabase.from('receiving')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .in('status', ['pending', 'in_progress']),
      supabase.from('purchase_orders')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .in('status', ['sent', 'confirmed', 'in_production', 'shipped', 'in_transit', 'at_customs', 'incoming']),
      supabase.from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'shipped')
        .gte('updated_at', `${today}T00:00:00`)
        .lte('updated_at', `${today}T23:59:59`),
      supabase.from('workers')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId),
    ])

    const all = orderData || []
    const inv = inventoryData || []
    const lowItems = inv.filter((i: any) => {
      const rp = i.products?.reorder_point ?? 0
      return rp > 0 && i.qty_available <= rp
    }) as unknown as LowStockItem[]

    setStats({
      pending: all.filter(o => o.status === 'pending').length,
      picking: all.filter(o => o.status === 'picking').length,
      packing: all.filter(o => o.status === 'packing').length,
      shippedToday: (shippedTodayData as any)?.length ?? 0,
      exceptions: (exceptionData || []).length,
      lowStock: lowItems.length,
      inReceiving: (receivingData as any)?.length ?? 0,
      activePOs: (poData as any)?.length ?? 0,
    })

    setOrders(all as unknown as RecentOrder[])
    setExceptions(exceptionData as unknown as ExceptionItem[] || [])
    setLowStockItems(lowItems.sort((a, b) => (a.qty_available - (a.products?.reorder_point ?? 0)) - (b.qty_available - (b.products?.reorder_point ?? 0))))
    setShowOnboardingBanner((workerCount ?? 0) === 0)
    setLastRefresh(new Date())
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [orgId])

  const statCards = [
    { label: 'Pending',      value: stats.pending,      icon: Clock,         accent: '#6B7280', bg: '#F3F4F6', href: '/orders' },
    { label: 'Picking',      value: stats.picking,      icon: Package,       accent: '#D97706', bg: '#FFFBEB', href: '/orders?status=picking' },
    { label: 'Packing',      value: stats.packing,      icon: ShoppingCart,  accent: '#7C3AED', bg: '#F5F3FF', href: '/orders?status=packing' },
    { label: 'Shipped Today',value: stats.shippedToday, icon: Truck,         accent: '#059669', bg: '#ECFDF5', href: '/reports' },
    { label: 'Exceptions',   value: stats.exceptions,   icon: AlertTriangle, accent: '#DC2626', bg: '#FEF2F2', href: '/exceptions' },
    { label: 'Low Stock',    value: stats.lowStock,     icon: TrendingDown,  accent: '#EA580C', bg: '#FFF7ED', href: '/inventory' },
    { label: 'In Receiving', value: stats.inReceiving,  icon: Truck,         accent: '#0284C7', bg: '#F0F9FF', href: '/receiving' },
    { label: 'Active POs',   value: stats.activePOs,    icon: Ship,          accent: '#4F46E5', bg: '#EEF2FF', href: '/purchase-orders' },
  ]

  const pipeline = [
    { key: 'pending',  label: 'Pending',       dot: '#9CA3AF' },
    { key: 'picking',  label: 'Picking',       dot: '#FBBF24' },
    { key: 'packing',  label: 'Packing',       dot: '#A78BFA' },
    { key: 'shipped',  label: 'Shipped Today', dot: '#34D399', today: true },
  ]

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Command Center</h1>
          <p className="text-xs text-gray-400 mt-0.5">Live warehouse overview · refreshes every 30s</p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 bg-white border border-gray-200 px-3 py-1.5 rounded-xl shadow-sm transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Onboarding banner */}
      {showOnboardingBanner && (
        <div className="bg-cyan-50 border border-cyan-200 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-cyan-100 rounded-xl flex items-center justify-center">
              <Warehouse size={16} className="text-cyan-600" />
            </div>
            <div>
              <p className="font-semibold text-cyan-900 text-sm">Finish setting up your warehouse</p>
              <p className="text-xs text-cyan-600 mt-0.5">Add workers, connect integrations, and configure locations.</p>
            </div>
          </div>
          <a href="/onboarding" className="bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap">
            Complete Setup
          </a>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 xl:grid-cols-8">
        {statCards.map(s => {
          const Icon = s.icon
          return (
            <a
              key={s.label}
              href={s.href}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-all hover:-translate-y-0.5 group"
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
                style={{ backgroundColor: s.bg }}
              >
                <Icon size={16} style={{ color: s.accent }} />
              </div>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">{loading ? '—' : s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-tight">{s.label}</p>
            </a>
          )
        })}
      </div>

      {/* Order pipeline */}
      <Card>
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Order Pipeline</p>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {pipeline.map((stage, i) => {
              const count = loading ? null : stage.today
                ? stats.shippedToday
                : orders.filter(o => o.status === stage.key).length
              return (
                <div key={stage.key} className="flex items-center">
                  <a href="/orders" className="flex flex-col items-center gap-2 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors min-w-[80px]">
                    <span className="text-xl font-bold text-gray-900 tabular-nums">{count ?? '—'}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: stage.dot }} />
                      <span className="text-xs text-gray-500 whitespace-nowrap">{stage.label}</span>
                    </div>
                  </a>
                  {i < pipeline.length - 1 && (
                    <div className="w-4 h-px bg-gray-100 shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      {/* Main content */}
      <div className="grid grid-cols-3 gap-4">
        {/* Active orders */}
        <Card className="col-span-2">
          <CardHeader
            title="Active Orders"
            action={<a href="/orders" className="text-xs text-cyan-500 hover:text-cyan-600 font-medium">See all</a>}
          />
          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="p-6 text-sm text-gray-400">Loading...</div>
            ) : orders.length === 0 ? (
              <div className="p-10 text-center">
                <CheckCircle size={28} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-gray-400 font-medium">All caught up!</p>
              </div>
            ) : orders.slice(0, 12).map(order => {
              const cfg = statusConfig[order.status]
              return (
                <div key={order.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50/50 transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">#{order.order_number}</p>
                      {order.is_rush && <span className="text-[10px] bg-red-50 text-red-500 font-bold px-1.5 py-0.5 rounded-lg tracking-wide">RUSH</span>}
                      {order.is_bulk && <span className="text-[10px] bg-violet-50 text-violet-500 font-bold px-1.5 py-0.5 rounded-lg tracking-wide">BULK</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {order.customer_name || 'No name'} · {(order as any).workers?.name ? `Picker: ${(order as any).workers.name}` : 'Unassigned'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${cfg?.className || 'bg-gray-100 text-gray-600'}`}>
                      {cfg?.label || order.status}
                    </span>
                    <a href={`/orders/${order.id}`} className="text-xs text-cyan-500 hover:text-cyan-600 font-medium">View</a>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Exceptions */}
          <Card>
            <CardHeader
              title="Exceptions"
              action={
                <div className="flex items-center gap-2">
                  {exceptions.length > 0 && (
                    <span className="bg-red-50 text-red-500 text-xs font-semibold px-2 py-0.5 rounded-full">{exceptions.length}</span>
                  )}
                  <a href="/exceptions" className="text-xs text-cyan-500 hover:text-cyan-600 font-medium">See all</a>
                </div>
              }
            />
            <div className="divide-y divide-gray-50">
              {loading ? (
                <div className="p-5 text-sm text-gray-400">Loading...</div>
              ) : exceptions.length === 0 ? (
                <div className="p-6 text-center">
                  <CheckCircle size={22} className="text-emerald-400 mx-auto mb-2" />
                  <p className="text-xs text-gray-400 font-medium">No open exceptions</p>
                </div>
              ) : exceptions.slice(0, 4).map(ex => (
                <div key={ex.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wide ${ex.severity === 'hard' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>
                      {ex.severity.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-400 capitalize">{ex.type.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-gray-700 line-clamp-1">{ex.description || '—'}</p>
                  {(ex as any).orders?.order_number && (
                    <p className="text-xs text-gray-400 mt-0.5">Order #{(ex as any).orders.order_number}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Low stock */}
          {lowStockItems.length > 0 && (
            <Card>
              <CardHeader
                title="Low Stock"
                action={
                  <div className="flex items-center gap-2">
                    <span className="bg-orange-50 text-orange-500 text-xs font-semibold px-2 py-0.5 rounded-full">{lowStockItems.length}</span>
                    <a href="/inventory" className="text-xs text-cyan-500 hover:text-cyan-600 font-medium">View</a>
                  </div>
                }
              />
              <div className="divide-y divide-gray-50">
                {lowStockItems.slice(0, 6).map(item => {
                  const pct = item.products?.reorder_point ? Math.round((item.qty_available / item.products.reorder_point) * 100) : 0
                  return (
                    <div key={item.id} className="px-5 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium text-gray-800 truncate flex-1 mr-2">{item.products?.name}</p>
                        <span className={`text-xs font-bold tabular-nums ${item.qty_available <= 0 ? 'text-red-500' : 'text-orange-500'}`}>
                          {item.qty_available}
                        </span>
                      </div>
                      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${item.qty_available <= 0 ? 'bg-red-400' : 'bg-orange-400'}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                {lowStockItems.length > 6 && (
                  <div className="px-5 py-2.5 text-xs text-gray-400 text-center">
                    +{lowStockItems.length - 6} more · <a href="/inventory" className="text-cyan-500 hover:underline">view all</a>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-300 text-right">Last updated: {lastRefresh.toLocaleTimeString()}</p>
    </div>
  )
}
