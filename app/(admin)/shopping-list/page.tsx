'use client'

import { useEffect, useState } from 'react'
import { Plus, Loader2, CheckCircle, ShoppingCart, AlertTriangle, Trash2, Package } from 'lucide-react'
import { toast } from 'sonner'

type SupplyRequest = {
  id: string
  item_name: string
  quantity: number
  unit: string
  priority: 'urgent' | 'normal'
  notes: string | null
  status: 'pending' | 'ordered' | 'received'
  requested_by: string | null
  created_at: string
  ordered_at: string | null
}

export default function ShoppingListPage() {
  const [items, setItems] = useState<SupplyRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)

  const [form, setForm] = useState({
    item_name: '',
    quantity: '1',
    unit: 'units',
    priority: 'normal',
    notes: '',
    requested_by: '',
  })

  async function load() {
    const res = await fetch('/api/supply-requests')
    const data = await res.json()
    if (!data.error) setItems(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.item_name.trim()) return
    setSubmitting(true)
    const res = await fetch('/api/supply-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success('Item added to shopping list')
      setForm({ item_name: '', quantity: '1', unit: 'units', priority: 'normal', notes: '', requested_by: '' })
      setShowForm(false)
      await load()
    }
    setSubmitting(false)
  }

  async function updateStatus(id: string, status: string) {
    setUpdating(id)
    const res = await fetch(`/api/supply-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success(status === 'ordered' ? 'Marked as ordered' : 'Marked as received')
      await load()
    }
    setUpdating(null)
  }

  async function deleteItem(id: string) {
    setUpdating(id)
    const res = await fetch(`/api/supply-requests/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Item removed')
      await load()
    }
    setUpdating(null)
  }

  const urgent = items.filter(i => i.priority === 'urgent')
  const normal = items.filter(i => i.priority === 'normal')

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Shopping List</h1>
          <p className="text-sm text-gray-500 mt-0.5">Warehouse supplies that need to be ordered</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Add Item
        </button>
      </div>

      {/* Add Item Form */}
      {showForm && (
        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <p className="font-semibold text-gray-800">Add Supply Item</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Item Name *</label>
              <input
                value={form.item_name}
                onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
                placeholder="e.g. Bubble wrap, Shipping boxes 12x12"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Quantity</label>
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Unit</label>
              <input
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="boxes, rolls, bags..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Priority</label>
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Requested By</label>
              <input
                value={form.requested_by}
                onChange={e => setForm(f => ({ ...f, requested_by: e.target.value }))}
                placeholder="Your name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any extra details..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {submitting ? 'Adding...' : 'Add to List'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {items.length === 0 && !showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Package size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">No items on the shopping list</p>
          <p className="text-gray-400 text-xs mt-1">Add supplies that need to be ordered</p>
        </div>
      )}

      {/* Urgent Items */}
      {urgent.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-500" />
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Urgent</p>
          </div>
          {urgent.map(item => (
            <ItemCard key={item.id} item={item} updating={updating} onUpdate={updateStatus} onDelete={deleteItem} />
          ))}
        </div>
      )}

      {/* Normal Items */}
      {normal.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShoppingCart size={14} className="text-gray-400" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Normal</p>
          </div>
          {normal.map(item => (
            <ItemCard key={item.id} item={item} updating={updating} onUpdate={updateStatus} onDelete={deleteItem} />
          ))}
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, updating, onUpdate, onDelete }: {
  item: SupplyRequest
  updating: string | null
  onUpdate: (id: string, status: string) => void
  onDelete: (id: string) => void
}) {
  const isUpdating = updating === item.id

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 ${item.priority === 'urgent' ? 'border-red-200' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900">{item.item_name}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              item.status === 'ordered' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {item.status === 'ordered' ? 'Ordered' : 'Pending'}
            </span>
            {item.priority === 'urgent' && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">Urgent</span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-0.5">{item.quantity} {item.unit}</p>
          {item.notes && <p className="text-xs text-gray-400 mt-1">{item.notes}</p>}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            {item.requested_by && <span>Requested by {item.requested_by}</span>}
            <span>{new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            {item.ordered_at && <span>Ordered {new Date(item.ordered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.status === 'pending' && (
            <button
              onClick={() => onUpdate(item.id, 'ordered')}
              disabled={isUpdating}
              className="flex items-center gap-1.5 border border-blue-200 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
            >
              {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
              Mark Ordered
            </button>
          )}
          {item.status === 'ordered' && (
            <button
              onClick={() => onUpdate(item.id, 'received')}
              disabled={isUpdating}
              className="flex items-center gap-1.5 border border-green-200 text-green-600 hover:bg-green-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
            >
              {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
              Mark Received
            </button>
          )}
          <button
            onClick={() => onDelete(item.id)}
            disabled={isUpdating}
            className="text-gray-300 hover:text-red-400 transition-colors disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
