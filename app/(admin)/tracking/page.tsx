'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../admin-context'
import { Search, Package, Truck, MapPin, Hash, Phone, Mail, User, Clock, CheckCircle, AlertTriangle, Box, ExternalLink, ChevronRight } from 'lucide-react'

type OrderResult = {
  id: string
  order_number: string
  status: string
  is_rush: boolean
  created_at: string
  notes: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  carrier: string | null
  tracking_number: string | null
  shipping_name: string | null
  shipping_address_1: string | null
  shipping_address_2: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_zip: string | null
  shipping_country: string | null
  total_boxes: number | null
  pick_started_at: string | null
  pick_completed_at: string | null
  assigned_picker_id: string | null
  assigned_packer_id: string | null
  assigned_shipper_id: string | null
  picker: { name: string } | null
  packer: { name: string } | null
  shipper: { name: string } | null
  order_items: {
    id: string
    quantity_ordered: number
    quantity_picked: number
    status: string
    products: { name: string; sku: string; image_url: string | null }
  }[]
  exceptions: { id: string; type: string; severity: string; description: string; status: string; created_at: string }[]
}

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

const timeline = [
  { key: 'pending', label: 'Order Received' },
  { key: 'picking', label: 'Picking' },
  { key: 'packing', label: 'Packing' },
  { key: 'shipping', label: 'Shipping' },
  { key: 'shipped', label: 'Shipped' },
]

const statusOrder = ['pending', 'assigned', 'picking', 'picked', 'packing', 'packed', 'shipping', 'shipped', 'complete']

function getTimelineStep(status: string) {
  if (['complete', 'shipped'].includes(status)) return 4
  if (['shipping'].includes(status)) return 3
  if (['packing', 'packed'].includes(status)) return 2
  if (['picking', 'picked', 'assigned'].includes(status)) return 1
  return 0
}

export default function TrackingPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OrderResult[]>([])
  const [selected, setSelected] = useState<OrderResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function search() {
    const q = query.trim()
    if (!q || !orgId) return
    setLoading(true)
    setSelected(null)
    setSearched(true)

    const { data } = await supabase
      .from('orders')
      .select(`
        id, order_number, status, is_rush, created_at, notes,
        customer_name, customer_email, customer_phone,
        carrier, tracking_number,
        shipping_name, shipping_address_1, shipping_address_2,
        shipping_city, shipping_state, shipping_zip, shipping_country,
        total_boxes, pick_started_at, pick_completed_at,
        assigned_picker_id, assigned_packer_id, assigned_shipper_id,
        picker:assigned_picker_id(name),
        packer:assigned_packer_id(name),
        shipper:assigned_shipper_id(name),
        order_items(id, quantity_ordered, quantity_picked, status, products(name, sku, image_url)),
        exceptions(id, type, severity, description, status, created_at)
      `)
      .eq('org_id', orgId)
      .or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%,tracking_number.ilike.%${q}%`)
      .order('created_at', { ascending: false })
      .limit(20)

    const base = (data as unknown as OrderResult[]) || []
    // products can come back null if an item's product_id is orphaned (deleted product, bad data, etc.)
    const sanitized = base.map(o => ({
      ...o,
      order_items: o.order_items.map(i => ({ ...i, products: i.products || { name: 'Unknown product', sku: '—', image_url: null } })),
    }))
    setResults(sanitized)
    if (sanitized.length === 1) setSelected(sanitized[0])
    setLoading(false)
  }

  const address = selected ? [
    selected.shipping_address_1,
    selected.shipping_address_2,
    selected.shipping_city && selected.shipping_state
      ? `${selected.shipping_city}, ${selected.shipping_state} ${selected.shipping_zip || ''}`.trim()
      : selected.shipping_city || selected.shipping_state,
    selected.shipping_country && selected.shipping_country !== 'US' ? selected.shipping_country : null,
  ].filter(Boolean) : []

  const timelineStep = selected ? getTimelineStep(selected.status) : -1
  const openExceptions = selected?.exceptions?.filter(e => e.status === 'open') || []

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Order Lookup</h1>
        <p className="text-sm text-gray-500 mt-0.5">Search by order number, customer name, email, or tracking number</p>
      </div>

      {/* Search bar */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-xl">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Order #, customer name, email or tracking number..."
            autoFocus
          />
        </div>
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {searched && results.length === 0 && !loading && (
        <div className="text-center py-16 text-gray-400">
          <Search size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No orders found</p>
          <p className="text-sm mt-1">Try a different order number, name, or tracking number</p>
        </div>
      )}

      {results.length > 1 && !selected && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-6">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">{results.length} orders found — select one</p>
          </div>
          <div className="divide-y divide-gray-50">
            {results.map(r => (
              <button key={r.id} onClick={() => setSelected(r)} className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 text-left transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">#{r.order_number}</p>
                    {r.is_rush && <span className="text-xs bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded">RUSH</span>}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{r.customer_name || 'No name'}{r.tracking_number ? ` · ${r.tracking_number}` : ''}</p>
                </div>
                <p className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString()}</p>
                <ChevronRight size={14} className="text-gray-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="space-y-5">
          {/* Back button if multiple results */}
          {results.length > 1 && (
            <button onClick={() => setSelected(null)} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              ← Back to results
            </button>
          )}

          {/* Status timeline */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <p className="text-lg font-bold text-gray-900">Order #{selected.order_number}</p>
                {selected.is_rush && <span className="text-xs bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">RUSH</span>}
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${statusColors[selected.status] || 'bg-gray-100 text-gray-600'}`}>{selected.status.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-400">{new Date(selected.created_at).toLocaleString()}</p>
                <a href={`/orders/${selected.id}`} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
                  Open full detail <ExternalLink size={12} />
                </a>
              </div>
            </div>

            {/* Timeline */}
            <div className="flex items-center gap-0">
              {timeline.map((step, i) => {
                const done = timelineStep > i
                const active = timelineStep === i
                const isLast = i === timeline.length - 1
                return (
                  <div key={step.key} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${done ? 'bg-green-500 text-white' : active ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                        {done ? <CheckCircle size={16} /> : i + 1}
                      </div>
                      <p className={`text-xs mt-1.5 font-medium whitespace-nowrap ${done ? 'text-green-600' : active ? 'text-blue-600' : 'text-gray-400'}`}>{step.label}</p>
                    </div>
                    {!isLast && <div className={`h-0.5 flex-1 mx-1 mb-5 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />}
                  </div>
                )
              })}
            </div>

            {selected.notes && (
              <div className="flex items-start gap-2 mt-4 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2.5">
                <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-800">{selected.notes}</p>
              </div>
            )}

            {openExceptions.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {openExceptions.map(ex => (
                  <div key={ex.id} className={`flex items-start gap-2 rounded-lg px-3 py-2.5 ${ex.severity === 'hard' ? 'bg-red-50 border border-red-100' : 'bg-orange-50 border border-orange-100'}`}>
                    <AlertTriangle size={14} className={`shrink-0 mt-0.5 ${ex.severity === 'hard' ? 'text-red-500' : 'text-orange-500'}`} />
                    <p className={`text-xs ${ex.severity === 'hard' ? 'text-red-800' : 'text-orange-800'}`}>{ex.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* Customer info */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Customer</p>
              <div className="space-y-2">
                {selected.customer_name && (
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-gray-400 shrink-0" />
                    <p className="text-sm font-medium text-gray-900">{selected.customer_name}</p>
                  </div>
                )}
                {selected.customer_email && (
                  <div className="flex items-center gap-2">
                    <Mail size={14} className="text-gray-400 shrink-0" />
                    <a href={`mailto:${selected.customer_email}`} className="text-sm text-blue-600 hover:underline">{selected.customer_email}</a>
                  </div>
                )}
                {selected.customer_phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={14} className="text-gray-400 shrink-0" />
                    <a href={`tel:${selected.customer_phone}`} className="text-sm text-blue-600 hover:underline">{selected.customer_phone}</a>
                  </div>
                )}
                {!selected.customer_name && !selected.customer_email && !selected.customer_phone && (
                  <p className="text-sm text-gray-400">No customer info on file</p>
                )}
              </div>
            </div>

            {/* Shipping address */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Ship To</p>
              {address.length > 0 ? (
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    {selected.shipping_name && <p className="text-sm font-medium text-gray-900">{selected.shipping_name}</p>}
                    {address.map((line, i) => <p key={i} className="text-sm text-gray-600">{line}</p>)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No address on file</p>
              )}
            </div>

            {/* Shipping / tracking */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Shipping</p>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Truck size={14} className="text-gray-400 shrink-0" />
                  <p className="text-sm font-medium text-gray-900">{selected.carrier || <span className="text-gray-400">No carrier</span>}</p>
                </div>
                <div className="flex items-start gap-2">
                  <Hash size={14} className="text-gray-400 shrink-0 mt-0.5" />
                  {selected.tracking_number ? (
                    <p className="text-sm font-mono font-semibold text-blue-600 break-all">{selected.tracking_number}</p>
                  ) : (
                    <p className="text-sm text-gray-400">No tracking yet</p>
                  )}
                </div>
                {selected.total_boxes && (
                  <div className="flex items-center gap-2">
                    <Box size={14} className="text-gray-400 shrink-0" />
                    <p className="text-sm text-gray-600">{selected.total_boxes} box{selected.total_boxes !== 1 ? 'es' : ''}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {/* Order items */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">Items ({selected.order_items?.length || 0})</p>
              </div>
              <div className="divide-y divide-gray-50">
                {(selected.order_items || []).map(item => {
                  const done = item.status === 'picked' || item.status === 'short'
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                        {item.products.image_url
                          ? <img src={item.products.image_url} alt="" className="w-full h-full object-cover rounded-lg" />
                          : <Package size={14} className="text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.products.name}</p>
                        <p className="text-xs text-gray-400 font-mono">{item.products.sku}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold tabular-nums ${done ? 'text-green-600' : 'text-gray-900'}`}>
                          {done ? item.quantity_ordered : `${item.quantity_picked}/${item.quantity_ordered}`}
                        </p>
                        <p className={`text-xs capitalize ${done ? 'text-green-500' : 'text-gray-400'}`}>{item.status}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Team & timeline */}
            <div className="space-y-5">
              {/* Assigned team */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <p className="text-sm font-semibold text-gray-900 mb-3">Assigned Team</p>
                <div className="space-y-2.5">
                  {[
                    { label: 'Picker', value: (selected.picker as any)?.name },
                    { label: 'Packer', value: (selected.packer as any)?.name },
                    { label: 'Shipper', value: (selected.shipper as any)?.name },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="text-sm font-medium text-gray-900">{value || <span className="text-gray-400">Unassigned</span>}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pick timing */}
              {(selected.pick_started_at || selected.pick_completed_at) && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Pick Timing</p>
                  <div className="space-y-2">
                    {selected.pick_started_at && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">Started</p>
                        <p className="text-xs text-gray-700">{new Date(selected.pick_started_at).toLocaleTimeString()}</p>
                      </div>
                    )}
                    {selected.pick_completed_at && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">Completed</p>
                        <p className="text-xs text-gray-700">{new Date(selected.pick_completed_at).toLocaleTimeString()}</p>
                      </div>
                    )}
                    {selected.pick_started_at && selected.pick_completed_at && (
                      <div className="flex items-center justify-between border-t border-gray-100 pt-2 mt-2">
                        <p className="text-xs font-medium text-gray-500">Duration</p>
                        <p className="text-xs font-bold text-gray-900">
                          {(() => {
                            const s = Math.floor((new Date(selected.pick_completed_at).getTime() - new Date(selected.pick_started_at).getTime()) / 1000)
                            return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
                          })()}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
