'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../admin-context'
import { Printer, Package, TrendingDown, Truck, ChevronDown, ChevronUp } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ShippingOrder = {
  id: string
  order_number: string
  customer_name: string | null
  customer_email: string | null
  status: string
  carrier: string | null
  tracking_number: string | null
  shipping_name: string | null
  shipping_address_1: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_zip: string | null
  weight_oz: number | null
  updated_at: string
  order_items: { quantity_ordered: number; products: { name: string; sku: string } }[]
}

type InventoryRow = {
  id: string
  qty_on_hand: number
  qty_available: number
  qty_reserved: number
  qty_damaged: number
  updated_at: string
  products: { id: string; name: string; sku: string; reorder_point: number; is_sub_product: boolean } | null
}

type ReceivingRecord = {
  id: string
  reference_number: string | null
  supplier_name: string | null
  status: string
  expected_date: string | null
  received_date: string | null
  created_at: string
  receiving_items: { quantity_expected: number; quantity_received: number; products: { name: string; sku: string } | null }[]
}

const statusColors: Record<string, string> = {
  packed:   'bg-pink-100 text-pink-700',
  shipping: 'bg-cyan-100 text-cyan-600',
  shipped:  'bg-green-100 text-green-700',
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { orgId } = useAdminContext()
  const [tab, setTab] = useState<'shipping' | 'inventory' | 'receiving'>('shipping')

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Shipping, inventory, and receiving history</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors"
        >
          <Printer size={15} /> Print
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 print:hidden">
        {[
          { key: 'shipping',  label: 'Shipped Orders' },
          { key: 'inventory', label: 'Inventory Snapshot' },
          { key: 'receiving', label: 'Receiving History' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === t.key ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {orgId && tab === 'shipping'  && <ShippingReport  orgId={orgId} />}
      {orgId && tab === 'inventory' && <InventoryReport orgId={orgId} />}
      {orgId && tab === 'receiving' && <ReceivingReport orgId={orgId} />}
    </div>
  )
}

// ─── Shipped Orders Tab ───────────────────────────────────────────────────────

function ShippingReport({ orgId }: { orgId: string }) {
  const supabase = createClient()
  const [orders, setOrders] = useState<ShippingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  async function fetchOrders() {
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(quantity_ordered, products(name, sku))')
      .eq('org_id', orgId)
      .in('status', ['packed', 'shipping', 'shipped'])
      .gte('updated_at', `${date}T00:00:00`)
      .lte('updated_at', `${date}T23:59:59`)
      .order('updated_at', { ascending: true })
    const base = (data as unknown as ShippingOrder[]) || []
    // products can come back null if an item's product_id is orphaned (deleted product, bad data, etc.)
    setOrders(base.map(o => ({
      ...o,
      order_items: o.order_items.map(i => ({ ...i, products: i.products || { name: 'Unknown product', sku: '—' } })),
    })))
    setLoading(false)
  }

  useEffect(() => { fetchOrders() }, [orgId, date])

  const totalItems = orders.reduce((sum, o) => sum + o.order_items.reduce((s, i) => s + i.quantity_ordered, 0), 0)
  const labeled = orders.filter(o => o.tracking_number).length
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <>
      <div className="flex items-center gap-3 mb-5 print:hidden">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
        <p className="text-sm text-gray-500">{dateLabel}</p>
      </div>

      <div className="hidden print:block mb-5">
        <p className="text-base font-semibold text-gray-700">Shipping Report — {dateLabel}</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        {[{ label: 'Orders', value: orders.length }, { label: 'Total Items', value: totalItems }, { label: 'Labels Created', value: labeled }].map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-3xl font-bold text-gray-900">{c.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading...</p> : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Package size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No orders going out on this date</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Order', 'Customer', 'Items', 'Ship To', 'Carrier / Tracking', 'Status'].map(h => (
                  <th key={h} className="text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map(order => (
                <tr key={order.id} className="hover:bg-gray-50 print:hover:bg-transparent">
                  <td className="px-4 py-3 align-top">
                    <p className="font-semibold text-gray-900">#{order.order_number}</p>
                    {order.weight_oz && <p className="text-xs text-gray-400 mt-0.5">{order.weight_oz} oz</p>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-gray-900">{order.customer_name || '—'}</p>
                    {order.customer_email && <p className="text-xs text-gray-400 mt-0.5">{order.customer_email}</p>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-0.5">
                      {order.order_items.map((item, i) => (
                        <p key={i} className="text-xs text-gray-700">
                          {item.quantity_ordered}× {item.products.name}
                          <span className="text-gray-400 ml-1">({item.products.sku})</span>
                        </p>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {order.shipping_address_1 ? (
                      <div>
                        <p className="text-xs text-gray-700">{order.shipping_name || order.customer_name}</p>
                        <p className="text-xs text-gray-500">{order.shipping_address_1}</p>
                        <p className="text-xs text-gray-500">{order.shipping_city}, {order.shipping_state} {order.shipping_zip}</p>
                      </div>
                    ) : <p className="text-xs text-gray-400">No address</p>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {order.tracking_number ? (
                      <div>
                        {order.carrier && <p className="text-xs font-semibold text-gray-700 uppercase">{order.carrier}</p>}
                        <p className="text-xs font-mono text-gray-600 mt-0.5 break-all">{order.tracking_number}</p>
                      </div>
                    ) : <p className="text-xs text-gray-400">No label yet</p>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[order.status] || 'bg-gray-100 text-gray-600'}`}>
                      {order.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div suppressHydrationWarning className="hidden print:block mt-8 pt-4 border-t border-gray-200 text-xs text-gray-400 text-center">
        Generated {new Date().toLocaleString()} · {orders.length} orders · {totalItems} items
      </div>
    </>
  )
}

// ─── Inventory Snapshot Tab ───────────────────────────────────────────────────

function InventoryReport({ orgId }: { orgId: string }) {
  const supabase = createClient()
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'low' | 'zero'>('all')
  const [sortKey, setSortKey] = useState<'name' | 'qty'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    supabase
      .from('inventory')
      .select('id, qty_on_hand, qty_available, qty_reserved, qty_damaged, updated_at, products(id, name, sku, reorder_point, is_sub_product)')
      .eq('org_id', orgId)
      .then(({ data }) => { setRows(data as unknown as InventoryRow[] || []); setLoading(false) })
  }, [orgId])

  function toggleSort(key: 'name' | 'qty') {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = rows
    .filter(r => {
      if (filter === 'low') return r.products?.reorder_point && r.products.reorder_point > 0 && r.qty_available <= r.products.reorder_point
      if (filter === 'zero') return r.qty_on_hand === 0
      return true
    })
    .sort((a, b) => {
      const mult = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'name') return mult * (a.products?.name || '').localeCompare(b.products?.name || '')
      return mult * (a.qty_available - b.qty_available)
    })

  const lowCount = rows.filter(r => r.products?.reorder_point && r.products.reorder_point > 0 && r.qty_available <= r.products.reorder_point).length
  const zeroCount = rows.filter(r => r.qty_on_hand === 0).length
  const totalUnits = rows.reduce((s, r) => s + r.qty_on_hand, 0)

  const SortIcon = ({ k }: { k: 'name' | 'qty' }) => sortKey === k
    ? (sortDir === 'asc' ? <ChevronUp size={12} className="inline ml-1" /> : <ChevronDown size={12} className="inline ml-1" />)
    : null

  return (
    <>
      <div className="grid grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Total SKUs',   value: rows.length },
          { label: 'Total Units',  value: totalUnits.toLocaleString() },
          { label: 'Low Stock',    value: lowCount,  alert: lowCount > 0 },
          { label: 'Out of Stock', value: zeroCount, alert: zeroCount > 0 },
        ].map(c => (
          <div key={c.label} className={`bg-white rounded-xl border shadow-sm p-4 ${c.alert ? 'border-orange-200' : 'border-gray-100'}`}>
            <p className={`text-3xl font-bold ${c.alert ? 'text-orange-600' : 'text-gray-900'}`}>{c.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4 print:hidden">
        {[
          { key: 'all', label: `All (${rows.length})` },
          { key: 'low', label: `Low Stock (${lowCount})` },
          { key: 'zero', label: `Out of Stock (${zeroCount})` },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as any)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${filter === f.key ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading...</p> : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  Product <SortIcon k="name" />
                </th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 cursor-pointer select-none" onClick={() => toggleSort('qty')}>
                  Available <SortIcon k="qty" />
                </th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">On Hand</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Reserved</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Damaged</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Reorder @</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(row => {
                const isLow = row.products?.reorder_point && row.products.reorder_point > 0 && row.qty_available <= row.products.reorder_point
                const isZero = row.qty_on_hand === 0
                return (
                  <tr key={row.id} className={`hover:bg-gray-50 ${isZero ? 'bg-red-50/40' : isLow ? 'bg-orange-50/40' : ''}`}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{row.products?.name || '—'}</p>
                      <p className="text-xs text-gray-400 font-mono">{row.products?.sku}</p>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-bold tabular-nums ${isZero ? 'text-red-600' : isLow ? 'text-orange-600' : 'text-gray-900'}`}>
                        {row.qty_available}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600 tabular-nums">{row.qty_on_hand}</td>
                    <td className="px-5 py-3 text-right text-gray-500 tabular-nums">{row.qty_reserved}</td>
                    <td className="px-5 py-3 text-right text-gray-500 tabular-nums">{row.qty_damaged}</td>
                    <td className="px-5 py-3 text-right text-gray-400 tabular-nums">
                      {row.products?.reorder_point ?? 0}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isZero && <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">OUT</span>}
                      {!isZero && isLow && <span className="text-xs bg-orange-100 text-orange-600 font-semibold px-2 py-0.5 rounded-full">LOW</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-10 text-center text-gray-400 text-sm">No items match this filter</div>
          )}
        </div>
      )}
    </>
  )
}

// ─── Receiving History Tab ────────────────────────────────────────────────────

function ReceivingReport({ orgId }: { orgId: string }) {
  const supabase = createClient()
  const [records, setRecords] = useState<ReceivingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [days, setDays] = useState(30)

  useEffect(() => {
    const since = new Date()
    since.setDate(since.getDate() - days)
    supabase
      .from('receiving')
      .select('id, reference_number, supplier_name, status, expected_date, received_date, created_at, receiving_items(quantity_expected, quantity_received, products(name, sku))')
      .eq('org_id', orgId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRecords(data as unknown as ReceivingRecord[] || []); setLoading(false) })
  }, [orgId, days])

  const statusColor: Record<string, string> = {
    pending:     'bg-yellow-100 text-yellow-700',
    in_progress: 'bg-cyan-100 text-cyan-600',
    complete:    'bg-green-100 text-green-700',
    cancelled:   'bg-gray-100 text-gray-500',
  }

  const totalUnits = records.reduce((s, r) => s + r.receiving_items.reduce((ss, i) => ss + (i.quantity_received || 0), 0), 0)

  return (
    <>
      <div className="flex items-center gap-3 mb-5 print:hidden">
        <span className="text-sm text-gray-500">Show last</span>
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${days === d ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300'}`}
          >
            {d} days
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Receiving Records', value: records.length },
          { label: 'Completed',         value: records.filter(r => r.status === 'complete').length },
          { label: 'Units Received',    value: totalUnits.toLocaleString() },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-3xl font-bold text-gray-900">{c.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading...</p> : records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Truck size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No receiving records in this period</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
          {records.map(rec => {
            const itemsReceived = rec.receiving_items.reduce((s, i) => s + (i.quantity_received || 0), 0)
            const itemsExpected = rec.receiving_items.reduce((s, i) => s + (i.quantity_expected || 0), 0)
            const isExpanded = expanded[rec.id]
            return (
              <div key={rec.id}>
                <div
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(e => ({ ...e, [rec.id]: !e[rec.id] }))}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{rec.reference_number || 'No Ref'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {rec.supplier_name || 'Unknown supplier'} · {new Date(rec.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-700 tabular-nums">{itemsReceived} / {itemsExpected} units</p>
                      <p className="text-xs text-gray-400">{rec.receiving_items.length} SKUs</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[rec.status] || 'bg-gray-100 text-gray-500'}`}>
                      {rec.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                {isExpanded && rec.receiving_items.length > 0 && (
                  <div className="bg-gray-50 border-t border-gray-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left px-8 py-2 text-gray-500 font-medium">Product</th>
                          <th className="text-right px-5 py-2 text-gray-500 font-medium">Expected</th>
                          <th className="text-right px-5 py-2 text-gray-500 font-medium">Received</th>
                          <th className="px-5 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rec.receiving_items.map((item, i) => {
                          const done = item.quantity_received >= (item.quantity_expected || 0)
                          return (
                            <tr key={i}>
                              <td className="px-8 py-2">
                                <p className="font-medium text-gray-800">{item.products?.name || '—'}</p>
                                {item.products?.sku && <p className="font-mono text-gray-400">{item.products.sku}</p>}
                              </td>
                              <td className="px-5 py-2 text-right text-gray-600 tabular-nums">{item.quantity_expected ?? '—'}</td>
                              <td className="px-5 py-2 text-right font-medium tabular-nums">
                                <span className={done ? 'text-green-600' : item.quantity_received > 0 ? 'text-orange-600' : 'text-gray-400'}>
                                  {item.quantity_received}
                                </span>
                              </td>
                              <td className="px-5 py-2 text-right">
                                {done
                                  ? <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">✓</span>
                                  : item.quantity_received > 0
                                    ? <span className="bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-semibold">partial</span>
                                    : null}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
