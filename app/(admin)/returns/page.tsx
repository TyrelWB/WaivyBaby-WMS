'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, RotateCcw, X, Package, CheckCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../admin-context'

type Return = {
  id: string
  rma_number: string | null
  order_id: string | null
  customer_name: string | null
  reason: string | null
  status: string
  created_at: string
  resolved_at: string | null
  notes: string | null
  orders: { order_number: string } | null
  return_items: ReturnItem[]
}

type ReturnItem = {
  id: string
  product_id: string
  quantity_returned: number
  condition: string
  restock: boolean
  products: { name: string; sku: string }
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  inspecting: 'bg-blue-100 text-blue-700',
  restocked: 'bg-green-100 text-green-700',
  disposed: 'bg-gray-100 text-gray-500',
  refunded: 'bg-purple-100 text-purple-700',
}

const conditionColors: Record<string, string> = {
  new: 'bg-green-100 text-green-700',
  good: 'bg-blue-100 text-blue-700',
  damaged: 'bg-red-100 text-red-700',
  unsellable: 'bg-gray-100 text-gray-500',
}

const emptyForm = { rma_number: '', customer_name: '', order_number: '', reason: '', notes: '' }

export default function ReturnsPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [returns, setReturns] = useState<Return[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'active' | 'resolved' | 'all'>('active')
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null)
  const [addItemForm, setAddItemForm] = useState({ sku: '', quantity: '1', condition: 'good' })
  const [skuMatch, setSkuMatch] = useState<{ id: string; name: string; sku: string } | null>(null)

  async function fetchReturns() {
    if (!orgId) { setLoading(false); return }

    let query = supabase
      .from('returns')
      .select(`
        id, rma_number, order_id, customer_name, reason, status, created_at, resolved_at, notes,
        orders(order_number),
        return_items(id, product_id, quantity_returned, condition, restock, products(name, sku))
      `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (filter === 'active') query = query.in('status', ['pending', 'inspecting'])
    if (filter === 'resolved') query = query.in('status', ['restocked', 'disposed', 'refunded'])

    const { data } = await query
    setReturns(data as unknown as Return[] || [])
    setLoading(false)
  }

  async function createReturn() {
    if (!orgId) return
    setSaving(true)

    // Look up order by order_number if provided
    let orderId: string | null = null
    if (form.order_number.trim()) {
      const { data: orderData } = await supabase
        .from('orders')
        .select('id')
        .eq('org_id', orgId)
        .eq('order_number', form.order_number.trim())
        .single()
      orderId = orderData?.id || null
    }

    const { error } = await supabase.from('returns').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      rma_number: form.rma_number || null,
      order_id: orderId,
      customer_name: form.customer_name || null,
      reason: form.reason || null,
      notes: form.notes || null,
      status: 'pending',
    })

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Return created')
    setForm(emptyForm)
    setShowForm(false)
    setSaving(false)
    fetchReturns()
  }

  async function updateStatus(id: string, status: string) {
    const update: Record<string, string | null> = { status }
    if (['restocked', 'disposed', 'refunded'].includes(status)) {
      update.resolved_at = new Date().toISOString()
    }
    await supabase.from('returns').update(update).eq('id', id)
    toast.success(`Return marked as ${status}`)
    fetchReturns()
  }

  async function toggleRestock(itemId: string, current: boolean, productId: string, qty: number) {
    await supabase.from('return_items').update({ restock: !current }).eq('id', itemId)

    if (!current) {
      // Restock: add back to inventory
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, qty_on_hand, qty_available')
        .eq('product_id', productId)
        .eq('org_id', orgId)
        .single()
      if (inv) {
        await supabase.from('inventory').update({
          qty_on_hand: inv.qty_on_hand + qty,
          qty_available: inv.qty_available + qty,
        }).eq('id', inv.id)
        toast.success('Item restocked to inventory')
      }
    } else {
      toast.success('Restock flag removed')
    }
    fetchReturns()
  }

  async function lookupSku(sku: string) {
    if (!sku.trim() || !orgId) { setSkuMatch(null); return }
    const { data } = await supabase.from('products').select('id, name, sku').eq('org_id', orgId).ilike('sku', sku.trim()).single()
    setSkuMatch(data || null)
  }

  async function addItemToReturn(returnId: string) {
    if (!skuMatch) { toast.error('Enter a valid SKU first'); return }
    const qty = parseInt(addItemForm.quantity)
    if (isNaN(qty) || qty < 1) { toast.error('Enter a valid quantity'); return }

    const { error } = await supabase.from('return_items').insert({
      return_id: returnId,
      product_id: skuMatch.id,
      quantity_returned: qty,
      condition: addItemForm.condition,
      restock: false,
    })

    if (error) { toast.error(error.message); return }
    toast.success(`Added ${skuMatch.name}`)
    setAddingItemTo(null)
    setAddItemForm({ sku: '', quantity: '1', condition: 'good' })
    setSkuMatch(null)
    fetchReturns()
  }

  async function removeReturnItem(itemId: string) {
    await supabase.from('return_items').delete().eq('id', itemId)
    toast.success('Item removed')
    fetchReturns()
  }

  useEffect(() => { fetchReturns() }, [filter, orgId])

  const toggle = (id: string) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Returns</h1>
          <p className="text-sm text-gray-500 mt-0.5">Customer returns and RMAs</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> New Return
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Return</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">RMA Number</label>
              <input value={form.rma_number} onChange={e => setForm({ ...form, rma_number: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="RMA-001" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Order Number</label>
              <input value={form.order_number} onChange={e => setForm({ ...form, order_number: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="ORD-1001" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Customer Name</label>
              <input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Jane Smith" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reason</label>
              <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select reason</option>
                <option value="wrong_item">Wrong item shipped</option>
                <option value="damaged">Arrived damaged</option>
                <option value="not_as_described">Not as described</option>
                <option value="changed_mind">Changed mind</option>
                <option value="defective">Defective</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Optional notes" />
            </div>
            <div className="col-span-2 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createReturn} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Creating...' : 'Create Return'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(['active', 'resolved', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 p-6">Loading...</div>
      ) : returns.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <RotateCcw size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-900">{filter === 'active' ? 'No active returns' : 'No returns found'}</p>
          <p className="text-sm text-gray-400 mt-1">Returns will appear here when customers send items back.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {returns.map(ret => {
            const isExpanded = expanded[ret.id]
            const reasonLabels: Record<string, string> = {
              wrong_item: 'Wrong item', damaged: 'Damaged', not_as_described: 'Not as described',
              changed_mind: 'Changed mind', defective: 'Defective', other: 'Other',
            }

            return (
              <div key={ret.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-6 py-4">
                  <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center shrink-0">
                    <RotateCcw size={18} className="text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-gray-900 text-sm">{ret.rma_number || 'No RMA#'}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[ret.status] || statusColors.pending}`}>
                        {ret.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      {ret.customer_name && <span>{ret.customer_name}</span>}
                      {ret.orders && <span>Order #{ret.orders.order_number}</span>}
                      {ret.reason && <span>{reasonLabels[ret.reason] || ret.reason}</span>}
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {new Date(ret.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    {ret.notes && <p className="text-xs text-gray-400 mt-1 italic">{ret.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ret.status === 'pending' && (
                      <button onClick={() => updateStatus(ret.id, 'inspecting')} className="text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg px-2.5 py-1.5 transition-colors">
                        Start Inspection
                      </button>
                    )}
                    {ret.status === 'inspecting' && (
                      <div className="flex gap-1.5">
                        <button onClick={() => updateStatus(ret.id, 'restocked')} className="text-xs text-green-600 border border-green-200 hover:bg-green-50 rounded-lg px-2.5 py-1.5 transition-colors font-medium">Restock</button>
                        <button onClick={() => updateStatus(ret.id, 'disposed')} className="text-xs text-gray-500 border border-gray-200 hover:bg-gray-50 rounded-lg px-2.5 py-1.5 transition-colors">Dispose</button>
                        <button onClick={() => updateStatus(ret.id, 'refunded')} className="text-xs text-purple-600 border border-purple-200 hover:bg-purple-50 rounded-lg px-2.5 py-1.5 transition-colors">Refunded</button>
                      </div>
                    )}
                    {ret.status !== 'pending' && ret.status !== 'inspecting' && (
                      <span className="flex items-center gap-1 text-xs text-green-500">
                        <CheckCircle size={12} /> Done
                      </span>
                    )}
                    <button onClick={() => toggle(ret.id)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {ret.return_items.map(item => (
                      <div key={item.id} className="flex items-center gap-4 px-6 py-3 border-b border-gray-50">
                        <Package size={14} className="text-gray-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{item.products.name}</p>
                          <p className="text-xs text-gray-400">SKU: {item.products.sku} · Qty: {item.quantity_returned}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${conditionColors[item.condition] || conditionColors.good}`}>
                            {item.condition}
                          </span>
                          {ret.status === 'inspecting' && (
                            <button
                              onClick={() => toggleRestock(item.id, item.restock, item.product_id, item.quantity_returned)}
                              className={`text-xs border rounded-lg px-2.5 py-1 transition-colors ${item.restock ? 'text-green-600 border-green-300 bg-green-50' : 'text-gray-500 border-gray-200'}`}
                            >
                              {item.restock ? 'Restocked' : 'Restock?'}
                            </button>
                          )}
                          {(ret.status === 'pending' || ret.status === 'inspecting') && (
                            <button onClick={() => removeReturnItem(item.id)} className="text-gray-300 hover:text-red-400 transition-colors"><X size={14} /></button>
                          )}
                        </div>
                      </div>
                    ))}

                    {(ret.status === 'pending' || ret.status === 'inspecting') && (
                      <div className="px-6 py-3">
                        {addingItemTo === ret.id ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                              <input
                                value={addItemForm.sku}
                                onChange={e => { setAddItemForm(f => ({ ...f, sku: e.target.value })); lookupSku(e.target.value) }}
                                className="w-28 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="SKU"
                                autoFocus
                              />
                              {skuMatch && <p className="absolute left-0 -bottom-5 text-xs text-green-600 whitespace-nowrap">{skuMatch.name}</p>}
                            </div>
                            <input type="number" value={addItemForm.quantity} onChange={e => setAddItemForm(f => ({ ...f, quantity: e.target.value }))} className="w-16 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Qty" min="1" />
                            <select value={addItemForm.condition} onChange={e => setAddItemForm(f => ({ ...f, condition: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                              <option value="new">New</option>
                              <option value="good">Good</option>
                              <option value="damaged">Damaged</option>
                              <option value="unsellable">Unsellable</option>
                            </select>
                            <button onClick={() => addItemToReturn(ret.id)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Add</button>
                            <button onClick={() => { setAddingItemTo(null); setAddItemForm({ sku: '', quantity: '1', condition: 'good' }); setSkuMatch(null) }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                          </div>
                        ) : (
                          <button onClick={() => setAddingItemTo(ret.id)} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
                            <Plus size={12} /> Add Item
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
