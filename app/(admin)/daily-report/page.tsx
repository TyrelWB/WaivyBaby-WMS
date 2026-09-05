'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, TrendingUp, Package, AlertTriangle, ShoppingCart, Send } from 'lucide-react'
import { toast } from 'sonner'

type ReportData = {
  date: string
  stats: {
    orders_processed: number
    orders_picked: number
    orders_packed: number
    orders_shipped: number
    damage_reports: number
    incidents: number
    low_stock_count: number
  }
  low_stock: { name: string; sku: string; qty: number; reorder_point: number }[]
  recent_orders: { order_number: string; customer_name: string; status: string; created_at: string }[]
  recent_incidents: { title: string; severity: string; status: string; created_at: string }[]
  recent_damage: { product_name: string; quantity: number; reason: string; created_at: string }[]
}

export default function DailyReportPage() {
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/daily-report')
    const data = await res.json()
    if (!data.error) setReport(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function sendReport() {
    setSending(true)
    const res = await fetch('/api/daily-report', { method: 'POST' })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success('Daily report sent to manager')
    }
    setSending(false)
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading report...</div>
  if (!report) return <div className="p-6 text-sm text-red-400">Failed to load report</div>

  const { stats } = report

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Daily Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">{report.date}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            onClick={sendReport}
            disabled={sending}
            className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'Sending...' : 'Send to Manager'}
          </button>
        </div>
      </div>

      {/* Order Stats */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShoppingCart size={16} className="text-cyan-500" />
          <p className="font-semibold text-gray-800">Orders Today</p>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'New Orders', value: stats.orders_processed, color: 'text-gray-800' },
            { label: 'Picked', value: stats.orders_picked, color: 'text-blue-600' },
            { label: 'Packed', value: stats.orders_packed, color: 'text-purple-600' },
            { label: 'Shipped', value: stats.orders_shipped, color: 'text-green-600' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        {report.recent_orders.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-gray-100">
            {report.recent_orders.map((o, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800">{o.order_number}</span>
                <span className="text-gray-500">{o.customer_name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  o.status === 'shipped' ? 'bg-green-100 text-green-700' :
                  o.status === 'packed' ? 'bg-purple-100 text-purple-700' :
                  o.status === 'picked' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{o.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Low Stock */}
      {report.low_stock.length > 0 && (
        <div className="bg-white rounded-2xl border border-orange-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-orange-500" />
            <p className="font-semibold text-gray-800">Low Stock ({stats.low_stock_count} products)</p>
          </div>
          <div className="space-y-2">
            {report.low_stock.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800">{p.name}</span>
                <span className="text-gray-400 font-mono text-xs">{p.sku}</span>
                <span className="text-orange-600 font-bold">{p.qty} left</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incidents */}
      {report.recent_incidents.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <p className="font-semibold text-gray-800">Incidents Today ({stats.incidents})</p>
          </div>
          <div className="space-y-2">
            {report.recent_incidents.map((inc, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800">{inc.title}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  inc.severity === 'high' ? 'bg-red-100 text-red-700' :
                  inc.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{inc.severity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Damage */}
      {report.recent_damage.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-gray-500" />
            <p className="font-semibold text-gray-800">Damage Reports Today ({stats.damage_reports})</p>
          </div>
          <div className="space-y-2">
            {report.recent_damage.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800">{d.product_name}</span>
                <span className="text-gray-500">{d.reason}</span>
                <span className="text-red-600 font-bold">{d.quantity} unit{d.quantity !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.orders_processed === 0 && stats.damage_reports === 0 && stats.incidents === 0 && report.low_stock.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <TrendingUp size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">No activity recorded today yet</p>
        </div>
      )}
    </div>
  )
}
