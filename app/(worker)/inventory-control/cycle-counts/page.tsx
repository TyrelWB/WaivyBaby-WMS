'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, ClipboardList, CheckCircle, Package } from 'lucide-react'
import { toast } from 'sonner'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }
type CountItem = {
  id: string; product_id: string; qty_expected: number | null; qty_counted: number | null
  discrepancy: number | null; products: { name: string; sku: string }; bins: { location_code: string } | null
}
type Count = { id: string; name: string | null; status: string; created_at: string; cycle_count_items: CountItem[] }

export default function InventoryCycleCountsPage() {
  const supabase = createClient()
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [counts, setCounts] = useState<Count[]>([])
  const [active, setActive] = useState<Count | null>(null)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)

  async function fetchData(session: WorkerSession) {
    const { data } = await supabase
      .from('cycle_counts')
      .select('id, name, status, created_at, cycle_count_items(id, product_id, qty_expected, qty_counted, discrepancy, products(name, sku), bins(location_code))')
      .eq('org_id', session.orgId)
      .in('status', ['draft', 'in_progress'])
      .order('created_at', { ascending: false })
    const base = (data as unknown as Count[]) || []
    const sanitized = base.map(c => ({
      ...c,
      cycle_count_items: c.cycle_count_items.map(i => ({ ...i, products: i.products || { name: 'Unknown product', sku: '—' } })),
    }))
    setCounts(sanitized)
    setActive(prev => prev ? sanitized.find(c => c.id === prev.id) || null : null)
    setLoading(false)
  }

  useEffect(() => {
    fetch('/api/worker-session').then(r => r.ok ? r.json() : null).then(session => {
      if (session) { setWorker(session); fetchData(session) } else setLoading(false)
    })
  }, [])

  async function selectCount(count: Count) {
    if (count.status === 'draft' && worker) {
      await supabase.from('cycle_counts').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', count.id)
    }
    setActive(count)
  }

  async function updateItemCount(item: CountItem, newCount: string) {
    const qty = parseInt(newCount)
    if (isNaN(qty) || qty < 0 || !active) return
    await supabase.from('cycle_count_items').update({ qty_counted: qty, counted_at: new Date().toISOString() }).eq('id', item.id)
    setActive(prev => prev ? {
      ...prev,
      cycle_count_items: prev.cycle_count_items.map(i => i.id === item.id ? { ...i, qty_counted: qty, discrepancy: qty - (i.qty_expected || 0) } : i),
    } : prev)
  }

  async function completeCount() {
    if (!active || !worker) return
    setCompleting(true)
    for (const item of active.cycle_count_items) {
      if (item.qty_counted !== null && item.discrepancy) {
        const { data: inv } = await supabase.from('inventory').select('id, qty_available').eq('product_id', item.product_id).eq('org_id', worker.orgId).single()
        if (inv) {
          await supabase.from('inventory').update({
            qty_on_hand: item.qty_counted,
            qty_available: Math.max(0, inv.qty_available + item.discrepancy),
          }).eq('id', inv.id)
        }
      }
    }
    await supabase.from('cycle_counts').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', active.id)
    toast.success('Count completed — inventory updated')
    setActive(null)
    setCompleting(false)
    fetchData(worker)
  }

  const allCounted = active ? active.cycle_count_items.every(i => i.qty_counted !== null) && active.cycle_count_items.length > 0 : false

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 sm:px-8 py-4 flex items-center gap-4">
        {active ? (
          <button onClick={() => setActive(null)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
        ) : (
          <a href="/inventory-control" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </a>
        )}
        <div>
          <p className="font-bold text-gray-900">{active ? (active.name || 'Cycle Count') : 'Cycle Counts'}</p>
          <p className="text-xs text-gray-500">{active ? `${active.cycle_count_items.filter(i => i.qty_counted !== null).length} of ${active.cycle_count_items.length} counted` : 'Count assigned bins and reconcile stock'}</p>
        </div>
      </div>

      <div className="flex-1 p-6 sm:p-8">
        <div className="max-w-lg mx-auto">
          {!active ? (
            loading ? (
              <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
            ) : counts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
                <ClipboardList size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm">No open cycle counts</p>
                <p className="text-gray-400 text-xs mt-1">Ask your manager to create one.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {counts.map(count => (
                  <button
                    key={count.id}
                    onClick={() => selectCount(count)}
                    className="w-full flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-left hover:border-cyan-300 hover:shadow-sm transition-all"
                  >
                    <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center shrink-0">
                      <ClipboardList size={16} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{count.name || 'Untitled Count'}</p>
                      <p className="text-xs text-gray-400">{count.cycle_count_items.length} items</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${count.status === 'in_progress' ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-500'}`}>
                      {count.status === 'in_progress' ? 'In Progress' : 'Not Started'}
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-3">
              {active.cycle_count_items.map(item => {
                const done = item.qty_counted !== null
                const mismatch = done && item.discrepancy !== 0
                return (
                  <div key={item.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${mismatch ? 'border-orange-200' : done ? 'border-green-200' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                        <Package size={16} className="text-gray-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.products.name}</p>
                        <p className="text-xs text-gray-400 font-mono">{item.products.sku}{item.bins ? ` · ${item.bins.location_code}` : ''}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-400">Expected: {item.qty_expected ?? '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                      <label className="text-xs text-gray-500 font-medium">Counted:</label>
                      <input
                        type="number" min="0"
                        defaultValue={item.qty_counted ?? ''}
                        onBlur={e => e.target.value && updateItemCount(item, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        placeholder="0"
                        className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      />
                      {mismatch && (
                        <span className="text-xs font-semibold text-orange-600">
                          {item.discrepancy! > 0 ? '+' : ''}{item.discrepancy} discrepancy
                        </span>
                      )}
                      {done && !mismatch && <span className="text-xs text-green-600 font-medium">Matches</span>}
                    </div>
                  </div>
                )
              })}

              <button
                onClick={completeCount}
                disabled={!allCounted || completing}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white py-3.5 rounded-xl font-bold transition-colors mt-2"
              >
                <CheckCircle size={18} /> {completing ? 'Completing...' : 'Complete Count'}
              </button>
              {!allCounted && <p className="text-xs text-gray-400 text-center">Count every item before completing.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
