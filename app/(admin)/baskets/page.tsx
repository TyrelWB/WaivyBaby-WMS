'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, ShoppingBasket, X, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { generateBasketBarcode } from '@/lib/barcode'
import { useAdminContext } from '../admin-context'

type Basket = {
  id: string
  barcode: string
  name: string | null
  status: string
  current_order_id: string | null
  claimed_at: string | null
  created_at: string
  orders: { order_number: string } | null
  workers: { name: string } | null
}

const statusColors: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  in_use: 'bg-blue-100 text-blue-700',
  damaged: 'bg-red-100 text-red-700',
}

export default function BasketsPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [baskets, setBaskets] = useState<Basket[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [form, setForm] = useState({ name: '', customBarcode: '' })
  const [bulkForm, setBulkForm] = useState({ count: 5, namePrefix: 'Basket' })
  const [saving, setSaving] = useState(false)

  async function fetchBaskets() {
    if (!orgId) { setLoading(false); return }

    const { data } = await supabase
      .from('baskets')
      .select('id, barcode, name, status, current_order_id, claimed_at, created_at, orders(order_number), workers:current_worker_id(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    setBaskets(data as unknown as Basket[] || [])
    setLoading(false)
  }

  async function createBasket() {
    if (!orgId) return
    setSaving(true)

    const barcode = form.customBarcode.trim() || generateBasketBarcode(crypto.randomUUID())

    const { error } = await supabase.from('baskets').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      barcode,
      name: form.name.trim() || `Basket ${barcode}`,
      status: 'available',
    })

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Basket created')
    setForm({ name: '', customBarcode: '' })
    setShowForm(false)
    setSaving(false)
    fetchBaskets()
  }

  async function createBulkBaskets() {
    if (!orgId) return
    const count = Math.min(Math.max(bulkForm.count, 1), 50)
    setSaving(true)

    const rows = Array.from({ length: count }, (_, i) => ({
      org_id: orgId,
      warehouse_id: warehouseId,
      barcode: generateBasketBarcode(crypto.randomUUID()),
      name: `${bulkForm.namePrefix.trim() || 'Basket'} ${baskets.length + i + 1}`,
      status: 'available',
    }))

    const { error } = await supabase.from('baskets').insert(rows)
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(`${count} baskets created`)
    setShowForm(false)
    setBulkMode(false)
    setSaving(false)
    fetchBaskets()
  }

  async function releaseBasket(id: string) {
    await supabase.from('baskets').update({
      status: 'available',
      current_order_id: null,
      current_worker_id: null,
      claimed_at: null,
    }).eq('id', id)
    toast.success('Basket released')
    fetchBaskets()
  }

  async function markDamaged(id: string) {
    await supabase.from('baskets').update({ status: 'damaged' }).eq('id', id)
    toast.success('Basket marked as damaged')
    fetchBaskets()
  }

  async function deleteBasket(id: string) {
    const basket = baskets.find(b => b.id === id)
    if (basket?.status === 'in_use') { toast.error('Cannot delete a basket that is in use'); return }
    toast('Delete this basket?', {
      action: {
        label: 'Delete', onClick: async () => {
          await supabase.from('baskets').delete().eq('id', id)
          toast.success('Basket deleted')
          fetchBaskets()
        }
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    })
  }

  useEffect(() => { fetchBaskets() }, [orgId])

  const available = baskets.filter(b => b.status === 'available')
  const inUse = baskets.filter(b => b.status === 'in_use')
  const damaged = baskets.filter(b => b.status === 'damaged')

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Baskets</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {available.length} available · {inUse.length} in use · {damaged.length} damaged
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchBaskets} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} /> Add Basket
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-gray-900">New Basket</h2>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button onClick={() => setBulkMode(false)} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${!bulkMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Single</button>
                <button onClick={() => setBulkMode(true)} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${bulkMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Bulk</button>
              </div>
            </div>
            <button onClick={() => { setShowForm(false); setBulkMode(false) }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          {!bulkMode ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Display Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Basket A" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Custom Barcode <span className="font-normal text-gray-400">(optional)</span></label>
                <input value={form.customBarcode} onChange={e => setForm({ ...form, customBarcode: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" placeholder="BSK-AUTO" />
                <p className="text-xs text-gray-400 mt-1">Leave blank to auto-generate. Must start with BSK-</p>
              </div>
              <div className="col-span-2 flex gap-3 justify-end pt-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                <button onClick={createBasket} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  {saving ? 'Creating...' : 'Create Basket'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Quantity <span className="font-normal text-gray-400">(max 50)</span></label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={bulkForm.count}
                  onChange={e => setBulkForm({ ...bulkForm, count: Math.min(50, Math.max(1, parseInt(e.target.value) || 1)) })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Name Prefix</label>
                <input
                  value={bulkForm.namePrefix}
                  onChange={e => setBulkForm({ ...bulkForm, namePrefix: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Basket"
                />
                <p className="text-xs text-gray-400 mt-1">Baskets will be named: {bulkForm.namePrefix || 'Basket'} 1, {bulkForm.namePrefix || 'Basket'} 2…</p>
              </div>
              <div className="col-span-2 flex gap-3 justify-end pt-2">
                <button onClick={() => { setShowForm(false); setBulkMode(false) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                <button onClick={createBulkBaskets} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  {saving ? 'Creating...' : `Create ${bulkForm.count} Baskets`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400 p-6">Loading...</div>
      ) : baskets.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <ShoppingBasket size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-900">No baskets yet</p>
          <p className="text-sm text-gray-400 mt-1">Create baskets and print their barcodes for pickers to scan.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50">
            {baskets.map(basket => (
              <div key={basket.id} className="flex items-center gap-4 px-6 py-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${basket.status === 'available' ? 'bg-green-100' : basket.status === 'in_use' ? 'bg-blue-100' : 'bg-red-100'}`}>
                  <ShoppingBasket size={16} className={basket.status === 'available' ? 'text-green-600' : basket.status === 'in_use' ? 'text-blue-600' : 'text-red-500'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{basket.name || basket.barcode}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[basket.status] || 'bg-gray-100 text-gray-500'}`}>
                      {basket.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                    <span className="font-mono">{basket.barcode}</span>
                    {basket.status === 'in_use' && basket.orders && (
                      <span className="text-blue-500">Order #{basket.orders.order_number}</span>
                    )}
                    {basket.status === 'in_use' && basket.workers && (
                      <span>{basket.workers.name}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/print/basket/${basket.id}`}
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-gray-500 hover:text-blue-600 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    Print Label
                  </a>
                  {basket.status === 'in_use' && (
                    <button onClick={() => releaseBasket(basket.id)} className="text-xs text-orange-600 border border-orange-200 hover:bg-orange-50 rounded-lg px-2.5 py-1.5 transition-colors">
                      Release
                    </button>
                  )}
                  {basket.status === 'available' && (
                    <button onClick={() => markDamaged(basket.id)} className="text-xs text-gray-400 hover:text-red-500 border border-gray-100 rounded-lg px-2.5 py-1.5 transition-colors">
                      Damage
                    </button>
                  )}
                  {basket.status !== 'in_use' && (
                    <button onClick={() => deleteBasket(basket.id)} className="text-xs text-gray-300 hover:text-red-500 border border-gray-100 rounded-lg px-2.5 py-1.5 transition-colors">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
