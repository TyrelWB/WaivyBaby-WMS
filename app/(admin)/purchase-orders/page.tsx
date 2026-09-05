'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../admin-context'
import { useRouter } from 'next/navigation'
import { Plus, Package, Truck, Ship, ChevronRight, X, Building2 } from 'lucide-react'
import { toast } from 'sonner'

type PurchaseOrder = {
  id: string
  po_number: string
  supplier_id: string | null
  supplier_name: string | null
  status: string
  shipping_method: string | null
  eta_warehouse: string | null
  eta_port: string | null
  total_value_usd: number | null
  order_date: string
  created_at: string
  item_count: number
  suppliers: { name: string } | null
}

type Supplier = { id: string; name: string }

const statusConfig: Record<string, { label: string; color: string }> = {
  draft:         { label: 'Draft',         color: 'bg-gray-100 text-gray-600' },
  sent:          { label: 'Sent',          color: 'bg-blue-100 text-blue-700' },
  confirmed:     { label: 'Confirmed',     color: 'bg-indigo-100 text-indigo-700' },
  in_production: { label: 'In Production', color: 'bg-yellow-100 text-yellow-700' },
  shipped:       { label: 'Shipped',       color: 'bg-orange-100 text-orange-700' },
  in_transit:    { label: 'In Transit',    color: 'bg-orange-100 text-orange-700' },
  at_customs:    { label: 'At Customs',    color: 'bg-red-100 text-red-600' },
  incoming:      { label: 'Incoming',      color: 'bg-purple-100 text-purple-700' },
  received:      { label: 'Received',      color: 'bg-green-100 text-green-700' },
  closed:        { label: 'Closed',        color: 'bg-green-100 text-green-600' },
  cancelled:     { label: 'Cancelled',     color: 'bg-gray-100 text-gray-400' },
}

const ACTIVE_STATUSES = ['draft', 'sent', 'confirmed', 'in_production', 'shipped', 'in_transit', 'at_customs', 'incoming']
const DONE_STATUSES = ['received', 'closed', 'cancelled']

export default function PurchaseOrdersPage() {
  const supabase = createClient()
  const router = useRouter()
  const { orgId } = useAdminContext()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'done'>('active')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ supplier_id: '', supplier_name: '', notes: '', shipping_method: 'sea' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (orgId) { fetchOrders(); fetchSuppliers() } }, [orgId])

  async function fetchOrders() {
    const { data } = await supabase
      .from('purchase_orders')
      .select('id, po_number, supplier_id, supplier_name, status, shipping_method, eta_warehouse, eta_port, total_value_usd, order_date, created_at, suppliers(name), purchase_order_items(id)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    const mapped = (data || []).map((o: any) => ({
      ...o,
      item_count: o.purchase_order_items?.length || 0,
    }))
    setOrders(mapped)
    setLoading(false)
  }

  async function fetchSuppliers() {
    const { data } = await supabase.from('suppliers').select('id, name').eq('org_id', orgId).order('name')
    setSuppliers(data || [])
  }

  async function createPO() {
    if (!form.supplier_id && !form.supplier_name.trim()) { toast.error('Select or name a supplier'); return }
    setSaving(true)

    // Generate PO number
    const { count } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
    const poNumber = `PO-${String((count || 0) + 1).padStart(3, '0')}`

    const supplierName = form.supplier_id
      ? suppliers.find(s => s.id === form.supplier_id)?.name || form.supplier_name
      : form.supplier_name.trim()

    const { data, error } = await supabase.from('purchase_orders').insert({
      org_id: orgId,
      po_number: poNumber,
      supplier_id: form.supplier_id || null,
      supplier_name: supplierName,
      status: 'draft',
      shipping_method: form.shipping_method,
      notes: form.notes || null,
      order_date: new Date().toISOString().split('T')[0],
    }).select('id').single()

    if (error) { toast.error(error.message); setSaving(false); return }
    setSaving(false)
    setShowForm(false)
    setForm({ supplier_id: '', supplier_name: '', notes: '', shipping_method: 'sea' })
    router.push(`/purchase-orders/${data.id}`)
  }

  const displayed = orders.filter(o =>
    tab === 'active' ? ACTIVE_STATUSES.includes(o.status) : DONE_STATUSES.includes(o.status)
  )

  const activeCount = orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track supplier orders from China to your warehouse</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> New PO
        </button>
      </div>

      {/* New PO modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-gray-900 text-lg">New Purchase Order</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Supplier</label>
                {suppliers.length > 0 ? (
                  <select
                    value={form.supplier_id}
                    onChange={e => setForm({ ...form, supplier_id: e.target.value, supplier_name: '' })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— select supplier —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="__other">Other / type name</option>
                  </select>
                ) : null}
                {(!form.supplier_id || form.supplier_id === '__other') && (
                  <input
                    value={form.supplier_name}
                    onChange={e => setForm({ ...form, supplier_name: e.target.value, supplier_id: '' })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mt-2"
                    placeholder="Supplier name"
                    autoFocus={suppliers.length === 0}
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Shipping Method</label>
                <div className="flex gap-2">
                  {[{ value: 'sea', label: '🚢 Sea Freight' }, { value: 'air', label: '✈️ Air Freight' }].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setForm({ ...form, shipping_method: opt.value })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${form.shipping_method === opt.value ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2}
                  placeholder="e.g. Spring 2026 restock"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={createPO} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">
                {saving ? 'Creating...' : 'Create PO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {[
          { key: 'active', label: `Active (${activeCount})` },
          { key: 'done', label: 'Completed & Cancelled' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading...</div>
      ) : displayed.length === 0 ? (
        <div className="py-16 text-center">
          <Ship size={40} className="mx-auto mb-3 text-gray-200" />
          <p className="text-gray-400 font-medium">No purchase orders yet</p>
          <p className="text-gray-300 text-sm mt-1">Click "New PO" to create your first order</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">PO #</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Supplier</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Method</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ETA Warehouse</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Items</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Total (USD)</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.map(po => {
                const cfg = statusConfig[po.status] || statusConfig.draft
                const supplierDisplay = (po.suppliers as any)?.name || po.supplier_name || '—'
                return (
                  <tr
                    key={po.id}
                    onClick={() => router.push(`/purchase-orders/${po.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5 font-bold text-gray-900">{po.po_number}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                          <Building2 size={13} className="text-gray-400" />
                        </div>
                        <span className="text-gray-700">{supplierDisplay}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 capitalize">{po.shipping_method === 'air' ? '✈️ Air' : '🚢 Sea'}</td>
                    <td className="px-5 py-3.5 text-gray-600">
                      {po.eta_warehouse ? new Date(po.eta_warehouse).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{po.item_count}</td>
                    <td className="px-5 py-3.5 text-gray-700 font-medium">
                      {po.total_value_usd ? `$${Number(po.total_value_usd).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <ChevronRight size={16} className="text-gray-300" />
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
}
