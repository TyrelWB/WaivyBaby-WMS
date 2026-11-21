'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, MapPin, Plus, Search, Package, CheckCircle, Loader2, X, Scan, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import CameraScanner from '@/components/CameraScanner'
import { parseBarcode, lookupProductIdByBarcode } from '@/lib/barcode'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type BinItem = { name: string; sku: string; qty_on_hand: number }
type Bin = { id: string; location_code: string; is_active: boolean; item_count: number; items: BinItem[] }
type Product = { id: string; name: string; sku: string; bin_location: string | null }

const emptyBinForm = { rack: '', row: '', bin: '' }

export default function InventoryLocationsPage() {
  const supabase = createClient()
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [bins, setBins] = useState<Bin[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'bins' | 'assign'>('bins')
  const [showBinForm, setShowBinForm] = useState(false)
  const [binForm, setBinForm] = useState(emptyBinForm)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedBins, setExpandedBins] = useState<Record<string, boolean>>({})

  // Assign-product state
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [newBinId, setNewBinId] = useState('')
  const [scanMode, setScanMode] = useState<'product' | 'bin' | null>(null)
  const productSearchRef = useRef<HTMLInputElement>(null)

  // Keep the product search box focused so a scan gun can be used
  // back-to-back without clicking in between scans.
  useEffect(() => {
    if (tab === 'assign' && !selectedProduct) productSearchRef.current?.focus()
  }, [tab, selectedProduct])

  useEffect(() => {
    fetch('/api/worker-session').then(r => r.ok ? r.json() : null).then(session => {
      if (session) { setWorker(session); fetchBins(session) } else setLoading(false)
    })
  }, [])

  async function fetchBins(session: WorkerSession) {
    const { data } = await supabase
      .from('bins')
      .select('id, location_code, is_active, inventory(qty_on_hand, products(name, sku))')
      .eq('org_id', session.orgId)
      .order('location_code')
    setBins((data || []).map((b: any) => ({
      id: b.id, location_code: b.location_code, is_active: b.is_active,
      item_count: (b.inventory || []).length,
      items: (b.inventory || []).map((inv: any) => ({
        name: inv.products?.name || 'Unknown product',
        sku: inv.products?.sku || '—',
        qty_on_hand: inv.qty_on_hand,
      })),
    })))
    setLoading(false)
  }

  async function createBin() {
    if (!worker) return
    const rack = binForm.rack.trim(), row = binForm.row.trim(), bin = binForm.bin.trim()
    if (!rack || !row || !bin) { toast.error('Rack, row, and bin are all required'); return }
    setSaving(true)
    const location_code = `${rack}-${row}-${bin}`.toUpperCase()
    const { error } = await supabase.from('bins').insert({
      org_id: worker.orgId, warehouse_id: worker.warehouseId, location_code, is_active: true,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(`Bin ${location_code} created`)
    setBinForm(emptyBinForm)
    setShowBinForm(false)
    setSaving(false)
    fetchBins(worker)
  }

  async function searchProducts(q: string) {
    setProductSearch(q)
    if (!worker || !q.trim()) { setProductResults([]); return }
    const { data } = await supabase
      .from('products')
      .select('id, name, sku, inventory(bins(location_code))')
      .eq('org_id', worker.orgId)
      .or(`name.ilike.%${q.trim()}%,sku.ilike.%${q.trim()}%`)
      .limit(10)
    setProductResults((data || []).map((p: any) => ({
      id: p.id, name: p.name, sku: p.sku,
      bin_location: p.inventory?.[0]?.bins?.location_code || null,
    })))
  }

  function selectProduct(p: Product) {
    setSelectedProduct(p)
    setProductResults([])
    setProductSearch('')
    setNewBinId('')
  }

  async function selectProductByExactMatch(raw: string): Promise<boolean> {
    const productId = await lookupProductIdByBarcode(supabase, raw.trim())
    if (!productId) return false
    const { data: p } = await supabase
      .from('products')
      .select('id, name, sku, inventory(bins(location_code))')
      .eq('id', productId)
      .single() as { data: any }
    if (!p) return false
    selectProduct({
      id: p.id, name: p.name, sku: p.sku,
      bin_location: p.inventory?.[0]?.bins?.location_code || null,
    })
    return true
  }

  // A scan gun just types into the focused field and sends Enter — try an
  // exact SKU/barcode match first, and only fall back to the fuzzy results
  // (which may still be resolving) if that comes up empty.
  async function handleProductSearchEnter() {
    const raw = productSearch.trim()
    if (!raw) return
    const found = await selectProductByExactMatch(raw)
    if (!found && productResults.length === 1) selectProduct(productResults[0])
  }

  async function handleScan(raw: string) {
    const mode = scanMode
    setScanMode(null)
    if (!worker) return
    if (mode === 'bin') {
      const parsed = parseBarcode(raw.trim())
      const code = parsed.type === 'bin' ? parsed.value : parsed.raw
      const match = bins.find(b => b.location_code.toLowerCase() === code.toLowerCase())
      if (!match) { toast.error(`No bin found for "${raw.trim()}"`); return }
      setNewBinId(match.id)
      toast.success(`Bin ${match.location_code} selected`)
      return
    }
    const found = await selectProductByExactMatch(raw)
    if (!found) toast.error(`Unknown barcode: ${raw.trim()}`)
  }

  async function saveProductBin() {
    if (!selectedProduct || !newBinId || !worker) return
    const { error } = await supabase
      .from('inventory')
      .update({ bin_id: newBinId })
      .eq('product_id', selectedProduct.id)
      .eq('org_id', worker.orgId)
    if (error) { toast.error(error.message); return }
    toast.success(`${selectedProduct.name} moved`)
    setSelectedProduct(null)
    fetchBins(worker)
  }

  const filteredBins = bins.filter(b => b.location_code.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 sm:px-8 py-4 flex items-center gap-4">
        <a href="/inventory-control" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </a>
        <div>
          <p className="font-bold text-gray-900">Locations</p>
          <p className="text-xs text-gray-500">{bins.length} bins</p>
        </div>
      </div>

      <div className="flex-1 p-6 sm:p-8">
        <div className="max-w-lg mx-auto">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-5">
            <button onClick={() => setTab('bins')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'bins' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Bins</button>
            <button onClick={() => setTab('assign')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'assign' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Assign Product</button>
          </div>

          {tab === 'bins' && (
            <>
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bins..." className="w-full pl-8 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
                </div>
                <button onClick={() => setShowBinForm(v => !v)} className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0">
                  <Plus size={16} /> Bin
                </button>
              </div>

              {showBinForm && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Rack</label>
                      <input value={binForm.rack} onChange={e => setBinForm({ ...binForm, rack: e.target.value })} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="1" autoFocus />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Row</label>
                      <input value={binForm.row} onChange={e => setBinForm({ ...binForm, row: e.target.value })} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="2" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Bin</label>
                      <input value={binForm.bin} onChange={e => setBinForm({ ...binForm, bin: e.target.value })} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="B" />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-4">
                    Code: <span className="font-mono font-semibold text-gray-600">
                      {(binForm.rack.trim() || binForm.row.trim() || binForm.bin.trim())
                        ? `${binForm.rack.trim() || '?'}-${binForm.row.trim() || '?'}-${binForm.bin.trim() || '?'}`.toUpperCase()
                        : 'e.g. 1-2-B'}
                    </span>
                  </p>
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => { setShowBinForm(false); setBinForm(emptyBinForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                    <button onClick={createBin} disabled={saving} className="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium">
                      {saving ? 'Creating...' : 'Create Bin'}
                    </button>
                  </div>
                </div>
              )}

              {loading ? (
                <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
              ) : filteredBins.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
                  <MapPin size={28} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No bin locations yet</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-50">
                  {filteredBins.map(bin => {
                    const isExpanded = !!expandedBins[bin.id]
                    return (
                      <div key={bin.id} className={!bin.is_active ? 'opacity-50' : ''}>
                        <button
                          onClick={() => bin.item_count > 0 && setExpandedBins(prev => ({ ...prev, [bin.id]: !prev[bin.id] }))}
                          className="w-full flex items-center gap-3 px-5 py-3.5 text-left"
                        >
                          <div className="w-8 h-8 bg-cyan-50 rounded-lg flex items-center justify-center shrink-0">
                            <MapPin size={14} className="text-cyan-500" />
                          </div>
                          <p className="font-semibold text-gray-900 font-mono flex-1">{bin.location_code}</p>
                          <span className="text-xs text-gray-400">{bin.item_count > 0 ? `${bin.item_count} SKUs` : 'Empty'}</span>
                          {bin.item_count > 0 && (isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />)}
                        </button>
                        {isExpanded && bin.item_count > 0 && (
                          <div className="px-5 pb-3.5 pl-16 space-y-1.5">
                            {bin.items.map((item, i) => (
                              <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-sm text-gray-800 truncate">{item.name}</p>
                                  <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
                                </div>
                                <span className="text-sm font-semibold text-gray-700 shrink-0">{item.qty_on_hand}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'assign' && (
            <>
              {!selectedProduct ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="relative flex-1">
                      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        ref={productSearchRef}
                        value={productSearch}
                        onChange={e => searchProducts(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleProductSearchEnter() }}
                        placeholder="Search product by name or SKU..."
                        className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      />
                    </div>
                    <button
                      onClick={() => setScanMode('product')}
                      className="flex items-center justify-center bg-cyan-600 hover:bg-cyan-700 text-white p-3 rounded-xl transition-colors shrink-0"
                      aria-label="Scan product barcode"
                    >
                      <Scan size={18} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {productResults.map(p => (
                      <button key={p.id} onClick={() => selectProduct(p)} className="w-full flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 text-left hover:border-cyan-300 transition-colors">
                        <Package size={16} className="text-gray-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                        </div>
                        <span className="text-xs text-gray-400 font-mono shrink-0">{p.bin_location || 'No bin'}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="font-bold text-gray-900">{selectedProduct.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{selectedProduct.sku}</p>
                    </div>
                    <button onClick={() => setSelectedProduct(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">
                    Current bin: <span className="font-mono font-semibold text-gray-900">{selectedProduct.bin_location || 'None'}</span>
                  </p>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">New Bin</label>
                  <div className="flex items-center gap-2 mb-5">
                    <select value={newBinId} onChange={e => setNewBinId(e.target.value)} className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400">
                      <option value="">Select a bin...</option>
                      {bins.filter(b => b.is_active).map(b => <option key={b.id} value={b.id}>{b.location_code}</option>)}
                    </select>
                    <button
                      onClick={() => setScanMode('bin')}
                      className="flex items-center justify-center bg-cyan-600 hover:bg-cyan-700 text-white p-2.5 rounded-xl transition-colors shrink-0"
                      aria-label="Scan bin barcode"
                    >
                      <Scan size={18} />
                    </button>
                  </div>
                  <button
                    onClick={saveProductBin}
                    disabled={!newBinId}
                    className="w-full flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-colors"
                  >
                    <CheckCircle size={18} /> Move to This Bin
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {scanMode && (
        <CameraScanner onScan={handleScan} onClose={() => setScanMode(null)} />
      )}
    </div>
  )
}
