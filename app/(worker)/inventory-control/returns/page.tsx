'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Plus, RotateCcw, X, Package, Clock, Scan } from 'lucide-react'
import { toast } from 'sonner'
import CameraScanner from '@/components/CameraScanner'
import { lookupProductIdByBarcode } from '@/lib/barcode'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type ReturnItem = { id: string; quantity_returned: number; condition: string; products: { name: string; sku: string } }
type Return = {
  id: string; rma_number: string | null; customer_name: string | null; reason: string | null
  status: string; created_at: string; notes: string | null; return_items: ReturnItem[]
}

const emptyForm = { rma_number: '', customer_name: '', order_number: '', reason: '', notes: '' }
const conditionColors: Record<string, string> = {
  new: 'bg-green-100 text-green-700', good: 'bg-cyan-100 text-cyan-600',
  damaged: 'bg-red-100 text-red-700', unsellable: 'bg-gray-100 text-gray-500',
}
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', inspecting: 'bg-cyan-100 text-cyan-600',
  restocked: 'bg-green-100 text-green-700', disposed: 'bg-gray-100 text-gray-500', refunded: 'bg-purple-100 text-purple-700',
}

export default function InventoryReturnsPage() {
  const supabase = createClient()
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [returns, setReturns] = useState<Return[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null)
  const [addItemForm, setAddItemForm] = useState({ sku: '', quantity: '1', condition: 'good' })
  const [skuMatch, setSkuMatch] = useState<{ id: string; name: string; sku: string } | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const skuInputRef = useRef<HTMLInputElement>(null)

  // Keep the SKU field focused so a scan gun can add several return items
  // back-to-back without clicking "Add Item" again each time.
  useEffect(() => {
    if (addingItemTo) skuInputRef.current?.focus()
  }, [addingItemTo])

  async function fetchReturns(session: WorkerSession) {
    const { data } = await supabase
      .from('returns')
      .select(`
        id, rma_number, customer_name, reason, status, created_at, notes,
        return_items(id, quantity_returned, condition, products(name, sku))
      `)
      .eq('org_id', session.orgId)
      .in('status', ['pending', 'inspecting'])
      .order('created_at', { ascending: false })
    const base = (data as unknown as Return[]) || []
    setReturns(base.map(r => ({
      ...r,
      return_items: r.return_items.map(i => ({ ...i, products: i.products || { name: 'Unknown product', sku: '—' } })),
    })))
    setLoading(false)
  }

  useEffect(() => {
    fetch('/api/worker-session').then(r => r.ok ? r.json() : null).then(session => {
      if (session) { setWorker(session); fetchReturns(session) } else setLoading(false)
    })
  }, [])

  async function createReturn() {
    if (!worker) return
    setSaving(true)
    let orderId: string | null = null
    if (form.order_number.trim()) {
      const { data } = await supabase.from('orders').select('id').eq('org_id', worker.orgId).eq('order_number', form.order_number.trim()).single()
      orderId = data?.id || null
    }
    const { error } = await supabase.from('returns').insert({
      org_id: worker.orgId, warehouse_id: worker.warehouseId,
      rma_number: form.rma_number || null, order_id: orderId,
      customer_name: form.customer_name || null, reason: form.reason || null,
      notes: form.notes || null, status: 'pending',
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Return logged')
    setForm(emptyForm)
    setShowForm(false)
    setSaving(false)
    fetchReturns(worker)
  }

  async function lookupSku(sku: string) {
    if (!sku.trim() || !worker) { setSkuMatch(null); return }
    const { data } = await supabase.from('products').select('id, name, sku').eq('org_id', worker.orgId).ilike('sku', sku.trim()).single()
    setSkuMatch(data || null)
  }

  async function handleBarcodeScan(raw: string) {
    setShowScanner(false)
    const productId = await lookupProductIdByBarcode(supabase, raw.trim())
    if (!productId) { toast.error(`Unknown barcode: ${raw.trim()}`); return }
    const { data: p } = await supabase.from('products').select('id, name, sku').eq('id', productId).single()
    if (!p) { toast.error(`Unknown barcode: ${raw.trim()}`); return }
    setAddItemForm(f => ({ ...f, sku: p.sku }))
    setSkuMatch(p)
  }

  async function addItemToReturn(returnId: string, product?: { id: string; name: string; sku: string }) {
    const match = product || skuMatch
    if (!match) { toast.error('Enter a valid SKU first'); return }
    const qty = parseInt(addItemForm.quantity)
    if (isNaN(qty) || qty < 1) { toast.error('Enter a valid quantity'); return }
    const { error } = await supabase.from('return_items').insert({
      return_id: returnId, product_id: match.id, quantity_returned: qty,
      condition: addItemForm.condition, restock: false,
    })
    if (error) { toast.error(error.message); return }
    toast.success(`Added ${match.name}`)
    // Stay in "adding item" mode so a scan gun can keep adding items to
    // this same return without clicking "Add Item" again.
    setAddItemForm(f => ({ ...f, sku: '' }))
    setSkuMatch(null)
    if (worker) fetchReturns(worker)
  }

  // A scan gun just types into the focused field and sends Enter — do an
  // authoritative exact match instead of trusting the (possibly still
  // in-flight) fuzzy skuMatch state, then add it immediately.
  async function handleSkuEnter(returnId: string) {
    const raw = addItemForm.sku.trim()
    if (!raw) return
    const productId = await lookupProductIdByBarcode(supabase, raw)
    if (!productId) return
    const { data: p } = await supabase.from('products').select('id, name, sku').eq('id', productId).single()
    if (p) await addItemToReturn(returnId, p)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 sm:px-8 py-4 flex items-center gap-4">
        <a href="/inventory-control" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </a>
        <div>
          <p className="font-bold text-gray-900">Returns</p>
          <p className="text-xs text-gray-500">Log customer returns — admin handles final resolution</p>
        </div>
      </div>

      <div className="flex-1 p-6 sm:p-8">
        <div className="max-w-lg mx-auto space-y-5">
          <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
            <Plus size={16} /> Log Return
          </button>

          {showForm && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">RMA Number</label>
                  <input value={form.rma_number} onChange={e => setForm({ ...form, rma_number: e.target.value })} placeholder="RMA-001" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Order Number</label>
                  <input value={form.order_number} onChange={e => setForm({ ...form, order_number: e.target.value })} placeholder="1042" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Customer Name</label>
                <input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} placeholder="Jane Smith" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Reason</label>
                <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400">
                  <option value="">Select reason</option>
                  <option value="wrong_item">Wrong item shipped</option>
                  <option value="damaged">Arrived damaged</option>
                  <option value="not_as_described">Not as described</option>
                  <option value="changed_mind">Changed mind</option>
                  <option value="defective">Defective</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes</label>
                <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={createReturn} disabled={saving} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium">
                  {saving ? 'Logging...' : 'Log Return'}
                </button>
                <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            </div>
          )}

          {!loading && returns.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
              <RotateCcw size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">No open returns</p>
            </div>
          )}

          <div className="space-y-3">
            {returns.map(ret => (
              <div key={ret.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="font-semibold text-gray-900 text-sm">{ret.rma_number || 'No RMA#'}</p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[ret.status] || statusColors.pending}`}>{ret.status}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap mb-2">
                  {ret.customer_name && <span>{ret.customer_name}</span>}
                  <span className="flex items-center gap-1"><Clock size={10} /> {new Date(ret.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>

                {ret.return_items.map(item => (
                  <div key={item.id} className="flex items-center gap-3 py-2 border-t border-gray-50">
                    <Package size={13} className="text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">{item.products.name}</p>
                      <p className="text-xs text-gray-400">SKU: {item.products.sku} · Qty: {item.quantity_returned}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize shrink-0 ${conditionColors[item.condition] || conditionColors.good}`}>{item.condition}</span>
                  </div>
                ))}

                <div className="pt-2 border-t border-gray-50 mt-2">
                  {addingItemTo === ret.id ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="relative">
                        <input
                          ref={skuInputRef}
                          value={addItemForm.sku}
                          onChange={e => { setAddItemForm(f => ({ ...f, sku: e.target.value })); lookupSku(e.target.value) }}
                          onKeyDown={e => { if (e.key === 'Enter') handleSkuEnter(ret.id) }}
                          className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                          placeholder="SKU"
                          autoFocus
                        />
                        {skuMatch && <p className="absolute left-0 -bottom-5 text-xs text-green-600 whitespace-nowrap">{skuMatch.name}</p>}
                      </div>
                      <input type="number" min="1" value={addItemForm.quantity} onChange={e => setAddItemForm(f => ({ ...f, quantity: e.target.value }))} className="w-14 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="Qty" />
                      <select value={addItemForm.condition} onChange={e => setAddItemForm(f => ({ ...f, condition: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400">
                        <option value="new">New</option>
                        <option value="good">Good</option>
                        <option value="damaged">Damaged</option>
                        <option value="unsellable">Unsellable</option>
                      </select>
                      <button onClick={() => setShowScanner(true)} className="flex items-center justify-center bg-cyan-600 hover:bg-cyan-700 text-white p-1.5 rounded-lg" aria-label="Scan product barcode"><Scan size={14} /></button>
                      <button onClick={() => addItemToReturn(ret.id)} className="bg-cyan-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Add</button>
                      <button onClick={() => { setAddingItemTo(null); setSkuMatch(null) }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingItemTo(ret.id)} className="flex items-center gap-1.5 text-xs text-cyan-600 hover:text-cyan-700 font-medium">
                      <Plus size={12} /> Add Item
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showScanner && (
        <CameraScanner onScan={handleBarcodeScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  )
}
