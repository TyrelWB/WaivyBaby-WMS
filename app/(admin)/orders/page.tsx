'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Plus, Zap, Package, ChevronRight, X, Truck, CheckSquare, Square, Users, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../admin-context'

type Order = {
  id: string
  order_number: string
  customer_name: string | null
  customer_email: string | null
  status: string
  is_rush: boolean
  is_bulk: boolean
  total_boxes: number
  created_at: string
  assigned_picker_id: string | null
  assigned_packer_id: string | null
  picker: { name: string } | null
  packer: { name: string } | null
}

type Worker = { id: string; name: string; role: string }

const STATUS_OPTIONS = ['pending', 'picking', 'packing', 'shipped', 'cancelled']

const statusColors: Record<string, string> = {
  pending:   'bg-gray-100 text-gray-600',
  picking:   'bg-amber-50 text-amber-600',
  packing:   'bg-violet-50 text-violet-600',
  shipped:   'bg-emerald-50 text-emerald-600',
  cancelled: 'bg-gray-100 text-gray-400',
}

const emptyForm = {
  order_number: '',
  customer_name: '',
  customer_email: '',
  notes: '',
  is_rush: false,
  is_bulk: false,
  total_boxes: 1,
}

export default function OrdersPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [orders, setOrders] = useState<Order[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [shippingOrder, setShippingOrder] = useState<string | null>(null)
  const [shipForm, setShipForm] = useState({ carrier: '', tracking_number: '' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPicker, setBulkPicker] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)

  async function fetchAll() {
    if (!orgId) { setLoading(false); return }

    const [{ data: orderData }, { data: workerData }] = await Promise.all([
      supabase
        .from('orders')
        .select('id, order_number, customer_name, customer_email, status, is_rush, is_bulk, total_boxes, created_at, assigned_picker_id, assigned_packer_id, picker:workers!assigned_picker_id(name), packer:workers!assigned_packer_id(name)')
        .eq('org_id', orgId)
        .order('is_rush', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('workers')
        .select('id, name, role')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name'),
    ])

    setOrders(orderData as unknown as Order[] || [])
    setWorkers(workerData || [])
    setLoading(false)
  }

  async function createOrder() {
    if (!form.order_number.trim()) { toast.error('Order number is required'); return }
    if (!orgId) return
    setSaving(true)

    const { error } = await supabase.from('orders').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      order_number: form.order_number.trim(),
      customer_name: form.customer_name.trim() || null,
      customer_email: form.customer_email.trim() || null,
      notes: form.notes.trim() || null,
      is_rush: form.is_rush,
      is_bulk: form.is_bulk,
      total_boxes: form.total_boxes,
      barcode: `ORD-${form.order_number.trim()}`,
    })

    if (error) {
      toast.error(error.message.includes('unique') ? 'Order number already exists' : error.message)
      setSaving(false)
      return
    }

    toast.success('Order created')
    setForm(emptyForm)
    setShowForm(false)
    setSaving(false)
    fetchAll()
  }

  async function assignPicker(orderId: string, workerId: string | null) {
    await supabase.from('orders').update({
      assigned_picker_id: workerId,
      status: workerId ? 'picking' : 'pending',
    }).eq('id', orderId)
    toast.success(workerId ? 'Picker assigned' : 'Picker removed')
    fetchAll()
  }

  async function shipOrder(orderId: string) {
    if (!shipForm.carrier.trim()) { toast.error('Carrier is required'); return }
    await supabase.from('orders').update({
      status: 'shipped',
      carrier: shipForm.carrier.trim(),
      tracking_number: shipForm.tracking_number.trim() || null,
      shipped_at: new Date().toISOString(),
    }).eq('id', orderId)
    toast.success('Order marked as shipped')
    setShippingOrder(null)
    setShipForm({ carrier: '', tracking_number: '' })
    fetchAll()
  }

  async function assignPacker(orderId: string, workerId: string | null) {
    await supabase.from('orders').update({ assigned_packer_id: workerId }).eq('id', orderId)
    toast.success(workerId ? 'Packer assigned' : 'Packer removed')
    fetchAll()
  }

  async function bulkAssignPicker() {
    if (!bulkPicker || selected.size === 0) return
    setBulkAssigning(true)
    const ids = Array.from(selected)
    await supabase.from('orders').update({
      assigned_picker_id: bulkPicker,
      status: 'picking',
    }).in('id', ids)
    toast.success(`Assigned ${ids.length} order${ids.length !== 1 ? 's' : ''} to picker`)
    setSelected(new Set())
    setBulkPicker('')
    setBulkAssigning(false)
    fetchAll()
  }

  async function updateStatus(orderId: string, status: string) {
    await supabase.from('orders').update({ status }).eq('id', orderId)
    toast.success(`Order marked as ${status}`)
    fetchAll()
  }

  async function deleteOrder(id: string) {
    toast('Delete this order?', {
      action: {
        label: 'Delete', onClick: async () => {
          await supabase.from('orders').delete().eq('id', id)
          toast.success('Order deleted')
          fetchAll()
        }
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    })
  }

  useEffect(() => { fetchAll() }, [orgId])

  const activeStatuses = ['pending', 'picking', 'packing']

  const filtered = orders.filter(o => {
    const q = search.toLowerCase()
    const matchSearch = !q || o.order_number.toLowerCase().includes(q) ||
      (o.customer_name || '').toLowerCase().includes(q) ||
      (o.customer_email || '').toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' ? true :
      statusFilter === 'active' ? activeStatuses.includes(o.status) :
      o.status === statusFilter
    return matchSearch && matchStatus
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} orders</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          <Plus size={16} /> New Order
        </button>
      </div>

      {/* Create order form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Order</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Order Number <span className="text-red-400">*</span></label>
              <input value={form.order_number} onChange={e => setForm({ ...form, order_number: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="e.g. 1042" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Customer Name</label>
              <input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Customer Email</label>
              <input type="email" value={form.customer_email} onChange={e => setForm({ ...form, customer_email: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="john@example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Total Boxes</label>
              <input type="number" min={1} value={form.total_boxes} onChange={e => setForm({ ...form, total_boxes: parseInt(e.target.value) || 1 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes / Special Instructions</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 resize-none" rows={2} placeholder="Fragile, gift wrap, etc." />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_rush} onChange={e => setForm({ ...form, is_rush: e.target.checked })} className="w-4 h-4 rounded text-red-500" />
                <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Zap size={13} className="text-red-500" /> Rush</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_bulk} onChange={e => setForm({ ...form, is_bulk: e.target.checked })} className="w-4 h-4 rounded text-purple-500" />
                <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Package size={13} className="text-purple-500" /> Bulk</span>
              </label>
            </div>
            <div className="flex gap-3 justify-end items-end">
              <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createOrder} disabled={saving} className="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                {saving ? 'Creating...' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
        </div>
        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
          {['active', 'all', 'shipped', 'cancelled'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-cyan-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 bg-cyan-50 border border-cyan-200 rounded-xl px-5 py-3">
          <Users size={15} className="text-cyan-500 shrink-0" />
          <span className="text-sm font-semibold text-cyan-800">{selected.size} order{selected.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-cyan-500">Assign to:</span>
            <select
              value={bulkPicker}
              onChange={e => setBulkPicker(e.target.value)}
              className="text-xs border border-cyan-300 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              <option value="">— select specialist —</option>
              {workers.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <button
              onClick={bulkAssignPicker}
              disabled={!bulkPicker || bulkAssigning}
              className="text-xs bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg font-medium"
            >
              {bulkAssigning ? 'Assigning...' : 'Assign'}
            </button>
          </div>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-cyan-500 hover:text-cyan-600 font-medium"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Orders table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading orders...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">No orders found.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 w-10">
                  <button
                    onClick={() => {
                      if (selected.size === filtered.length) setSelected(new Set())
                      else setSelected(new Set(filtered.map(o => o.id)))
                    }}
                    className="text-gray-400 hover:text-cyan-500"
                  >
                    {selected.size === filtered.length && filtered.length > 0
                      ? <CheckSquare size={16} className="text-cyan-500" />
                      : <Square size={16} />}
                  </button>
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Order</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Customer</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Specialist</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Packer</th>

                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(order => (
                <tr key={order.id} className={`hover:bg-gray-50 transition-colors ${selected.has(order.id) ? 'bg-cyan-50' : ''}`}>
                  <td className="px-4 py-3.5">
                    <button onClick={() => {
                      const next = new Set(selected)
                      next.has(order.id) ? next.delete(order.id) : next.add(order.id)
                      setSelected(next)
                    }} className="text-gray-300 hover:text-cyan-500">
                      {selected.has(order.id)
                        ? <CheckSquare size={16} className="text-cyan-500" />
                        : <Square size={16} />}
                    </button>
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      <a href={`/orders/${order.id}`} className="font-semibold text-sm text-gray-900 hover:text-cyan-500">
                        #{order.order_number}
                      </a>
                      {order.is_rush && <span className="text-xs bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded">RUSH</span>}
                      {order.is_bulk && <span className="text-xs bg-purple-100 text-purple-600 font-bold px-1.5 py-0.5 rounded">BULK</span>}
                      {order.total_boxes > 1 && <span className="text-xs text-gray-400">{order.total_boxes} boxes</span>}
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <p className="text-sm text-gray-900">{order.customer_name || <span className="text-gray-300">—</span>}</p>
                    {order.customer_email && <p className="text-xs text-gray-400">{order.customer_email}</p>}
                  </td>
                  <td className="px-6 py-3.5">
                    <select
                      value={order.status}
                      onChange={e => updateStatus(order.id, e.target.value)}
                      className={`text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer capitalize ${statusColors[order.status] || 'bg-gray-100 text-gray-600'}`}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s} className="bg-white text-gray-900">{s.replace('_', ' ')}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-3.5">
                    <select
                      value={order.assigned_picker_id || ''}
                      onChange={e => assignPicker(order.id, e.target.value || null)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                    >
                      <option value="">Unassigned</option>
                      {workers.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-3.5">
                    <select
                      value={order.assigned_packer_id || ''}
                      onChange={e => assignPacker(order.id, e.target.value || null)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      <option value="">Unassigned</option>
                      {workers.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-gray-400">
                    {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      <a href={`/orders/${order.id}`} className="flex items-center gap-0.5 text-xs text-cyan-500 hover:text-cyan-600 font-medium">
                        View <ChevronRight size={12} />
                      </a>
                      <a href={`/print/order/${order.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 font-medium">
                        <Printer size={11} /> Print
                      </a>
                      {(order.status === 'packed' || order.status === 'shipping') && (
                        <button onClick={() => { setShippingOrder(order.id); setShipForm({ carrier: '', tracking_number: '' }) }} className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium">
                          <Truck size={11} /> Ship
                        </button>
                      )}
                      <button onClick={() => deleteOrder(order.id)} className="text-xs text-red-400 hover:text-red-600 font-medium">Delete</button>
                    </div>
                    {shippingOrder === order.id && (
                      <div className="mt-2 flex items-center gap-2">
                        <input value={shipForm.carrier} onChange={e => setShipForm({ ...shipForm, carrier: e.target.value })} placeholder="Carrier (UPS, FedEx...)" className="border border-gray-200 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-green-500" autoFocus />
                        <input value={shipForm.tracking_number} onChange={e => setShipForm({ ...shipForm, tracking_number: e.target.value })} placeholder="Tracking #" className="border border-gray-200 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-green-500" />
                        <button onClick={() => shipOrder(order.id)} className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded font-medium">Confirm</button>
                        <button onClick={() => setShippingOrder(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
