'use client'

import { useEffect, useState } from 'react'
import { Plus, Loader2, CheckCircle, RotateCcw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

type DamageReport = {
  id: string
  product_name: string
  quantity: number
  reason: string
  notes: string | null
  reported_by: string | null
  status: 'pending' | 'written_off' | 'returned_to_stock'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

const REASONS = ['dropped', 'water damage', 'torn packaging', 'expired', 'manufacturing defect', 'mishandled', 'other']

export default function DamageReportsPage() {
  const [reports, setReports] = useState<DamageReport[]>([])
  const [products, setProducts] = useState<{ id: string; name: string; sku: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'written_off' | 'returned_to_stock'>('all')
  const [reviewedBy, setReviewedBy] = useState('')

  const [form, setForm] = useState({
    product_id: '',
    product_name: '',
    quantity: '1',
    reason: 'other',
    notes: '',
    reported_by: '',
  })

  async function load() {
    const [reportsRes, productsRes] = await Promise.all([
      fetch('/api/damage-reports'),
      fetch('/api/products'),
    ])
    const reportsData = await reportsRes.json()
    const productsData = await productsRes.json()
    if (!reportsData.error) setReports(reportsData)
    if (!productsData.error) setProducts(productsData)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function handleProductSelect(productId: string) {
    const product = products.find(p => p.id === productId)
    setForm(f => ({ ...f, product_id: productId, product_name: product?.name || '' }))
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
      toast.success('Damage report submitted')
      setForm({ product_id: '', product_name: '', quantity: '1', reason: 'other', notes: '', reported_by: '' })
      setShowForm(false)
      await load()
    }
    setSubmitting(false)
  }

  async function updateStatus(id: string, status: string) {
    setUpdating(id)
    const res = await fetch(`/api/damage-reports/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewed_by: reviewedBy }),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success(status === 'written_off' ? 'Written off' : 'Returned to stock')
      await load()
    }
    setUpdating(null)
  }

  const filtered = filter === 'all' ? reports : reports.filter(r => r.status === filter)
  const pendingCount = reports.filter(r => r.status === 'pending').length
  const totalDamaged = reports.filter(r => r.status === 'pending').reduce((sum, r) => sum + r.quantity, 0)

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Damage Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Log and track damaged inventory items</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Report Damage
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-orange-600">{pendingCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Pending Review</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{totalDamaged}</p>
          <p className="text-xs text-gray-500 mt-0.5">Units Damaged</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-700">{reports.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total Reports</p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <p className="font-semibold text-gray-800">Report Damaged Item</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Product</label>
              <select
                value={form.product_id}
                onChange={e => handleProductSelect(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                <option value="">Select a product...</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
            </div>
            {!form.product_id && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Or type product name manually</label>
                <input
                  value={form.product_name}
                  onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
                  placeholder="Product name"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Quantity Damaged *</label>
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reason *</label>
              <select
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                {REASONS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reported By</label>
              <input
                value={form.reported_by}
                onChange={e => setForm(f => ({ ...f, reported_by: e.target.value }))}
                placeholder="Your name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any extra details..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2">
        {(['all', 'pending', 'written_off', 'returned_to_stock'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {f === 'written_off' ? 'Written Off' : f === 'returned_to_stock' ? 'Returned' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Reports List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <CheckCircle size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No damage reports found</p>
          </div>
        )}
        {filtered.map(report => (
          <div key={report.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${report.status === 'pending' ? 'border-orange-200' : 'border-gray-100'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{report.product_name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    report.status === 'pending' ? 'bg-orange-100 text-orange-700' :
                    report.status === 'written_off' ? 'bg-red-100 text-red-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {report.status === 'written_off' ? 'Written Off' : report.status === 'returned_to_stock' ? 'Returned to Stock' : 'Pending'}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{report.quantity} unit{report.quantity !== 1 ? 's' : ''} — {report.reason}</p>
                {report.notes && <p className="text-xs text-gray-400 mt-1">{report.notes}</p>}
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                  {report.reported_by && <span>By {report.reported_by}</span>}
                  <span>{new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  {report.reviewed_by && <span>Reviewed by {report.reviewed_by}</span>}
                </div>
              </div>

              {report.status === 'pending' && (
                <div className="flex flex-col gap-2 shrink-0">
                  <input
                    value={reviewedBy}
                    onChange={e => setReviewedBy(e.target.value)}
                    placeholder="Your name"
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400 w-28"
                  />
                  <button
                    onClick={() => updateStatus(report.id, 'written_off')}
                    disabled={updating === report.id}
                    className="flex items-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    {updating === report.id ? <Loader2 size={11} className="animate-spin" /> : <AlertTriangle size={11} />}
                    Write Off
                  </button>
                  <button
                    onClick={() => updateStatus(report.id, 'returned_to_stock')}
                    disabled={updating === report.id}
                    className="flex items-center gap-1.5 border border-green-200 text-green-600 hover:bg-green-50 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    {updating === report.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                    Return to Stock
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
