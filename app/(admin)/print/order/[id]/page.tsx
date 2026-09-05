'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Printer } from 'lucide-react'
import JsBarcode from 'jsbarcode'

type OrderItem = {
  id: string
  product_id: string
  quantity_ordered: number
  products: { name: string; sku: string } | null
  bin_location: string | null
}

type Order = {
  id: string
  order_number: string
  customer_name: string | null
  customer_email: string | null
  is_rush: boolean
  is_bulk: boolean
  notes: string | null
  created_at: string
  shipping_name: string | null
  shipping_address_1: string | null
  shipping_address_2: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_zip: string | null
  shipping_country: string | null
  shipping_phone: string | null
}

function Barcode({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!svgRef.current || !value) return
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width: 2.5,
        height: 80,
        displayValue: true,
        fontSize: 14,
        margin: 8,
      })
    } catch {}
  }, [value])
  return <svg ref={svgRef} />
}

export default function PrintOrderPage() {
  const supabase = createClient()
  const params = useParams()
  const orderId = params.id as string
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: orderData }, { data: itemData }] = await Promise.all([
        supabase.from('orders').select('id, order_number, customer_name, customer_email, is_rush, is_bulk, notes, created_at, org_id, shipping_name, shipping_address_1, shipping_address_2, shipping_city, shipping_state, shipping_zip, shipping_country, shipping_phone').eq('id', orderId).single(),
        supabase.from('order_items').select('id, product_id, quantity_ordered, products(name, sku)').eq('order_id', orderId),
      ])

      if (!orderData) { setLoading(false); return }
      setOrder(orderData as Order)

      const base = (itemData || []) as any[]
      const pids = base.map((i: any) => i.product_id).filter(Boolean)

      let binMap: Record<string, string | null> = {}
      if (pids.length > 0 && (orderData as any).org_id) {
        const { data: invData } = await supabase
          .from('inventory')
          .select('product_id, bins(location_code)')
          .in('product_id', pids)
          .eq('org_id', (orderData as any).org_id)
        for (const inv of invData || []) {
          binMap[(inv as any).product_id] = (inv as any).bins?.location_code || null
        }
      }

      setItems(base.map((i: any) => ({ ...i, bin_location: binMap[i.product_id] || null })))
      setLoading(false)
    }
    load()
  }, [orderId])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading...</div>
  if (!order) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Order not found</div>

  const printedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const barcodeValue = `ORD-${order.order_number}`

  return (
    <div className="min-h-screen bg-white">
      {/* Screen-only controls */}
      <div className="print:hidden flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
        <a href={`/orders/${orderId}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to Order</a>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Printer size={16} /> Print Order Sheet
        </button>
      </div>

      {/* Printable content */}
      <div className="max-w-2xl mx-auto p-8 print:p-6">

        {/* Barcode — large, at top */}
        <div className="flex flex-col items-center mb-8 pb-6 border-b-2 border-gray-900">
          <Barcode value={barcodeValue} />
          <p className="text-xs text-gray-400 mt-1 font-mono">{barcodeValue}</p>
        </div>

        {/* Order header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-black text-gray-900">Order #{order.order_number}</h1>
              {order.is_rush && (
                <span className="bg-red-600 text-white text-sm font-bold px-3 py-1 rounded">RUSH</span>
              )}
              {order.is_bulk && (
                <span className="bg-purple-600 text-white text-sm font-bold px-3 py-1 rounded">BULK</span>
              )}
            </div>
            {order.customer_name && (
              <p className="text-lg text-gray-600">{order.customer_name}</p>
            )}
          </div>
          <div className="text-right text-sm text-gray-400">
            <p>Printed</p>
            <p className="font-medium text-gray-700">{printedAt}</p>
          </div>
        </div>

        {/* Ship to */}
        {(order.shipping_name || order.shipping_address_1 || order.customer_name) && (
          <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Ship To</p>
            <p className="font-bold text-gray-900 text-base">{order.shipping_name || order.customer_name}</p>
            {order.shipping_address_1 && <p className="text-sm text-gray-700">{order.shipping_address_1}</p>}
            {order.shipping_address_2 && <p className="text-sm text-gray-700">{order.shipping_address_2}</p>}
            {(order.shipping_city || order.shipping_state || order.shipping_zip) && (
              <p className="text-sm text-gray-700">
                {[order.shipping_city, order.shipping_state, order.shipping_zip].filter(Boolean).join(', ')}
                {order.shipping_country && order.shipping_country !== 'US' ? ` ${order.shipping_country}` : ''}
              </p>
            )}
            {order.customer_email && <p className="text-sm text-gray-500 mt-1">{order.customer_email}</p>}
            {order.shipping_phone && <p className="text-sm text-gray-500">{order.shipping_phone}</p>}
          </div>
        )}

        {/* Notes */}
        {order.notes && (
          <div className="mb-6 border-l-4 border-yellow-400 bg-yellow-50 px-4 py-3 rounded-r-lg">
            <p className="text-sm font-semibold text-yellow-800 mb-0.5">Note</p>
            <p className="text-sm text-yellow-700">{order.notes}</p>
          </div>
        )}

        {/* Items */}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-gray-900">
              <th className="text-left py-2 pr-4 font-semibold text-gray-900">Item</th>
              <th className="text-left py-2 pr-4 font-semibold text-gray-500 w-32">SKU</th>
              <th className="text-left py-2 pr-4 font-semibold text-gray-500 w-24">Bin</th>
              <th className="text-right py-2 font-semibold text-gray-900 w-16">Qty</th>
              <th className="text-right py-2 font-semibold text-gray-400 w-16 print:hidden">✓</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className={`border-b border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50'}`}>
                <td className="py-3 pr-4 font-medium text-gray-900">
                  {item.products?.name || <span className="text-gray-400">Unknown</span>}
                </td>
                <td className="py-3 pr-4 font-mono text-xs text-gray-500">{item.products?.sku || '—'}</td>
                <td className="py-3 pr-4 font-mono text-xs text-blue-700 font-semibold">
                  {item.bin_location || <span className="text-gray-300">—</span>}
                </td>
                <td className="py-3 text-right font-bold text-gray-900 text-lg">{item.quantity_ordered}</td>
                <td className="py-3 text-right print:hidden">
                  <div className="w-5 h-5 border-2 border-gray-300 rounded ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-gray-200 flex items-center justify-between text-xs text-gray-400">
          <span>Waivy WMS</span>
          <span>{items.reduce((sum, i) => sum + i.quantity_ordered, 0)} total units · {items.length} line items</span>
        </div>
      </div>
    </div>
  )
}
