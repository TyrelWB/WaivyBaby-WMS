'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, ClipboardList, X, CheckCircle, Clock, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../admin-context'

type CycleCount = {
  id: string
  name: string | null
  status: string
  started_at: string | null
  completed_at: string | null
  created_at: string
  assigned_to: string | null
  workers: { name: string } | null
  cycle_count_items: CycleCountItem[]
}

type CycleCountItem = {
  id: string
  product_id: string
  bin_id: string | null
  qty_expected: number
  qty_counted: number | null
  discrepancy: number | null
  counted_at: string | null
  products: { name: string; sku: string }
  bins: { location_code: string } | null
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-500',
}

const emptyForm = { name: '' }

export default function CycleCountsPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [counts, setCounts] = useState<CycleCount[]>([])
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>('active')
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null)
  const [addItemSku, setAddItemSku] = useState('')
  const [skuMatch, setSkuMatch] = useState<{ id: string; name: string; sku: string } | null>(null)

  async function fetchData() {
    if (!orgId) { setLoading(false); return }

    let query = supabase
      .from('cycle_counts')
      .select(`
        id, name, status, started_at, completed_at, created_at, assigned_to,
        workers(name),
        cycle_count_items(id, product_id, bin_id, qty_expected, qty_counted, discrepancy, counted_at, products(name, sku), bins(location_code))
      `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (filter === 'active') query = query.in('status', ['draft', 'in_progress'])
    if (filter === 'completed') query = query.eq('status', 'completed')

    const { data: countData } = await query
    const { data: workerData } = await supabase.from('workers').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name')

    setCounts(countData as unknown as CycleCount[] || [])
    setWorkers(workerData || [])
    setLoading(false)
  }

  async function createCount() {
    if (!orgId) return
    setSaving(true)

    const { error } = await supabase.from('cycle_counts').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      name: form.name || `Cycle Count ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      status: 'draft',
    })

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Cycle count created')
    setForm(emptyForm)
    setShowForm(false)
    setSaving(false)
    fetchData()
  }

  async function updateStatus(id: string, status: string) {
    const update: Record<string, string | null> = { status }
    if (status === 'in_progress') update.started_at = new Date().toISOString()
    if (status === 'completed') update.completed_at = new Date().toISOString()
    await supabase.from('cycle_counts').update(update).eq('id', id)

    if (status === 'completed') {
      // Apply discrepancies to inventory
      const count = counts.find(c => c.id === id)
      if (count) {
        for (const item of count.cycle_count_items) {
          if (item.qty_counted !== null && item.discrepancy !== 0) {
            const { data: inv } = await supabase
              .from('inventory')
              .select('id, qty_on_hand, qty_available')
              .eq('product_id', item.product_id)
              .eq('org_id', orgId)
              .single()
            if (inv) {
              await supabase.from('inventory').update({
                qty_on_hand: item.qty_counted,
                qty_available: Math.max(0, inv.qty_available + (item.discrepancy || 0)),
              }).eq('id', inv.id)
            }
          }
        }
        toast.success('Cycle count completed — inventory updated')
      }
    } else {
      toast.success(`Count ${status.replace('_', ' ')}`)
    }

    fetchData()
  }

  async function updateItemCount(itemId: string, countId: string, qtyExpected: number, newCount: string) {
    const qty = parseInt(newCount)
    if (isNaN(qty) || qty < 0) return
    const discrepancy = qty - qtyExpected

    await supabase.from('cycle_count_items').update({
      qty_counted: qty,
      counted_at: new Date().toISOString(),
    }).eq('id', itemId)

    // Update local state optimistically (discrepancy is computed as qty_counted - qty_expected)
    setCounts(prev => prev.map(c => {
      if (c.id !== countId) return c
      return {
        ...c,
        cycle_count_items: c.cycle_count_items.map(i =>
          i.id === itemId ? { ...i, qty_counted: qty, discrepancy: qty - (i.qty_expected || 0) } : i
        )
      }
    }))
  }

  async function lookupSku(sku: string) {
    if (!sku.trim() || !orgId) { setSkuMatch(null); return }
    const { data } = await supabase.from('products').select('id, name, sku').eq('org_id', orgId).ilike('sku', sku.trim()).single()
    setSkuMatch(data || null)
  }

  async function addItemToCount(countId: string) {
    if (!skuMatch) { toast.error('Enter a valid SKU first'); return }

    // Get current inventory qty for this product
    const { data: inv } = await supabase.from('inventory').select('qty_on_hand').eq('product_id', skuMatch.id).eq('org_id', orgId).single()

    const { error } = await supabase.from('cycle_count_items').insert({
      cycle_count_id: countId,
      product_id: skuMatch.id,
      qty_expected: inv?.qty_on_hand || 0,
    })

    if (error) { toast.error(error.message); return }
    toast.success(`Added ${skuMatch.name}`)
    setAddingItemTo(null)
    setAddItemSku('')
    setSkuMatch(null)
    fetchData()
  }

  async function removeCountItem(itemId: string) {
    await supabase.from('cycle_count_items').delete().eq('id', itemId)
    toast.success('Item removed')
    fetchData()
  }

  useEffect(() => { fetchData() }, [filter, orgId])

  const toggle = (id: string) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cycle Counts</h1>
          <p className="text-sm text-gray-500 mt-0.5">Physical inventory verification</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> New Count
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Cycle Count</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Count Name</label>
              <input
                value={form.name}
                onChange={e => setForm({ name: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Zone A Full Count — May 2026"
                autoFocus
              />
            </div>
            <div className="col-span-2 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createCount} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Creating...' : 'Create Count'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(['active', 'completed', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 p-6">Loading...</div>
      ) : counts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <ClipboardList size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-900">No cycle counts</p>
          <p className="text-sm text-gray-400 mt-1">Create a cycle count to verify inventory accuracy.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {counts.map(count => {
            const isExpanded = expanded[count.id]
            const itemsTotal = count.cycle_count_items.length
            const itemsCounted = count.cycle_count_items.filter(i => i.qty_counted !== null).length
            const discrepancies = count.cycle_count_items.filter(i => i.discrepancy !== null && i.discrepancy !== 0).length

            return (
              <div key={count.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-6 py-4">
                  <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                    <ClipboardList size={18} className="text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-gray-900 text-sm">{count.name || 'Unnamed Count'}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[count.status] || statusColors.draft}`}>
                        {count.status.replace('_', ' ')}
                      </span>
                      {discrepancies > 0 && count.status !== 'draft' && (
                        <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                          <AlertTriangle size={10} /> {discrepancies} discrepanc{discrepancies === 1 ? 'y' : 'ies'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {count.workers && <span>Assigned to {count.workers.name}</span>}
                      {itemsTotal > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> {itemsCounted}/{itemsTotal} counted
                        </span>
                      )}
                      {count.started_at && (
                        <span>Started {new Date(count.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {count.status === 'draft' && (
                      <button onClick={() => updateStatus(count.id, 'in_progress')} className="text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg px-2.5 py-1.5 transition-colors">
                        Start
                      </button>
                    )}
                    {count.status === 'in_progress' && (
                      <button
                        onClick={() => updateStatus(count.id, 'completed')}
                        className="text-xs text-green-600 border border-green-200 hover:bg-green-50 rounded-lg px-2.5 py-1.5 transition-colors font-medium"
                      >
                        Complete & Apply
                      </button>
                    )}
                    {count.status === 'completed' && (
                      <span className="flex items-center gap-1 text-xs text-green-500">
                        <CheckCircle size={12} /> Applied
                      </span>
                    )}
                    {itemsTotal > 0 && (
                      <button onClick={() => toggle(count.id)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && count.cycle_count_items.length > 0 && (
                  <div className="border-t border-gray-100">
                    <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 grid grid-cols-5 gap-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
                      <span className="col-span-2">Product</span>
                      <span>Location</span>
                      <span>Expected</span>
                      <span>Counted</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {count.cycle_count_items.map(item => {
                        const hasDiscrepancy = item.discrepancy !== null && item.discrepancy !== 0
                        return (
                          <div key={item.id} className={`grid grid-cols-5 gap-4 items-center px-6 py-3 ${hasDiscrepancy ? 'bg-orange-50' : ''}`}>
                            <div className="col-span-2 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{item.products.name}</p>
                              <p className="text-xs text-gray-400">{item.products.sku}</p>
                            </div>
                            <span className="text-xs font-mono text-gray-500">{item.bins?.location_code || '—'}</span>
                            <span className="text-sm font-medium text-gray-700">{item.qty_expected}</span>
                            <div className="flex items-center gap-2">
                              {count.status === 'in_progress' ? (
                                <input
                                  type="number"
                                  defaultValue={item.qty_counted ?? ''}
                                  onBlur={e => updateItemCount(item.id, count.id, item.qty_expected, e.target.value)}
                                  className={`w-20 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${hasDiscrepancy ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}`}
                                  placeholder="—"
                                  min="0"
                                />
                              ) : (
                                <span className={`text-sm font-medium ${hasDiscrepancy ? 'text-orange-600 font-bold' : 'text-gray-700'}`}>
                                  {item.qty_counted ?? '—'}
                                </span>
                              )}
                              {hasDiscrepancy && (
                                <span className={`text-xs font-bold ${(item.discrepancy || 0) > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                  {(item.discrepancy || 0) > 0 ? '+' : ''}{item.discrepancy}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Add item to count */}
                    {count.status !== 'completed' && (
                      <div className="px-6 py-3 border-t border-gray-50">
                        {addingItemTo === count.id ? (
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <input
                                value={addItemSku}
                                onChange={e => { setAddItemSku(e.target.value); lookupSku(e.target.value) }}
                                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="SKU"
                                autoFocus
                              />
                              {skuMatch && <p className="absolute left-0 -bottom-5 text-xs text-green-600">{skuMatch.name}</p>}
                            </div>
                            <button onClick={() => addItemToCount(count.id)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Add</button>
                            <button onClick={() => { setAddingItemTo(null); setAddItemSku(''); setSkuMatch(null) }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                          </div>
                        ) : (
                          <button onClick={() => setAddingItemTo(count.id)} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
                            <Plus size={12} /> Add Item to Count
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
