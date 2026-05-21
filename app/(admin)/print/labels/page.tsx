'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../../admin-context'
import { Printer, Search, Plus, Minus, CheckSquare, Square, Package } from 'lucide-react'
import JsBarcode from 'jsbarcode'

type Product = {
  id: string
  name: string
  sku: string
  image_url: string | null
  is_sub_product: boolean
}

type LabelItem = {
  product: Product
  copies: number
}

function Barcode({ value, className }: { value: string; className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !value) return
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width: 2,
        height: 50,
        displayValue: false,
        margin: 0,
      })
    } catch {}
  }, [value])

  return <svg ref={svgRef} className={className} />
}

export default function PrintLabelsPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [labelItems, setLabelItems] = useState<LabelItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'sub'>('sub')

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('products')
      .select('id, name, sku, image_url, is_sub_product')
      .eq('org_id', orgId)
      .order('sku')
      .then(({ data }) => {
        setProducts(data || [])
        setLoading(false)
      })
  }, [orgId])

  const filtered = products.filter(p => {
    const matchesFilter = filter === 'all' || p.is_sub_product
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
    return matchesFilter && matchesSearch
  })

  function isSelected(id: string) {
    return labelItems.some(l => l.product.id === id)
  }

  function toggleProduct(product: Product) {
    if (isSelected(product.id)) {
      setLabelItems(prev => prev.filter(l => l.product.id !== product.id))
    } else {
      setLabelItems(prev => [...prev, { product, copies: 1 }])
    }
  }

  function setCopies(id: string, copies: number) {
    setLabelItems(prev => prev.map(l => l.product.id === id ? { ...l, copies: Math.max(1, Math.min(99, copies)) } : l))
  }

  function selectAll() {
    const newItems = filtered
      .filter(p => !isSelected(p.id))
      .map(p => ({ product: p, copies: 1 }))
    setLabelItems(prev => [...prev, ...newItems])
  }

  function clearAll() {
    setLabelItems([])
  }

  const totalLabels = labelItems.reduce((s, l) => s + l.copies, 0)

  // Build the flat list of labels to print (repeated by copies)
  const printLabels: Product[] = labelItems.flatMap(l =>
    Array.from({ length: l.copies }, () => l.product)
  )

  return (
    <div className="p-6 max-w-7xl">
      {/* Print stylesheet injected inline */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          @page {
            size: 2.25in 1.25in;
            margin: 0;
          }
        }
      `}</style>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Print Barcode Labels</h1>
          <p className="text-sm text-gray-500 mt-0.5">Select products, set copies, then print</p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={labelItems.length === 0}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Printer size={16} />
          Print {totalLabels > 0 ? `${totalLabels} Label${totalLabels !== 1 ? 's' : ''}` : 'Labels'}
        </button>
      </div>

      <div className="flex gap-6">
        {/* Left: product selector */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Search by name or SKU..."
                />
              </div>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button onClick={() => setFilter('sub')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === 'sub' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                  Sub-Products
                </button>
                <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === 'all' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                  All Products
                </button>
              </div>
              <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap">Select all</button>
              {labelItems.length > 0 && (
                <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-700 font-medium">Clear</button>
              )}
            </div>

            {loading ? (
              <div className="p-8 text-center text-gray-400 text-sm">Loading products...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No products found</div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-[560px] overflow-y-auto">
                {filtered.map(product => {
                  const selected = isSelected(product.id)
                  const item = labelItems.find(l => l.product.id === product.id)
                  return (
                    <div key={product.id} className={`flex items-center gap-3 px-5 py-3 transition-colors ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <button onClick={() => toggleProduct(product)} className="shrink-0">
                        {selected
                          ? <CheckSquare size={18} className="text-blue-600" />
                          : <Square size={18} className="text-gray-300" />}
                      </button>
                      <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center shrink-0 overflow-hidden">
                        {product.image_url
                          ? <img src={product.image_url} alt="" className="w-full h-full object-cover" />
                          : <Package size={14} className="text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0" onClick={() => toggleProduct(product)} role="button">
                        <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                        <p className="text-xs text-gray-400 font-mono">{product.sku}</p>
                      </div>
                      {selected && item && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => setCopies(product.id, item.copies - 1)} className="w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-gray-700">
                            <Minus size={12} />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={item.copies}
                            onChange={e => setCopies(product.id, parseInt(e.target.value) || 1)}
                            className="w-10 text-center border border-gray-200 rounded text-sm font-bold py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button onClick={() => setCopies(product.id, item.copies + 1)} className="w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-gray-700">
                            <Plus size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: preview */}
        <div className="w-80 shrink-0">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">Preview</p>
              <p className="text-xs text-gray-400 mt-0.5">2.25" × 1.25" label size</p>
            </div>
            {labelItems.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Select products on the left to preview labels
              </div>
            ) : (
              <div className="p-4 space-y-3 max-h-[480px] overflow-y-auto">
                {labelItems.map(({ product, copies }) => (
                  <div key={product.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                    <div className="flex flex-col items-center gap-1">
                      <Barcode value={product.sku} className="w-full" />
                      <p className="text-xs font-bold font-mono tracking-wider text-gray-900">{product.sku}</p>
                      <p className="text-xs text-gray-600 text-center leading-tight line-clamp-2">{product.name}</p>
                    </div>
                    <p className="text-xs text-gray-400 text-center mt-1.5">{copies} cop{copies !== 1 ? 'ies' : 'y'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden print area */}
      <div id="print-area" className="hidden print:block">
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {printLabels.map((product, i) => (
            <div key={i} style={{
              width: '2.25in',
              height: '1.25in',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 8px',
              boxSizing: 'border-box',
              pageBreakAfter: 'always',
              breakAfter: 'page',
            }}>
              <BarcodeStatic value={product.sku} />
              <p style={{ fontSize: '9pt', fontWeight: 'bold', fontFamily: 'monospace', margin: '2px 0 1px', letterSpacing: '0.05em' }}>{product.sku}</p>
              <p style={{ fontSize: '7pt', fontFamily: 'sans-serif', margin: 0, textAlign: 'center', lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden' }}>{product.name}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Static barcode for print area (canvas-based, rendered once on mount)
function BarcodeStatic({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width: 1.5,
        height: 40,
        displayValue: false,
        margin: 0,
      })
    } catch {}
  }, [value])

  return <svg ref={svgRef} style={{ width: '100%', maxHeight: '40px' }} />
}
