'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Truck, X, Package, CheckCircle, Clock, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../admin-context'

type ReceivingRecord = {
  id: string
  reference_number: string | null
  supplier_name: string | null
  status: string
  expected_date: string | null
  received_date: string | null
  notes: string | null
  created_at: string
  receiving_items: ReceivingItem[]
}

type ReceivingItem = {
  id: string
  product_id: string
  quantity_expected: number
  quantity_received: number
  status: string
  products: { name: string; sku: string }
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

const emptyForm = { reference_number: '', supplier_name: '', expected_date: '', notes: '' }

export default function ReceivingPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [records, setRecords] = useState<ReceivingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'active' | 'complete' | 'all'>('active')
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null)
  const [itemForm, setItemForm] = useState({ sku: '', quantity_expected: '' })
  const [skuMatch, setSkuMatch] = useState<{ id: string; name: string; sku: string } | null>(null)

  async function fetchRecords() {
    if (!orgId) { setLoading(false); return }

    let query = supabase
      .from('receiving')
      .select(`
        id, reference_number, supplier_name, status, expected_date, received_date, notes, created_at,
        receiving_items(id, product_id, quantity_expected, quantity_received, status, products(name, sku))
      `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (filter === 'active') query = query.in('status', ['pending', 'in_progress'])
    if (filter === 'complete') query = query.eq('status', 'complete')

    const { data } = await query
    setRecords(data as unknown as ReceivingRecord[] || [])
    setLoading(false)
  }

  async function createRecord() {
    if (!orgId || !warehouseId) return
    setSaving(true)

    const { error } = await supabase.from('receiving').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      reference_number: form.reference_number || null,
      supplier_name: form.supplier_name || null,
      status: 'pending',
      expected_date: form.expected_date || null,
      notes: form.notes || null,
    })

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Receiving record created')
    setForm(emptyForm)
    setShowForm(false)
    setSaving(false)
    fetchRecords()
  }

  async function lookupSku(sku: string) {
    if (!sku.trim() || !orgId) { setSkuMatch(null); return }
    const { data } = await supabase.from('products').select('id, name, sku').eq('org_id', orgId).ilike('sku', sku.trim()).single()
    setSkuMatch(data || null)
  }

  async function addItemToRecord(receivingId: string) {
    if (!skuMatch) { toast.error('Enter a valid SKU first'); return }
    const qty = parseInt(itemForm.quantity_expected)
    if (isNaN(qty) || qty < 1) { toast.error('Enter a valid quantity'); return }

    const { error } = await supabase.from('receiving_items').insert({
      receiving_id: receivingId,
      product_id: skuMatch.id,
      quantity_expected: qty,
      quantity_received: 0,
      status: 'pending',
    })

    if (error) { toast.error(error.message); return }
    toast.success(`Added ${skuMatch.name}`)
    setAddingItemTo(null)
    setItemForm({ sku: '', quantity_expected: '' })
    setSkuMatch(null)
    fetchRecords()
  }

  async function removeItemFromRecord(itemId: string) {
    await supabase.from('receiving_items').delete().eq('id', itemId)
    toast.success('Item removed')
    fetchRecords()
  }

  async function updateStatus(id: string, status: string) {
    const update: Record<string, string | null> = { status }
    if (status === 'complete') update.received_date = new Date().toISOString()
    await supabase.from('receiving').update(update).eq('id', id)
    toast.success(`Marked as ${status.replace('_', ' ')}`)
    fetchRecords()
  }

  async function adjustReceivedQty(itemId: string, receivingId: string, delta: number) {
    const record = records.find(r => r.id === receivingId)
    const item = record?.receiving_items.find(i => i.id === itemId)
    if (!item) return

    const newQty = Math.max(0, item.quantity_received + delta)
    const done = newQty >= item.quantity_expected
    await supabase.from('receiving_items').update({
      quantity_received: newQty,
      status: done ? 'received' : newQty > 0 ? 'partial' : 'pending',
    }).eq('id', itemId)

    if (done) {
      // Update inventory directly
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, qty_on_hand, qty_available')
        .eq('product_id', item.product_id)
        .eq('org_id', orgId)
        .single()
      if (inv) {
        await supabase.from('inventory').update({
          qty_on_hand: inv.qty_on_hand + delta,
          qty_available: inv.qty_available + delta,
        }).eq('id', inv.id)
      }
    }

    fetchRecords()
  }

  useEffect(() => { fetchRecords() }, [filter, orgId])

  const toggle = (id: string) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Receiving</h1>
          <p className="text-sm text-gray-500 mt-0.5">Inbound shipments and purchase orders</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> New Shipment
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Receiving Record</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reference / PO Number</label>
              <input value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="PO-12345" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Supplier / Vendor</label>
              <input value={form.supplier_name} onChange={e => setForm({ ...form, supplier_name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Acme Corp" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Expected Date</label>
              <input type="date" value={form.expected_date} onChange={e => setForm({ ...form, expected_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Optional notes" />
            </div>
            <div className="col-span-2 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createRecord} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                {saving ? 'Creating...' : 'Create Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(['active', 'complete', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 p-6">Loading...</div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <Truck size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-900">No receiving records</p>
          <p className="text-sm text-gray-400 mt-1">Create a new shipment record when goods arrive.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map(record => {
            const totalItems = record.receiving_items.reduce((s, i) => s + i.quantity_expected, 0)
            const receivedItems = record.receiving_items.reduce((s, i) => s + i.quantity_received, 0)
            const isExpanded = expanded[record.id]

            return (
              <div key={record.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-6 py-4">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                    <Truck size={18} className="text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-gray-900 text-sm">{record.reference_number || 'No reference'}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[record.status] || statusColors.pending}`}>
                        {record.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {record.supplier_name && <span>{record.supplier_name}</span>}
                      {record.expected_date && (
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> Expected {new Date(record.expected_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {record.receiving_items.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Package size={10} /> {receivedItems}/{totalItems} received
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {record.status === 'pending' && (
                      <button onClick={() => { updateStatus(record.id, 'in_progress'); setExpanded(p => ({ ...p, [record.id]: true })) }} className="text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg px-2.5 py-1.5 transition-colors">
                        Start
                      </button>
                    )}
                    {record.status === 'in_progress' && (
                      <button onClick={() => updateStatus(record.id, 'complete')} className="text-xs text-green-600 border border-green-200 hover:bg-green-50 rounded-lg px-2.5 py-1.5 transition-colors font-medium">
                        Complete
                      </button>
                    )}
                    <button onClick={() => toggle(record.id)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {record.receiving_items.map(item => (
                      <div key={item.id} className="flex items-center gap-4 px-6 py-3 border-b border-gray-50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{item.products.name}</p>
                          <p className="text-xs text-gray-400">SKU: {item.products.sku}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${item.status === 'received' ? 'bg-green-100 text-green-700' : item.status === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                            {item.status}
                          </span>
                          {record.status === 'in_progress' && (
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => adjustReceivedQty(item.id, record.id, -1)} className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center">-</button>
                              <span className="text-sm font-semibold text-gray-900 w-16 text-center">{item.quantity_received}/{item.quantity_expected}</span>
                              <button onClick={() => adjustReceivedQty(item.id, record.id, 1)} className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center">+</button>
                            </div>
                          )}
                          {record.status !== 'in_progress' && (
                            <span className="text-sm font-semibold text-gray-700">{item.quantity_received}/{item.quantity_expected}</span>
                          )}
                          {item.status === 'received' && <CheckCircle size={14} className="text-green-500" />}
                          {record.status !== 'complete' && (
                            <button onClick={() => removeItemFromRecord(item.id)} className="text-gray-300 hover:text-red-400 transition-colors"><X size={14} /></button>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Add item row */}
                    {record.status !== 'complete' && (
                      <div className="px-6 py-3">
                        {addingItemTo === record.id ? (
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <input
                                value={itemForm.sku}
                                onChange={e => { setItemForm(f => ({ ...f, sku: e.target.value })); lookupSku(e.target.value) }}
                                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="SKU"
                                autoFocus
                              />
                              {skuMatch && <p className="absolute left-0 -bottom-5 text-xs text-green-600">{skuMatch.name}</p>}
                            </div>
                            <input
                              type="number"
                              value={itemForm.quantity_expected}
                              onChange={e => setItemForm(f => ({ ...f, quantity_expected: e.target.value }))}
                              className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Qty"
                              min="1"
                            />
                            <button onClick={() => addItemToRecord(record.id)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Add</button>
                            <button onClick={() => { setAddingItemTo(null); setItemForm({ sku: '', quantity_expected: '' }); setSkuMatch(null) }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                          </div>
                        ) : (
                          <button onClick={() => { setAddingItemTo(record.id); setExpanded(p => ({ ...p, [record.id]: true })) }} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
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
