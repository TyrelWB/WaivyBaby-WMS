'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Search, Package, Plus, Minus, Loader2, CheckCircle, Scan } from 'lucide-react'
import { toast } from 'sonner'
import CameraScanner from '@/components/CameraScanner'
import { lookupProductIdByBarcode } from '@/lib/barcode'

type Product = {
  id: string
  name: string
  sku: string
  qty_on_hand: number
  qty_available: number
}

const REASONS = ['Found stock', 'Miscount correction', 'Expired', 'Other']

export default function AdjustStockPage() {
  const supabase = createClient()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Product | null>(null)
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState(REASONS[0])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const rescanRef = useRef<HTMLInputElement>(null)
  const [rescan, setRescan] = useState('')
  const selectedRef = useRef<Product | null>(null)
  selectedRef.current = selected

  // Keep whichever scan target is on screen focused, so a scan gun (which
  // just "types" into whatever's focused) can be used back-to-back
  // without clicking in between scans.
  useEffect(() => {
    if (selected) rescanRef.current?.focus()
    else searchRef.current?.focus()
  }, [selected])

  async function fetchProduct(productId: string): Promise<Product | null> {
    const { data: p } = await supabase
      .from('products')
      .select('id, name, sku, inventory(qty_on_hand, qty_available)')
      .eq('id', productId)
      .single()
    if (!p) return null
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      qty_on_hand: p.inventory?.[0]?.qty_on_hand ?? 0,
      qty_available: p.inventory?.[0]?.qty_available ?? 0,
    }
  }

  // Scanning the same item again just bumps the quantity by one instead of
  // re-running the whole search — scan a unit for each one you're
  // adding/removing, then submit once at the end. Scanning a different
  // item switches straight to it.
  async function handleScanValue(raw: string): Promise<boolean> {
    const productId = await lookupProductIdByBarcode(supabase, raw.trim())
    if (!productId) return false
    if (selectedRef.current?.id === productId) {
      setQty(q => String((parseInt(q) || 0) + 1))
      return true
    }
    const p = await fetchProduct(productId)
    if (!p) return false
    selectProduct(p)
    return true
  }

  async function handleBarcodeScan(raw: string) {
    setShowScanner(false)
    const found = await handleScanValue(raw)
    if (!found) toast.error(`Unknown barcode: ${raw.trim()}`)
  }

  // A scan gun just types into this field and sends Enter — try an exact
  // SKU/barcode match first (won't race with the in-flight fuzzy search),
  // and only fall back to the fuzzy results if that comes up empty.
  async function handleSearchEnter() {
    const raw = search.trim()
    if (!raw) return
    const found = await handleScanValue(raw)
    if (!found && results.length === 1) selectProduct(results[0])
  }

  async function handleRescanEnter() {
    const raw = rescan.trim()
    if (!raw) return
    setRescan('')
    const found = await handleScanValue(raw)
    if (!found) toast.error(`Unknown barcode: ${raw}`)
  }

  async function runSearch(q: string) {
    setSearch(q)
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    const { data } = await supabase
      .from('products')
      .select('id, name, sku, inventory(qty_on_hand, qty_available)')
      .or(`name.ilike.%${q.trim()}%,sku.ilike.%${q.trim()}%`)
      .limit(10)
    const mapped = (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      qty_on_hand: p.inventory?.[0]?.qty_on_hand ?? 0,
      qty_available: p.inventory?.[0]?.qty_available ?? 0,
    }))
    setResults(mapped)
    setSearching(false)
  }

  function selectProduct(p: Product) {
    setSelected(p)
    setResults([])
    setSearch('')
    setRescan('')
    setQty('1')
    setReason(REASONS[0])
    setNotes('')
  }

  async function submit() {
    if (!selected) return
    const n = parseInt(qty)
    if (isNaN(n) || n < 1) { toast.error('Enter a valid quantity'); return }

    setSubmitting(true)
    const qty_change = direction === 'add' ? n : -n
    const res = await fetch(`/api/products/${selected.id}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qty_change,
        movement_type: 'adjust',
        note: `${reason}${notes.trim() ? ` — ${notes.trim()}` : ''}`,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || 'Adjustment failed')
    } else {
      toast.success(`${selected.name}: ${direction === 'add' ? '+' : '-'}${n} (now ${data.qty_on_hand} on hand)`)
      setSelected(null)
    }
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 sm:px-8 py-4 flex items-center gap-4">
        <a href="/inventory-control" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-gray-500" />
        </a>
        <div>
          <p className="font-bold text-gray-900">Adjust Stock</p>
          <p className="text-xs text-gray-500">Add or remove inventory manually</p>
        </div>
      </div>

      <div className="flex-1 p-6 sm:p-8">
        <div className="max-w-lg mx-auto">
          {!selected ? (
            <>
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => runSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSearchEnter() }}
                    placeholder="Search by product name or SKU..."
                    className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                </div>
                <button
                  onClick={() => setShowScanner(true)}
                  className="flex items-center justify-center bg-cyan-600 hover:bg-cyan-700 text-white p-3 rounded-xl transition-colors shrink-0"
                  aria-label="Scan barcode"
                >
                  <Scan size={18} />
                </button>
              </div>

              {searching && <p className="text-sm text-gray-400 text-center py-6">Searching...</p>}

              {!searching && search.trim() && results.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">No products match "{search}"</p>
              )}

              <div className="space-y-2">
                {results.map(p => (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className="w-full flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 text-left hover:border-cyan-300 hover:shadow-sm transition-all"
                  >
                    <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                      <Package size={16} className="text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                    </div>
                    <p className="text-sm font-bold text-gray-700 tabular-nums shrink-0">{p.qty_on_hand} on hand</p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="font-bold text-gray-900">{selected.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{selected.sku}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-sm text-gray-400 hover:text-gray-600">Change</button>
              </div>

              <p className="text-sm text-gray-500 mb-4">Currently <span className="font-bold text-gray-900">{selected.qty_on_hand}</span> on hand, <span className="font-bold text-gray-900">{selected.qty_available}</span> available</p>

              <div className="relative mb-5">
                <Scan size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={rescanRef}
                  value={rescan}
                  onChange={e => setRescan(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRescanEnter() }}
                  placeholder="Scan the same item again to bump quantity..."
                  className="w-full bg-cyan-50 border border-cyan-100 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />
              </div>

              <div className="flex gap-2 mb-5">
                <button
                  onClick={() => setDirection('add')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border transition-colors ${direction === 'add' ? 'bg-green-600 border-green-600 text-white' : 'border-gray-200 text-gray-600'}`}
                >
                  <Plus size={16} /> Add
                </button>
                <button
                  onClick={() => setDirection('remove')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm border transition-colors ${direction === 'remove' ? 'bg-red-600 border-red-600 text-white' : 'border-gray-200 text-gray-600'}`}
                >
                  <Minus size={16} /> Remove
                </button>
              </div>

              <label className="block text-xs font-medium text-gray-500 mb-1.5">Quantity</label>
              <input
                type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />

              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reason</label>
              <select
                value={reason} onChange={e => setReason(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>

              <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes (optional)</label>
              <input
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Any extra details..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />

              <button
                onClick={submit}
                disabled={submitting}
                className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-white transition-colors disabled:opacity-50 ${direction === 'add' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                {submitting ? 'Saving...' : `${direction === 'add' ? 'Add' : 'Remove'} ${qty || 0} unit${qty === '1' ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>
      </div>

      {showScanner && (
        <CameraScanner onScan={handleBarcodeScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  )
}
