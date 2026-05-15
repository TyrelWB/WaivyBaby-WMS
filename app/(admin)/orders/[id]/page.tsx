'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Zap, Package, User, ShoppingBasket, Plus, Trash2, AlertTriangle, Split, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../../admin-context'

type Order = {
  id: string
  order_number: string
  customer_name: string | null
  customer_email: string | null
  status: string
  is_rush: boolean
  is_bulk: boolean
  total_boxes: number
  notes: string | null
  assigned_picker_id: string | null
  assigned_packer_id: string | null
  basket_id: string | null
  carrier: string | null
  tracking_number: string | null
  shipping_name: string | null
  shipping_address_1: string | null
  shipping_address_2: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_zip: string | null
  shipping_country: string | null
  shipping_phone: string | null
  weight_oz: number | null
  created_at: string
  picker: { id: string; name: string } | null
  packer: { id: string; name: string } | null
  basket: { barcode: string; name: string | null } | null
}

type OrderItem = {
  id: string
  product_id: string
  quantity_ordered: number
  quantity_picked: number
  quantity_packed: number
  quantity_short: number
  status: string
  products: { name: string; sku: string; image_url: string | null }
}

type Worker = { id: string; name: string; role: string }
type Product = { id: string; name: string; sku: string }

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  assigned: 'bg-blue-100 text-blue-700',
  picking: 'bg-yellow-100 text-yellow-700',
  picked: 'bg-indigo-100 text-indigo-700',
  packing: 'bg-purple-100 text-purple-700',
  packed: 'bg-pink-100 text-pink-700',
  shipping: 'bg-orange-100 text-orange-700',
  shipped: 'bg-green-100 text-green-700',
  complete: 'bg-green-100 text-green-700',
  on_hold: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
}

export default function OrderDetailPage() {
  const { id } = useParams()
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [addingItem, setAddingItem] = useState(false)
  const [newItem, setNewItem] = useState({ product_id: '', quantity_ordered: 1 })
  const [showSplit, setShowSplit] = useState(false)
  const [splitWorker, setSplitWorker] = useState('')
  const [addressForm, setAddressForm] = useState({ shipping_name: '', shipping_address_1: '', shipping_address_2: '', shipping_city: '', shipping_state: '', shipping_zip: '', shipping_country: 'US', shipping_phone: '' })
  const [ssConfigured, setSsConfigured] = useState(false)
  const [ssOrderInt, setSsOrderInt] = useState<{ external_id: string | null; tracking_number: string | null; carrier: string | null; label_url: string | null } | null>(null)
  const [ssPushing, setSsPushing] = useState(false)
  const [ssFetchingTracking, setSsFetchingTracking] = useState(false)
  const [weightOz, setWeightOz] = useState('')
  const [rates, setRates] = useState<any[] | null>(null)
  const [selectedRate, setSelectedRate] = useState<any | null>(null)
  const [fetchingRates, setFetchingRates] = useState(false)
  const [creatingLabel, setCreatingLabel] = useState(false)

  async function fetchAll() {
    if (!orgId) { setLoading(false); return }

    const [{ data: orderData }, { data: itemData }, { data: workerData }, { data: productData }, { data: ssIntData }, { data: ssOrderIntData }] = await Promise.all([
      supabase.from('orders').select('*, picker:workers!assigned_picker_id(id, name), packer:workers!assigned_packer_id(id, name), basket:baskets(barcode, name)').eq('id', id).single(),
      supabase.from('order_items').select('*, products(name, sku, image_url, inventory(bin:bins(location_code)))').eq('order_id', id).order('created_at'),
      supabase.from('workers').select('id, name, role').eq('org_id', orgId).eq('is_active', true).order('name'),
      supabase.from('products').select('id, name, sku').eq('org_id', orgId).order('name'),
      supabase.from('integrations').select('id').eq('org_id', orgId).eq('provider', 'shipstation').maybeSingle(),
      supabase.from('order_integrations').select('external_id, tracking_number, carrier, label_url').eq('order_id', id as string).eq('provider', 'shipstation').maybeSingle(),
    ])

    const o = orderData as unknown as Order
    setOrder(o)
    setItems(itemData as unknown as OrderItem[] || [])
    setWorkers(workerData || [])
    setProducts(productData || [])
    if (o) setAddressForm({
      shipping_name: o.shipping_name || '',
      shipping_address_1: o.shipping_address_1 || '',
      shipping_address_2: o.shipping_address_2 || '',
      shipping_city: o.shipping_city || '',
      shipping_state: o.shipping_state || '',
      shipping_zip: o.shipping_zip || '',
      shipping_country: o.shipping_country || 'US',
      shipping_phone: o.shipping_phone || '',
    })
    setSsConfigured(!!ssIntData)
    setSsOrderInt(ssOrderIntData ?? null)
    if (o?.weight_oz) setWeightOz(String(o.weight_oz))
    setLoading(false)
  }

  async function updateOrder(updates: Record<string, unknown>) {
    await supabase.from('orders').update(updates).eq('id', id)
    fetchAll()
  }

  async function addItem() {
    if (!newItem.product_id) { toast.error('Select a product'); return }
    const { error } = await supabase.from('order_items').insert({
      order_id: id,
      product_id: newItem.product_id,
      quantity_ordered: newItem.quantity_ordered,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Item added')
    setNewItem({ product_id: '', quantity_ordered: 1 })
    setAddingItem(false)
    fetchAll()
  }

  async function removeItem(itemId: string) {
    toast('Remove this item?', {
      action: {
        label: 'Remove', onClick: async () => {
          await supabase.from('order_items').delete().eq('id', itemId)
          toast.success('Item removed')
          fetchAll()
        }
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    })
  }

  async function handleShortPick(itemId: string, item: OrderItem) {
    const short = item.quantity_ordered - item.quantity_picked
    if (short <= 0) return
    await supabase.from('order_items').update({ quantity_short: short, status: 'short' }).eq('id', itemId)
    await supabase.from('exceptions').insert({
      org_id: orgId,
      order_id: id,
      worker_id: order?.assigned_picker_id ?? null,
      exception_type: 'short_pick',
      severity: 'soft',
      description: `Short pick on ${item.products.name}: found ${item.quantity_picked}/${item.quantity_ordered}`,
      status: 'open',
    })
    toast.success('Short pick reported')
    fetchAll()
  }

  async function handleSplitAssign() {
    if (!splitWorker) { toast.error('Select a worker'); return }
    await supabase.from('orders').update({ assigned_picker_id: splitWorker, status: 'assigned' }).eq('id', id)
    toast.success('Order reassigned')
    setShowSplit(false)
    fetchAll()
  }

  async function removeFromPicker() {
    await supabase.from('orders').update({ assigned_picker_id: null, status: 'pending' }).eq('id', id)
    toast.success('Picker removed — order back to pending')
    fetchAll()
  }

  async function saveAddress() {
    await supabase.from('orders').update(addressForm).eq('id', id)
    toast.success('Address saved')
    fetchAll()
  }

  async function getRates() {
    const oz = parseInt(weightOz)
    if (!oz) { toast.error('Enter package weight first'); return }
    await supabase.from('orders').update({ weight_oz: oz }).eq('id', id)
    setFetchingRates(true)
    setRates(null)
    setSelectedRate(null)
    const res = await fetch('/api/integrations/shipstation/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: id }),
    })
    const data = await res.json()
    setFetchingRates(false)
    if (!res.ok) { toast.error(data.error || 'Failed to get rates'); return }
    setRates(data.rates || [])
  }

  async function createLabel() {
    if (!selectedRate) { toast.error('Select a rate first'); return }
    setCreatingLabel(true)
    const res = await fetch('/api/integrations/shipstation/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: id, carrierCode: selectedRate.carrierCode, serviceCode: selectedRate.serviceCode }),
    })
    const data = await res.json()
    setCreatingLabel(false)
    if (!res.ok) { toast.error(data.error || 'Label creation failed'); return }
    toast.success(`Label created · ${data.tracking}`)
    setRates(null)
    setSelectedRate(null)
    fetchAll()
  }

  async function pushToShipStation() {
    setSsPushing(true)
    const res = await fetch('/api/integrations/shipstation/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: id }),
    })
    const data = await res.json()
    setSsPushing(false)
    if (!res.ok) { toast.error(data.error || 'Push failed'); return }
    toast.success(data.already_pushed ? 'Already in ShipStation' : 'Pushed to ShipStation')
    fetchAll()
  }

  async function fetchTracking() {
    setSsFetchingTracking(true)
    const res = await fetch('/api/integrations/shipstation/tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: id }),
    })
    const data = await res.json()
    setSsFetchingTracking(false)
    if (!res.ok) { toast.error(data.error || 'Failed to fetch tracking'); return }
    if (data.tracking) {
      toast.success(`Tracking: ${data.tracking}`)
    } else {
      toast.info(data.message || 'No tracking yet')
    }
    fetchAll()
  }

  useEffect(() => { fetchAll() }, [orgId])

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>
  if (!order) return <div className="p-8 text-gray-500">Order not found.</div>

  const pickedCount = items.reduce((s, i) => s + i.quantity_picked, 0)
  const totalCount = items.reduce((s, i) => s + i.quantity_ordered, 0)
  const pickers = workers.filter(w => w.role === 'picker' || w.role === 'all')
  const packers = workers.filter(w => w.role === 'packer' || w.role === 'all')

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <a href="/orders" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={15} /> Orders
        </a>
      </div>

      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">Order #{order.order_number}</h1>
            {order.is_rush && <span className="flex items-center gap-1 text-xs bg-red-100 text-red-600 font-bold px-2.5 py-1 rounded-full"><Zap size={11} /> RUSH</span>}
            {order.is_bulk && <span className="flex items-center gap-1 text-xs bg-purple-100 text-purple-600 font-bold px-2.5 py-1 rounded-full"><Package size={11} /> BULK</span>}
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${statusColors[order.status] || 'bg-gray-100 text-gray-600'}`}>
              {order.status.replace('_', ' ')}
            </span>
          </div>
          {order.customer_name && <p className="text-sm text-gray-500 mt-1">{order.customer_name}{order.customer_email ? ` · ${order.customer_email}` : ''}</p>}
          <p className="text-xs text-gray-400 mt-0.5">{new Date(order.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <select
          value={order.status}
          onChange={e => updateOrder({ status: e.target.value })}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
        >
          {['pending','assigned','picking','picked','packing','packed','shipping','shipped','complete','on_hold','cancelled'].map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {order.notes && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 flex items-start gap-2">
          <AlertTriangle size={14} className="text-yellow-600 shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-800">{order.notes}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Left: items */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-gray-900">Items</h2>
                <span className="text-xs text-gray-400">{pickedCount}/{totalCount} picked</span>
              </div>
              <button onClick={() => setAddingItem(!addingItem)} className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                <Plus size={12} /> Add Item
              </button>
            </div>

            {addingItem && (
              <div className="px-5 py-3 border-b border-gray-100 bg-blue-50 flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
                  <select value={newItem.product_id} onChange={e => setNewItem({ ...newItem, product_id: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select product...</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                </div>
                <div className="w-20">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Qty</label>
                  <input type="number" min={1} value={newItem.quantity_ordered} onChange={e => setNewItem({ ...newItem, quantity_ordered: parseInt(e.target.value) || 1 })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button onClick={addItem} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">Add</button>
                <button onClick={() => setAddingItem(false)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            )}

            <div className="divide-y divide-gray-50">
              {items.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No items on this order yet.</div>
              ) : items.map(item => (
                <div key={item.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{item.products.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-gray-400">SKU: {item.products.sku}</p>
                      {(() => {
                        const bin = (item.products as any).inventory?.[0]?.bin?.location_code
                        return bin ? (
                          <span className="text-xs bg-blue-50 text-blue-700 font-mono px-1.5 py-0.5 rounded font-medium">📍 {bin}</span>
                        ) : null
                      })()}
                    </div>
                  </div>
                  <div className="text-center shrink-0">
                    <p className="text-sm font-semibold text-gray-900">{item.quantity_picked}/{item.quantity_ordered}</p>
                    <p className="text-xs text-gray-400">picked</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize shrink-0 ${
                    item.status === 'picked' ? 'bg-green-100 text-green-700' :
                    item.status === 'short' ? 'bg-red-100 text-red-600' :
                    item.status === 'damaged' ? 'bg-orange-100 text-orange-600' :
                    'bg-gray-100 text-gray-600'
                  }`}>{item.status}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'pending' && item.quantity_picked < item.quantity_ordered && (
                      <button onClick={() => handleShortPick(item.id, item)} className="text-xs text-orange-500 hover:text-orange-700 font-medium">Short pick</button>
                    )}
                    <button onClick={() => removeItem(item.id)} className="p-1 text-gray-300 hover:text-red-500 rounded"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>

            {totalCount > 0 && (
              <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(pickedCount / totalCount) * 100}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{Math.round((pickedCount / totalCount) * 100)}% picked</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: sidebar */}
        <div className="lg:col-span-2 space-y-4">

          {/* Assignment */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm"><User size={14} className="text-gray-400" /> Assignment</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Picker</label>
                <div className="flex gap-1.5">
                  <select value={order.assigned_picker_id || ''} onChange={e => updateOrder({ assigned_picker_id: e.target.value || null, status: e.target.value ? 'assigned' : 'pending' })} className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0">
                    <option value="">—</option>
                    {pickers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  {order.assigned_picker_id && <button onClick={removeFromPicker} className="p-1.5 text-gray-400 hover:text-red-500 border border-gray-200 rounded-lg shrink-0"><X size={12} /></button>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Packer</label>
                <select value={order.assigned_packer_id || ''} onChange={e => updateOrder({ assigned_packer_id: e.target.value || null })} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">—</option>
                  {packers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            </div>
            <button onClick={() => setShowSplit(!showSplit)} className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 transition-colors mt-3">
              <Split size={12} /> Reassign Picker
            </button>
            {showSplit && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2 mt-2">
                <select value={splitWorker} onChange={e => setSplitWorker(e.target.value)} className="w-full border border-blue-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select worker...</option>
                  {pickers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <button onClick={handleSplitAssign} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-lg text-xs font-medium transition-colors">Reassign</button>
                  <button onClick={() => setShowSplit(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Basket + Boxes */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-1.5 text-sm"><ShoppingBasket size={14} className="text-gray-400" /> Basket</h3>
                {order.basket ? (
                  <div className="bg-blue-50 rounded-lg p-2.5">
                    <p className="text-xs font-medium text-blue-900">{order.basket.name || 'Basket'}</p>
                    <p className="text-xs text-blue-600 font-mono mt-0.5">{order.basket.barcode}</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">None assigned</p>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-1.5 text-sm"><Package size={14} className="text-gray-400" /> Boxes</h3>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} value={order.total_boxes} onChange={e => updateOrder({ total_boxes: parseInt(e.target.value) || 1 })} className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-xs text-gray-500">{order.total_boxes === 1 ? 'box' : 'boxes'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Shipping address + carrier + label */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-sm">Shipping</h3>
              {['packed', 'shipping', 'shipped', 'complete'].includes(order.status) && (
                <a href={`/print/manifest/${id}`} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">Print Slip</a>
              )}
            </div>

            {/* Address */}
            <div className="space-y-2 mb-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={addressForm.shipping_name} onChange={e => setAddressForm(f => ({ ...f, shipping_name: e.target.value }))} placeholder="Recipient name" className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input value={addressForm.shipping_phone} onChange={e => setAddressForm(f => ({ ...f, shipping_phone: e.target.value }))} placeholder="Phone" className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <input value={addressForm.shipping_address_1} onChange={e => setAddressForm(f => ({ ...f, shipping_address_1: e.target.value }))} placeholder="Address line 1" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={addressForm.shipping_address_2} onChange={e => setAddressForm(f => ({ ...f, shipping_address_2: e.target.value }))} placeholder="Line 2 (optional)" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="grid grid-cols-3 gap-2">
                <input value={addressForm.shipping_city} onChange={e => setAddressForm(f => ({ ...f, shipping_city: e.target.value }))} placeholder="City" className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input value={addressForm.shipping_state} onChange={e => setAddressForm(f => ({ ...f, shipping_state: e.target.value }))} placeholder="State" className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input value={addressForm.shipping_zip} onChange={e => setAddressForm(f => ({ ...f, shipping_zip: e.target.value }))} placeholder="ZIP" className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={saveAddress} className="w-full bg-gray-900 hover:bg-gray-700 text-white py-1.5 rounded-lg text-xs font-medium transition-colors">Save Address</button>
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Carrier</label>
                  <select value={order.carrier || ''} onChange={e => updateOrder({ carrier: e.target.value || null })} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">—</option>
                    <option value="UPS">UPS</option>
                    <option value="FedEx">FedEx</option>
                    <option value="USPS">USPS</option>
                    <option value="DHL">DHL</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Tracking #</label>
                  <input type="text" value={order.tracking_number || ''} onChange={e => updateOrder({ tracking_number: e.target.value || null })} placeholder="—" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Shipping Label (ShipStation) */}
          {ssConfigured && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm">
                <ExternalLink size={14} className="text-gray-400" /> Shipping Label
              </h3>

              {ssOrderInt?.label_url ? (
                <div className="space-y-2">
                  <div className="bg-green-50 border border-green-100 rounded-lg p-2.5 flex items-center justify-between">
                    <p className="text-xs font-medium text-green-700">Label Created</p>
                    {ssOrderInt.carrier && <p className="text-xs text-gray-500 uppercase">{ssOrderInt.carrier}</p>}
                  </div>
                  {ssOrderInt.tracking_number && (
                    <p className="text-xs font-mono text-gray-600 bg-gray-50 rounded-lg px-3 py-2 break-all">{ssOrderInt.tracking_number}</p>
                  )}
                  <a href={ssOrderInt.label_url} target="_blank" rel="noopener" className="w-full flex items-center justify-center gap-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg py-2 hover:bg-blue-50 transition-colors">
                    <ExternalLink size={13} /> Download Label
                  </a>
                </div>
              ) : !order.shipping_zip ? (
                <p className="text-xs text-gray-400 text-center py-2">Save a shipping address first</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="number" min={1} value={weightOz} onChange={e => setWeightOz(e.target.value)} placeholder="Weight (oz)" className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={getRates} disabled={fetchingRates || !weightOz} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
                      {fetchingRates ? <RefreshCw size={13} className="animate-spin" /> : 'Get Rates'}
                    </button>
                  </div>

                  {rates && rates.length === 0 && <p className="text-xs text-gray-400 text-center py-1">No rates available</p>}

                  {rates && rates.length > 0 && (
                    <div className="space-y-1">
                      {rates.map((rate: any, i: number) => (
                        <button key={i} onClick={() => setSelectedRate(rate)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors ${
                            selectedRate?.serviceCode === rate.serviceCode && selectedRate?.carrierCode === rate.carrierCode
                              ? 'border-blue-500 bg-blue-50 text-blue-900'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700'
                          }`}>
                          <span className="font-medium text-left text-xs">{rate.serviceName}</span>
                          <div className="text-right shrink-0 ml-2">
                            <p className="font-semibold text-xs">${(rate.shipmentCost + rate.otherCost).toFixed(2)}</p>
                            {rate.transitDays && <p className="text-xs text-gray-400">{rate.transitDays}d</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedRate && (
                    <button onClick={createLabel} disabled={creatingLabel} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold transition-colors">
                      {creatingLabel ? 'Creating...' : `Create Label · $${(selectedRate.shipmentCost + selectedRate.otherCost).toFixed(2)}`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function X({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
