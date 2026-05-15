'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AlertTriangle, CheckCircle, Clock, Package, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../admin-context'

type Exception = {
  id: string
  type: string
  severity: string
  status: string
  description: string
  created_at: string
  resolved_at: string | null
  orders: { order_number: string } | null
  workers: { name: string } | null
  products: { name: string; sku: string } | null
}

const severityColors: Record<string, string> = {
  soft: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

const typeLabels: Record<string, string> = {
  short_pick: 'Short Pick',
  wrong_item: 'Wrong Item',
  damaged: 'Damaged',
  missing: 'Missing',
  overcount: 'Overcount',
  basket_conflict: 'Basket Conflict',
  unknown_barcode: 'Unknown Barcode',
  other: 'Other',
}

export default function ExceptionsPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [exceptions, setExceptions] = useState<Exception[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open')

  async function fetchExceptions() {
    if (!orgId) { setLoading(false); return }

    let query = supabase
      .from('exceptions')
      .select(`
        id, type, severity, status, description, created_at, resolved_at,
        orders(order_number),
        workers(name),
        products(name, sku)
      `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (filter === 'open') query = query.eq('status', 'open')
    if (filter === 'resolved') query = query.eq('status', 'resolved')

    const { data } = await query
    setExceptions(data as unknown as Exception[] || [])
    setLoading(false)
  }

  async function resolveException(id: string) {
    await supabase.from('exceptions').update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    }).eq('id', id)
    toast.success('Exception resolved')
    fetchExceptions()
  }

  async function snoozeException(id: string) {
    await supabase.from('exceptions').update({ status: 'snoozed' }).eq('id', id)
    toast.success('Exception snoozed')
    fetchExceptions()
  }

  useEffect(() => { fetchExceptions() }, [filter, orgId])

  const open = exceptions.filter(e => e.status === 'open')
  const critical = open.filter(e => e.severity === 'hard' || e.severity === 'critical' || e.severity === 'high')

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exceptions</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {open.length} open{critical.length > 0 ? ` · ${critical.length} need attention` : ''}
          </p>
        </div>
        <button onClick={fetchExceptions} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(['open', 'resolved', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 p-6">Loading...</div>
      ) : exceptions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <CheckCircle size={36} className="text-green-400 mx-auto mb-3" />
          <p className="font-semibold text-gray-900">
            {filter === 'open' ? 'No open exceptions' : 'No exceptions found'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {filter === 'open' ? 'All clear — warehouse is running smoothly.' : 'Nothing to show for this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {exceptions.map(ex => (
            <div key={ex.id} className={`bg-white rounded-xl border shadow-sm p-5 ${ex.severity === 'hard' || ex.severity === 'critical' ? 'border-red-200' : ex.severity === 'high' ? 'border-orange-200' : 'border-gray-100'}`}>
              <div className="flex items-start gap-4">
                <div className={`mt-0.5 p-2 rounded-lg ${ex.severity === 'hard' || ex.severity === 'critical' || ex.severity === 'high' ? 'bg-red-50' : 'bg-yellow-50'}`}>
                  <AlertTriangle size={16} className={ex.severity === 'hard' || ex.severity === 'critical' || ex.severity === 'high' ? 'text-red-500' : 'text-yellow-500'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm">{typeLabels[ex.type] || ex.type}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${severityColors[ex.severity] || severityColors.low}`}>
                      {ex.severity}
                    </span>
                    {ex.status !== 'open' && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">{ex.status}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{ex.description}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
                    {ex.orders && (
                      <span className="flex items-center gap-1">
                        <Package size={11} /> Order #{ex.orders.order_number}
                      </span>
                    )}
                    {ex.workers && (
                      <span>Worker: {ex.workers.name}</span>
                    )}
                    {ex.products && (
                      <span>{ex.products.name} ({ex.products.sku})</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> {new Date(ex.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                    {ex.resolved_at && (
                      <span className="text-green-500">Resolved {new Date(ex.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    )}
                  </div>
                </div>
                {ex.status === 'open' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => snoozeException(ex.id)}
                      className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      Snooze
                    </button>
                    <button
                      onClick={() => resolveException(ex.id)}
                      className="text-xs text-white bg-green-600 hover:bg-green-700 rounded-lg px-2.5 py-1.5 transition-colors font-medium"
                    >
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
