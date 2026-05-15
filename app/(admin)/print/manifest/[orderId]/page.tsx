'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Printer } from 'lucide-react'

type Order = {
  id: string
  order_number: string
  customer_name: string | null
  customer_email: string | null
  carrier: string | null
  tracking_number: string | null
  created_at: string
  total_boxes: number
}

type BoxItem = {
  quantity: number
  order_items: { products: { name: string; sku: string } } | null
}

type Box = {
  id: string
  box_number: number
  box_items: BoxItem[]
}

export default function PrintManifestPage() {
  const supabase = createClient()
  const params = useParams()
  const orderId = params.orderId as string
  const [order, setOrder] = useState<Order | null>(null)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: orderData }, { data: boxData }] = await Promise.all([
        supabase.from('orders').select('id, order_number, customer_name, customer_email, carrier, tracking_number, created_at, total_boxes').eq('id', orderId).single(),
        supabase.from('boxes').select('id, box_number, box_items(quantity, order_items(products(name, sku)))').eq('order_id', orderId).order('box_number'),
      ])
      if (orderData) setOrder(orderData as Order)
      setBoxes(boxData as unknown as Box[] || [])
      setLoading(false)
    }
    load()
  }, [orderId])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>
  if (!order) return <div className="min-h-screen flex items-center justify-center text-gray-500">Order not found</div>

  const packedDate = new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="min-h-screen bg-white">
      <div className="print:hidden flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <a href={`/orders/${orderId}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to Order</a>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Printer size={16} /> Print
        </button>
      </div>

      <div className="max-w-2xl mx-auto p-8 print:p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-8 pb-6 border-b-2 border-gray-900">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Waivy WMS</p>
            <h1 className="text-3xl font-black text-gray-900">Packing Slip</h1>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">#{order.order_number}</p>
            <p className="text-sm text-gray-500 mt-1">{packedDate}</p>
          </div>
        </div>

        {/* Customer + shipping */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Ship To</p>
            <p className="font-semibold text-gray-900">{order.customer_name || '—'}</p>
            {order.customer_email && <p className="text-sm text-gray-500">{order.customer_email}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Shipping</p>
            <p className="font-semibold text-gray-900">{order.carrier || 'No carrier set'}</p>
            {order.tracking_number && <p className="text-sm text-gray-500 font-mono">{order.tracking_number}</p>}
            <p className="text-sm text-gray-500 mt-1">{boxes.length} box{boxes.length !== 1 ? 'es' : ''}</p>
          </div>
        </div>

        {/* Boxes */}
        {boxes.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No box data recorded.</p>
        ) : boxes.map(box => (
          <div key={box.id} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-gray-900 rounded flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-white">{box.box_number}</span>
              </div>
              <p className="font-semibold text-gray-900 text-sm">Box {box.box_number}</p>
            </div>
            <table className="w-full text-sm border border-gray-100 rounded-lg overflow-hidden">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(box.box_items || []).map((bi, i) => (
                  <tr key={i}>
                    <td className="py-2 px-3 text-gray-900">{bi.order_items?.products?.name || '—'}</td>
                    <td className="py-2 px-3 text-gray-500 font-mono text-xs">{bi.order_items?.products?.sku || '—'}</td>
                    <td className="py-2 px-3 text-gray-900 text-right font-semibold">{bi.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">Packed by Waivy WMS · {new Date().toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  )
}
