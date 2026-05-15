'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Printer } from 'lucide-react'
import QRCode from 'qrcode'

type Basket = { id: string; barcode: string; name: string | null }

export default function PrintBasketLabelPage() {
  const supabase = createClient()
  const params = useParams()
  const basketId = params.id as string
  const [basket, setBasket] = useState<Basket | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('baskets').select('id, barcode, name').eq('id', basketId).single()
      if (data) {
        setBasket(data)
        const url = await QRCode.toDataURL(data.barcode, { width: 200, margin: 1 })
        setQrDataUrl(url)
      }
      setLoading(false)
    }
    load()
  }, [basketId])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>
  if (!basket) return <div className="min-h-screen flex items-center justify-center text-gray-500">Basket not found</div>

  return (
    <div className="min-h-screen bg-white">
      {/* Print controls — hidden when printing */}
      <div className="print:hidden flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <a href="/baskets" className="text-sm text-gray-500 hover:text-gray-700">← Back to Baskets</a>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Printer size={16} /> Print Label
        </button>
      </div>

      {/* Label — sized for a 4x2 inch label */}
      <div className="flex items-center justify-center p-8 print:p-0">
        <div className="w-96 border-2 border-gray-800 rounded-xl p-6 flex flex-col items-center gap-4 print:border-black print:rounded-none print:w-auto">
          <div className="text-center">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Waivy WMS</p>
            <p className="text-2xl font-black text-gray-900 mt-1">{basket.name || basket.barcode}</p>
          </div>
          {qrDataUrl && (
            <img src={qrDataUrl} alt={basket.barcode} className="w-40 h-40" />
          )}
          <div className="text-center">
            <p className="font-mono text-lg font-bold text-gray-900 tracking-widest">{basket.barcode}</p>
            <p className="text-xs text-gray-400 mt-1">Scan to assign to order</p>
          </div>
        </div>
      </div>
    </div>
  )
}
