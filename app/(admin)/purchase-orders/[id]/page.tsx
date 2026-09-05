'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../../admin-context'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Plus, Trash2, Save, ChevronRight, Package,
  Ship, Truck, CheckCircle, Clock, AlertCircle, X, Search
} from 'lucide-react'
import { toast } from 'sonner'

type POItem = {
  id: string
  product_id: string | null
  product_name: string
  sku: string | null
  quantity_ordered: number
  unit_cost_usd: number | null
  quantity_received: number
}

type PurchaseOrder = {
  id: string
  po_number: string
  supplier_id: string | null
  supplier_name: string | null
  status: string
  shipping_method: string | null
  freight_forwarder: string | null
  container_number: string | null
  port_of_loading: string | null
  etd: string | null
  eta_port: string | null
  eta_warehouse: string | null
  customs_broker: string | null
  notes: string | null
  total_value_usd: number | null
  order_date: string
  created_at: string
  purchase_order_items: POItem[]
}

type ProductResult = { id: string; name: string; sku: string }

const STATUS_PIPELINE = [
  { key: 'draft',         label: 'Draft',         color: 'bg-gray-100 text-gray-600',     icon: Clock },
  { key: 'sent',          label: 'Sent',           color: 'bg-blue-100 text-blue-700',     icon: ChevronRight },
  { key: 'confirmed',     label: 'Confirmed',      color: 'bg-indigo-100 text-indigo-700', icon: CheckCircle },
  { key: 'in_production', label: 'In Production',  color: 'bg-yellow-100 text-yellow-700', icon: Package },
  { key: 'shipped',       label: 'Shipped',        color: 'bg-orange-100 text-orange-700', icon: Ship },
  { key: 'in_transit',    label: 'In Transit',     color: 'bg-orange-100 text-orange-700', icon: Truck },
  { key: 'at_customs',    label: 'At Customs',     color: 'bg-red-100 text-red-600',       icon: AlertCircle },
  { key: 'incoming',      label: 'Incoming',       color: 'bg-purple-100 text-purple-700', icon: Truck },
  { key: 'received',      label: 'Received',       color: 'bg-green-100 text-green-700',   icon: CheckCircle },
  { key: 'closed',        label: 'Closed',         color: 'bg-green-100 text-green-600',   icon: CheckCircle },
  { key: 'cancelled',     label: 'Cancelled',      color: 'bg-gray-100 text-gray-400',     icon: X },
]

const ACTIVE_PIPELINE = ['draft', 'sent', 'confirmed', 'in_production', 'shipped', 'in_transit', 'at_customs', 'incoming', 'received', 'closed']

function getNextStatus(current: string): string | null {
  const idx = ACTIVE_PIPELINE.indexOf(current)
  if (idx < 0 || idx >= ACTIVE_PIPELINE.length - 1) return null
  return ACTIVE_PIPELINE[idx + 1]
}

function statusConfig(key: string) {
  return STATUS_PIPELINE.find(s => s.key === key) || STATUS_PIPELINE[0]
}

export default function PurchaseOrderDetailPage() {
  const supabase = createClient()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const { orgId, warehouseId } = useAdminContext()

  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creatingReceiving, setCreatingReceiving] = useState(false)

  // Shipping details form state
  const [shippingForm, setShippingForm] = useState({
    freight_forwarder: '',
    container_number: '',
    port_of_loading: '',
    etd: '',
    eta_port: '',
    eta_warehouse: '',
    customs_broker: '',
    notes: '',
  })
  const [shippingDirty, setShippingDirty] = useState(false)

  // Add item state
  const [showAddItem, setShowAddItem] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<ProductResult[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null)
  const [itemQty, setItemQty] = useState('1')
  const [itemCost, setItemCost] = useState('')
  const [addingSaving, setAddingSaving] = useState(false)

  const fetchPO = useCallback(async () => {
    if (!orgId) return
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`
        id, po_number, supplier_id, supplier_name, status, shipping_method,
        freight_forwarder, container_number, port_of_loading, etd,
        eta_port, eta_warehouse, customs_broker, notes, total_value_usd,
        order_date, created_at,
        purchase_order_items(id, product_id, product_name, sku, quantity_ordered, unit_cost_usd, quantity_received)
      `)
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !data) { toast.error('PO not found'); router.push('/purchase-orders'); return }

    setPo(data as unknown as PurchaseOrder)
    setShippingForm({
      freight_forwarder: data.freight_forwarder || '',
      container_number: data.container_number || '',
      port_of_loading: data.port_of_loading || '',
      etd: data.etd || '',
      eta_port: data.eta_port || '',
      eta_warehouse: data.eta_warehouse || '',
      customs_broker: data.customs_broker || '',
      notes: data.notes || '',
    })
    setLoading(false)
  }, [orgId, id])

  useEffect(() => { if (orgId) fetchPO() }, [orgId, fetchPO])

  async function searchProducts(q: string) {
    if (!q.trim() || !orgId) { setProductResults([]); return }
    const { data } = await supabase
      .from('products')
      .select('id, name, sku')
      .eq('org_id', orgId)
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(8)
    setProductResults(data || [])
  }

  useEffect(() => {
    const t = setTimeout(() => searchProducts(productSearch), 200)
    return () => clearTimeout(t)
  }, [productSearch])

  async function addItem() {
    if (!selectedProduct && !productSearch.trim()) { toast.error('Select a product'); return }
    if (!po) return
    setAddingSaving(true)

    const name = selectedProduct?.name || productSearch.trim()
    const sku = selectedProduct?.sku || null
    const productId = selectedProduct?.id || null

    const { error } = await supabase.from('purchase_order_items').insert({
      purchase_order_id: po.id,
      org_id: orgId,
      product_id: productId,
      product_name: name,
      sku,
      quantity_ordered: parseInt(itemQty) || 1,
      unit_cost_usd: itemCost ? parseFloat(itemCost) : null,
      quantity_received: 0,
    })

    if (error) { toast.error(error.message); setAddingSaving(false); return }

    await recalcTotal()
    setShowAddItem(false)
    setProductSearch('')
    setSelectedProduct(null)
    setItemQty('1')
    setItemCost('')
    setAddingSaving(false)
    fetchPO()
  }

  async function removeItem(itemId: string) {
    await supabase.from('purchase_order_items').delete().eq('id', itemId)
    await recalcTotal()
    fetchPO()
  }

  async function recalcTotal() {
    if (!po) return
    const { data } = await supabase
      .from('purchase_order_items')
      .select('quantity_ordered, unit_cost_usd')
      .eq('purchase_order_id', po.id)

    const total = (data || []).reduce((sum, item) => {
      if (item.unit_cost_usd) return sum + item.quantity_ordered * item.unit_cost_usd
      return sum
    }, 0)

    await supabase.from('purchase_orders').update({ total_value_usd: total || null }).eq('id', po.id)
  }

  async function saveShipping() {
    if (!po) return
    setSaving(true)
    const { error } = await supabase.from('purchase_orders').update({
      freight_forwarder: shippingForm.freight_forwarder || null,
      container_number: shippingForm.container_number || null,
      port_of_loading: shippingForm.port_of_loading || null,
      etd: shippingForm.etd || null,
      eta_port: shippingForm.eta_port || null,
      eta_warehouse: shippingForm.eta_warehouse || null,
      customs_broker: shippingForm.customs_broker || null,
      notes: shippingForm.notes || null,
    }).eq('id', po.id)

    if (error) { toast.error(error.message) } else { toast.success('Saved'); setShippingDirty(false); fetchPO() }
    setSaving(false)
  }

  async function advanceStatus() {
    if (!po) return
    const next = getNextStatus(po.status)
    if (!next) return
    setSaving(true)
    const { error } = await supabase.from('purchase_orders').update({ status: next }).eq('id', po.id)
    if (error) { toast.error(error.message) } else { toast.success(`Status updated to ${statusConfig(next).label}`); fetchPO() }
    setSaving(false)
  }

  async function setStatus(newStatus: string) {
    if (!po) return
    setSaving(true)
    const { error } = await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', po.id)
    if (error) { toast.error(error.message) } else { toast.success(`Status set to ${statusConfig(newStatus).label}`); fetchPO() }
    setSaving(false)
  }

  async function createReceivingRecord() {
    if (!po || !orgId || !warehouseId) return
    setCreatingReceiving(true)

    // Create receiving record
    const { data: rec, error: recErr } = await supabase.from('receiving').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      reference_number: po.po_number,
      supplier_name: po.supplier_name,
      expected_date: po.eta_warehouse || null,
      status: 'pending',
      notes: `From PO ${po.po_number}`,
    }).select('id').single()

    if (recErr || !rec) { toast.error(recErr?.message || 'Failed to create receiving record'); setCreatingReceiving(false); return }

    // Create receiving items from PO line items (only items with a linked product)
    const items = po.purchase_order_items
      .filter(item => item.product_id)
      .map(item => ({
        receiving_id: rec.id,
        product_id: item.product_id,
        quantity_expected: item.quantity_ordered,
        quantity_received: 0,
        status: 'pending',
      }))

    if (items.length > 0) {
      const { error: itemsErr } = await supabase.from('receiving_items').insert(items)
      if (itemsErr) { toast.error(itemsErr.message); setCreatingReceiving(false); return }
    }

    // Update PO status to received
    await supabase.from('purchase_orders').update({ status: 'received' }).eq('id', po.id)
    toast.success('Receiving record created — check Receiving page')
    setCreatingReceiving(false)
    fetchPO()
  }

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading...</div>
  if (!po) return null

  const cfg = statusConfig(po.status)
  const nextStatus = getNextStatus(po.status)
  const nextCfg = nextStatus ? statusConfig(nextStatus) : null
  const currentIdx = ACTIVE_PIPELINE.indexOf(po.status)
  const canCreateReceiving = ['at_customs', 'incoming', 'received'].includes(po.status)

  const totalValue = po.purchase_order_items.reduce((sum, item) => {
    if (item.unit_cost_usd) return sum + item.quantity_ordered * item.unit_cost_usd
    return sum
  }, 0)

  function shippingField(label: string, key: keyof typeof shippingForm, type: string = 'text', placeholder?: string) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
        <input
          type={type}
          value={shippingForm[key]}
          onChange={e => { setShippingForm(f => ({ ...f, [key]: e.target.value })); setShippingDirty(true) }}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={placeholder || ''}
        />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/purchase-orders')} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{po.po_number}</h1>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.color}`}>{cfg.label}</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {po.supplier_name || '—'} · Created {new Date(po.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canCreateReceiving && (
            <button
              onClick={createReceivingRecord}
              disabled={creatingReceiving}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Truck size={15} />
              {creatingReceiving ? 'Creating...' : 'Create Receiving Record'}
            </button>
          )}
          {nextCfg && po.status !== 'cancelled' && (
            <button
              onClick={advanceStatus}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Mark as {nextCfg.label} →
            </button>
          )}
        </div>
      </div>

      {/* Status timeline */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {STATUS_PIPELINE.filter(s => s.key !== 'cancelled').map((s, i, arr) => {
            const isDone = ACTIVE_PIPELINE.indexOf(po.status) > ACTIVE_PIPELINE.indexOf(s.key)
            const isCurrent = po.status === s.key
            return (
              <div key={s.key} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setStatus(s.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer
                    ${isCurrent ? cfg.color + ' ring-2 ring-offset-1 ring-blue-400' : isDone ? 'bg-gray-100 text-gray-500' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                >
                  <s.icon size={11} />
                  {s.label}
                </button>
                {i < arr.length - 1 && <div className={`w-4 h-px ${isDone ? 'bg-gray-400' : 'bg-gray-200'}`} />}
              </div>
            )
          })}
          {po.status !== 'cancelled' && (
            <button
              onClick={() => setStatus('cancelled')}
              className="ml-3 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* Left: Line items */}
        <div className="col-span-3 space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">Line Items</p>
                <p className="text-xs text-gray-400 mt-0.5">{po.purchase_order_items.length} product{po.purchase_order_items.length !== 1 ? 's' : ''}</p>
              </div>
              <button
                onClick={() => setShowAddItem(true)}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                <Plus size={15} /> Add Item
              </button>
            </div>

            {/* Add item panel */}
            {showAddItem && (
              <div className="px-5 py-4 border-b border-gray-100 bg-blue-50">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        autoFocus
                        value={productSearch}
                        onChange={e => { setProductSearch(e.target.value); setSelectedProduct(null) }}
                        placeholder="Search product or type name..."
                        className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    {productResults.length > 0 && !selectedProduct && (
                      <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                        {productResults.map(p => (
                          <button
                            key={p.id}
                            onClick={() => { setSelectedProduct(p); setProductSearch(p.name); setProductResults([]) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                          >
                            <span className="text-gray-900">{p.name}</span>
                            <span className="text-gray-400 font-mono text-xs ml-auto">{p.sku}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <input
                      type="number"
                      min={1}
                      value={itemQty}
                      onChange={e => setItemQty(e.target.value)}
                      placeholder="Qty"
                      className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                  <div>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={itemCost}
                      onChange={e => setItemCost(e.target.value)}
                      placeholder="Unit cost $"
                      className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                  <button
                    onClick={addItem}
                    disabled={addingSaving}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    {addingSaving ? '...' : 'Add'}
                  </button>
                  <button onClick={() => { setShowAddItem(false); setProductSearch(''); setSelectedProduct(null) }} className="text-gray-400 hover:text-gray-600">
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {po.purchase_order_items.length === 0 ? (
              <div className="px-5 py-10 text-center text-gray-400 text-sm">
                No items yet. Add products to this PO.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Product</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Ordered</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Unit Cost</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Line Total</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Received</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {po.purchase_order_items.map(item => {
                    const lineTotal = item.unit_cost_usd ? item.quantity_ordered * item.unit_cost_usd : null
                    const allReceived = item.quantity_received >= item.quantity_ordered
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-900">{item.product_name}</p>
                          {item.sku && <p className="text-xs text-gray-400 font-mono">{item.sku}</p>}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-700">{item.quantity_ordered.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right text-gray-600">
                          {item.unit_cost_usd ? `$${item.unit_cost_usd.toFixed(2)}` : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-gray-700">
                          {lineTotal ? `$${lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`text-xs font-medium ${allReceived ? 'text-green-600' : item.quantity_received > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                            {item.quantity_received}/{item.quantity_ordered}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => removeItem(item.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {totalValue > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-100 bg-gray-50">
                      <td colSpan={3} className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900">
                        ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>

        {/* Right: Details */}
        <div className="col-span-2 space-y-4">
          {/* Shipping details */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="font-semibold text-gray-900">Shipping Details</p>
              {shippingDirty && (
                <button
                  onClick={saveShipping}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium"
                >
                  <Save size={13} /> {saving ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Shipping Method</label>
                  <div className="flex gap-2">
                    {[{ value: 'sea', label: '🚢 Sea' }, { value: 'air', label: '✈️ Air' }].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { /* shipping_method is set at creation */ }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${po.shipping_method === opt.value ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-400'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {shippingField('Port of Loading', 'port_of_loading', 'text', 'e.g. Yantian, Guangzhou')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {shippingField('ETD (Departs China)', 'etd', 'date')}
                {shippingField('ETA Port', 'eta_port', 'date')}
              </div>
              {shippingField('ETA Warehouse', 'eta_warehouse', 'date')}
              {shippingField('Container Number', 'container_number', 'text', 'e.g. MSCU1234567')}
              {shippingField('Freight Forwarder', 'freight_forwarder', 'text', 'e.g. Flexport')}
              {shippingField('Customs Broker', 'customs_broker', 'text', 'e.g. CHB Solutions')}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <textarea
                  value={shippingForm.notes}
                  onChange={e => { setShippingForm(f => ({ ...f, notes: e.target.value })); setShippingDirty(true) }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  placeholder="Internal notes..."
                />
              </div>
              {shippingDirty && (
                <button
                  onClick={saveShipping}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
                >
                  <Save size={13} /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>

          {/* Summary card */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 space-y-2">
            <p className="font-semibold text-gray-900 mb-3">Summary</p>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Order Date</span>
              <span className="text-gray-700">{new Date(po.order_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Items</span>
              <span className="text-gray-700">{po.purchase_order_items.length} products</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Units</span>
              <span className="text-gray-700">{po.purchase_order_items.reduce((s, i) => s + i.quantity_ordered, 0).toLocaleString()}</span>
            </div>
            {totalValue > 0 && (
              <div className="flex justify-between text-sm pt-1 border-t border-gray-100 mt-2">
                <span className="font-semibold text-gray-700">Total Value</span>
                <span className="font-bold text-gray-900">${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
