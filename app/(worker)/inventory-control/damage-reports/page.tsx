'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Plus, Loader2, CheckCircle, AlertTriangle, Scan } from 'lucide-react'
import { toast } from 'sonner'
import CameraScanner from '@/components/CameraScanner'
import { lookupProductIdByBarcode } from '@/lib/barcode'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type DamageReport = {
  id: string
  product_name: string
  quantity: number
  reason: string
  notes: string | null
  reported_by: string | null
  status: 'pending' | 'written_off' | 'returned_to_stock'
  created_at: string
}
type ProductOption = { id: string; name: string; sku: string }

const REASONS = ['dropped', 'water damage', 'torn packaging', 'expired', 'manufacturing defect', 'mishandled', 'other']

export default function InventoryDamageReportsPage() {
  const supabase = createClient()
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [reports, setReports] = useState<DamageReport[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showScanner, setShowScanner] = useState(false)

  const [form, setForm] = useState({
    product_id: '', product_name: '', quantity: '1', reason: 'other', notes: '', reported_by: '',
  })
  const productFieldRef = useRef<HTMLInputElement>(null)

  // Keep the product field focused so a scan gun can be used back-to-back
  // without clicking in between scans.
  useEffect(() => {
    if (showForm && !form.product_id) productFieldRef.current?.focus()
  }, [showForm, form.product_id])

  async function load() {
    const [session, reportsRes] = await Promise.all([
      fetch('/api/worker-session').then(r => r.ok ? r.json() : null),
      fetch('/api/damage-reports'),
    ])
    if (session) {
      setWorker(session)
      const { data } = await supabase.from('products').select('id, name, sku').eq('org_id', session.orgId).order('name')
      setProducts(data || [])
    }
    const reportsData = await reportsRes.json()
    if (!reportsData.error) setReports(reportsData)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function selectProduct(productId: string) {
    const product = products.find(p => p.id === productId)
    setForm(f => ({ ...f, product_id: productId, product_name: product?.name || '' }))
  }

  async function selectByExactMatch(raw: string): Promise<boolean> {
    const productId = await lookupProductIdByBarcode(supabase, raw.trim())
    if (!productId) return false
    const product = products.find(p => p.id === productId)
    if (!product) return false
    setShowForm(true)
    selectProduct(product.id)
    return true
  }

  async function handleBarcodeScan(raw: string) {
    setShowScanner(false)
    const found = await selectByExactMatch(raw)
    if (!found) toast.error(`Unknown barcode: ${raw.trim()}`)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const res = await fetch('/api/damage-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success('Reported — removed from available stock')
      setForm({ product_id: '', product_name: '', quantity: '1', reason: 'other', notes: '', reported_by: '' })
      setShowForm(false)
      await load()
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
          <p className="font-bold text-gray-900">Damage Reports</p>
          <p className="text-xs text-gray-500">Log damaged or unsellable items</p>
        </div>
      </div>

      <div className="flex-1 p-6 sm:p-8">
        <div className="max-w-lg mx-auto space-y-5">
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus size={16} /> Report Damage
          </button>

          {showForm && (
            <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Product</label>
                <div className="flex items-center gap-2">
                  <select value={form.product_id} onChange={e => selectProduct(e.target.value)} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400">
                    <option value="">Select a product...</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    className="flex items-center justify-center bg-cyan-600 hover:bg-cyan-700 text-white p-2 rounded-xl transition-colors shrink-0"
                    aria-label="Scan product barcode"
                  >
                    <Scan size={16} />
                  </button>
                </div>
              </div>
              {!form.product_id && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Or scan / type product name or SKU</label>
                  <input
                    ref={productFieldRef}
                    value={form.product_name}
                    onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); selectByExactMatch(form.product_name) } }}
                    placeholder="Product name or SKU"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Quantity *</label>
                  <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Reason *</label>
                  <select value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400">
                    {REASONS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Your Name</label>
                <input value={form.reported_by} onChange={e => setForm(f => ({ ...f, reported_by: e.target.value }))} placeholder="Your name" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any extra details..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={submitting} className="flex items-center gap-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                  {submitting ? 'Submitting...' : 'Submit Report'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            </form>
          )}

          {!loading && reports.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
              <CheckCircle size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">No damage reports</p>
            </div>
          )}

          <div className="space-y-3">
            {reports.map(report => (
              <div key={report.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${report.status === 'pending' ? 'border-orange-200' : 'border-gray-100'}`}>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="font-semibold text-gray-900">{report.product_name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    report.status === 'pending' ? 'bg-orange-100 text-orange-700' :
                    report.status === 'written_off' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {report.status === 'written_off' ? 'Written Off' : report.status === 'returned_to_stock' ? 'Returned to Stock' : 'Pending Review'}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{report.quantity} unit{report.quantity !== 1 ? 's' : ''} — {report.reason}</p>
                {report.notes && <p className="text-xs text-gray-400 mt-1">{report.notes}</p>}
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                  {report.reported_by && <span>By {report.reported_by}</span>}
                  <span>{new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showScanner && (
        <CameraScanner onScan={handleBarcodeScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  )
}
