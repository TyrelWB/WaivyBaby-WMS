'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../admin-context'
import { Printer, Package } from 'lucide-react'

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

const statusColors: Record<string, string> = {
  packed: 'bg-pink-100 text-pink-700',
  shipping: 'bg-blue-100 text-blue-700',
  shipped: 'bg-green-100 text-green-700',
}

export default function ShippingReportPage() {
  const { orgId } = useAdminContext()
  const supabase = createClient()
  const [orders, setOrders] = useState<ShippingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  async function fetchOrders() {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(quantity_ordered, products(name, sku))')
      .eq('org_id', orgId)
      .in('status', ['packed', 'shipping', 'shipped'])
      .gte('updated_at', `${date}T00:00:00`)
      .lte('updated_at', `${date}T23:59:59`)
      .order('updated_at', { ascending: true })
    setOrders((data as unknown as ShippingOrder[]) || [])
    setLoading(false)
  }

  useEffect(() => { fetchOrders() }, [orgId, date])

  const totalItems = orders.reduce((sum, o) => sum + o.order_items.reduce((s, i) => s + i.quantity_ordered, 0), 0)
  const labeled = orders.filter(o => o.tracking_number).length
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 max-w-6xl">
      {/* Screen header */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipping Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Daily Shipping Report</h1>
        <p className="text-sm text-gray-600 mt-1">{dateLabel}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-3xl font-bold text-gray-900">{orders.length}</p>
          <p className="text-sm text-gray-500 mt-0.5">Orders</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-3xl font-bold text-gray-900">{totalItems}</p>
          <p className="text-sm text-gray-500 mt-0.5">Total Items</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-3xl font-bold text-gray-900">{labeled}</p>
          <p className="text-sm text-gray-500 mt-0.5">Labels Created</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <Package size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No orders going out on this date</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-xs font-semibold text-gray-500 px-4 py-3">Order</th>
                <th className="text-xs font-semibold text-gray-500 px-4 py-3">Customer</th>
                <th className="text-xs font-semibold text-gray-500 px-4 py-3">Items</th>
                <th className="text-xs font-semibold text-gray-500 px-4 py-3">Ship To</th>
                <th className="text-xs font-semibold text-gray-500 px-4 py-3">Carrier / Tracking</th>
                <th className="text-xs font-semibold text-gray-500 px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map(order => (
                <tr key={order.id} className="hover:bg-gray-50 print:hover:bg-transparent">
                  <td className="px-4 py-3 align-top">
                    <p className="text-sm font-semibold text-gray-900">#{order.order_number}</p>
                    {order.weight_oz && <p className="text-xs text-gray-400 mt-0.5">{order.weight_oz} oz</p>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-sm text-gray-900">{order.customer_name || '—'}</p>
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
                    ) : (
                      <p className="text-xs text-gray-400">No address</p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {order.tracking_number ? (
                      <div>
                        {order.carrier && <p className="text-xs font-semibold text-gray-700 uppercase">{order.carrier}</p>}
                        <p className="text-xs font-mono text-gray-600 mt-0.5 break-all">{order.tracking_number}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">No label yet</p>
                    )}
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

      {/* Print footer */}
      <div suppressHydrationWarning className="hidden print:block mt-8 pt-4 border-t border-gray-200 text-xs text-gray-400 text-center">
        Generated {new Date().toLocaleString()} · {orders.length} orders · {totalItems} items
      </div>
    </div>
  )
}
