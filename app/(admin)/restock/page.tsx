'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, CheckCircle, ShoppingCart, AlertTriangle, Package } from 'lucide-react'
import { toast } from 'sonner'

type RestockNotification = {
  id: string
  product_name: string
  sku: string
  qty_available: number
  reorder_point: number
  status: 'open' | 'ordered' | 'resolved'
  created_at: string
  updated_at: string
}

export default function RestockPage() {
  const [notifications, setNotifications] = useState<RestockNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [filter, setFilter] = useState<'open' | 'ordered' | 'resolved' | 'all'>('open')

  async function load() {
    const res = await fetch('/api/restock-notifications')
    const data = await res.json()
    if (!data.error) setNotifications(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function scan() {
    setScanning(true)
    const res = await fetch('/api/restock-notifications', { method: 'POST' })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else if (data.message) {
      toast.info(data.message)
    } else {
      toast.success(`Scan complete — ${data.generated} new alerts, ${data.skipped} already open`)
      await load()
    }
    setScanning(false)
  }

  async function updateStatus(id: string, status: string) {
    setUpdating(id)
    const res = await fetch(`/api/restock-notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success(status === 'ordered' ? 'Marked as ordered' : 'Marked as resolved')
      await load()
    }
    setUpdating(null)
  }

  const filtered = filter === 'all' ? notifications : notifications.filter(n => n.status === filter)
  const openCount = notifications.filter(n => n.status === 'open').length
  const orderedCount = notifications.filter(n => n.status === 'ordered').length

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Restock Notifications</h1>
          <p className="text-sm text-gray-500 mt-0.5">Products running low based on reorder points</p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {scanning ? 'Scanning...' : 'Scan Inventory'}
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-xs text-blue-700">
          Click <strong>Scan Inventory</strong> to check all products against their reorder points.
          Set reorder points on individual products in the <a href="/inventory" className="underline">Inventory</a> page.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{openCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Need Reorder</p>
        </div>
        <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{orderedCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Ordered</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-700">{notifications.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total Alerts</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        {(['open', 'ordered', 'resolved', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <Package size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">
              {filter === 'open' ? 'No products need restocking' : `No ${filter} notifications`}
            </p>
            {filter === 'open' && (
              <p className="text-gray-400 text-xs mt-1">Click Scan Inventory to check stock levels</p>
            )}
          </div>
        )}

        {filtered.map(n => (
          <div key={n.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${n.status === 'open' ? 'border-red-200' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{n.product_name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    n.status === 'open' ? 'bg-red-100 text-red-700' :
                    n.status === 'ordered' ? 'bg-blue-100 text-blue-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {n.status === 'open' ? 'Needs Reorder' : n.status === 'ordered' ? 'Ordered' : 'Resolved'}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1">
                  <span className="text-xs text-gray-400 font-mono">{n.sku}</span>
                  <span className="text-sm font-bold text-red-600">{n.qty_available} in stock</span>
                  <span className="text-xs text-gray-400">reorder at {n.reorder_point}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(n.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>

              {n.status !== 'resolved' && (
                <div className="flex flex-col gap-2 shrink-0">
                  {n.status === 'open' && (
                    <button
                      onClick={() => updateStatus(n.id, 'ordered')}
                      disabled={updating === n.id}
                      className="flex items-center gap-1.5 border border-blue-200 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                    >
                      {updating === n.id ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
                      Mark Ordered
                    </button>
                  )}
                  <button
                    onClick={() => updateStatus(n.id, 'resolved')}
                    disabled={updating === n.id}
                    className="flex items-center gap-1.5 border border-green-200 text-green-600 hover:bg-green-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    {updating === n.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                    Resolve
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
