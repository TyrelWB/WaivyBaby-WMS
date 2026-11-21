'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../admin-context'
import { Plus, User, X, Eye, EyeOff, Trash2, Pencil, Check, BarChart2 } from 'lucide-react'
import { toast } from 'sonner'

type Worker = {
  id: string
  name: string
  pin: string
  role: string
  is_active: boolean
  created_at: string
}

type StatRow = {
  workerId: string
  name: string
  role: string
  picked: number
  packed: number
  shipped: number
  avgPickSecs: number | null
}

type Period = 'today' | 'week' | 'month'

const emptyForm = { name: '', pin: '', role: 'all' }

const roleColors: Record<string, string> = {
  all:       'bg-gray-100 text-gray-700',
  picker:    'bg-amber-50 text-amber-700',
  packer:    'bg-violet-50 text-violet-700',
  shipper:   'bg-orange-50 text-orange-700',
  inventory: 'bg-cyan-50 text-cyan-700',
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    all:       'All Roles',
    picker:    'Picker',
    packer:    'Packer',
    shipper:   'Shipper',
    inventory: 'Inventory Control',
  }
  return labels[role] ?? role
}

function periodStart(period: Period): string {
  const now = new Date()
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  }
  if (period === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - 6)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }
  const d = new Date(now)
  d.setDate(d.getDate() - 29)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export default function WorkersPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [tab, setTab] = useState<'workers' | 'stats'>('workers')

  // Workers tab state
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showPin, setShowPin] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', pin: '', role: '' })

  // Stats tab state
  const [period, setPeriod] = useState<Period>('today')
  const [stats, setStats] = useState<StatRow[]>([])
  const [statsLoading, setStatsLoading] = useState(false)

  async function fetchWorkers() {
    if (!orgId) { setLoading(false); return }
    const { data } = await supabase
      .from('workers')
      .select('id, name, pin, role, is_active, created_at')
      .eq('org_id', orgId)
      .order('name')
    setWorkers(data || [])
    setLoading(false)
  }

  async function fetchStats() {
    if (!orgId) return
    setStatsLoading(true)
    const since = periodStart(period)

    const [workersRes, pickedRes, packedRes, shippedRes] = await Promise.all([
      supabase.from('workers').select('id, name, role').eq('org_id', orgId).eq('is_active', true).order('name'),
      supabase.from('orders').select('assigned_picker_id, pick_started_at, pick_completed_at')
        .eq('org_id', orgId).gte('pick_completed_at', since).not('assigned_picker_id', 'is', null),
      supabase.from('orders').select('assigned_packer_id, packed_at')
        .eq('org_id', orgId).gte('packed_at', since).not('assigned_packer_id', 'is', null),
      supabase.from('orders').select('assigned_shipper_id, shipped_at')
        .eq('org_id', orgId).gte('shipped_at', since).not('assigned_shipper_id', 'is', null),
    ])

    const ws: { id: string; name: string; role: string }[] = workersRes.data || []
    const picked = pickedRes.data || []
    const packed = packedRes.data || []
    const shipped = shippedRes.data || []

    const rows: StatRow[] = ws.map(w => {
      const myPicks = picked.filter((o: any) => o.assigned_picker_id === w.id)
      const myPacks = packed.filter((o: any) => o.assigned_packer_id === w.id)
      const myShips = shipped.filter((o: any) => o.assigned_shipper_id === w.id)

      const pickTimes = myPicks
        .filter((o: any) => o.pick_started_at && o.pick_completed_at)
        .map((o: any) => Math.round((new Date(o.pick_completed_at).getTime() - new Date(o.pick_started_at).getTime()) / 1000))

      return {
        workerId: w.id,
        name: w.name,
        role: w.role,
        picked: myPicks.length,
        packed: myPacks.length,
        shipped: myShips.length,
        avgPickSecs: pickTimes.length > 0 ? Math.round(pickTimes.reduce((a, b) => a + b, 0) / pickTimes.length) : null,
      }
    })

    rows.sort((a, b) => (b.picked + b.packed + b.shipped) - (a.picked + a.packed + a.shipped))
    setStats(rows)
    setStatsLoading(false)
  }

  function startEdit(worker: Worker) {
    setEditingId(worker.id)
    setEditForm({ name: worker.name, pin: worker.pin, role: worker.role })
  }

  function cancelEdit() { setEditingId(null) }

  async function saveEdit(id: string) {
    if (!editForm.name.trim()) { toast.error('Name is required'); return }
    if (!editForm.pin || editForm.pin.length < 4 || editForm.pin.length > 6) { toast.error('PIN must be 4–6 digits'); return }
    if (!/^\d+$/.test(editForm.pin)) { toast.error('PIN must be numbers only'); return }

    const { error } = await supabase.from('workers').update({
      name: editForm.name.trim(), pin: editForm.pin, role: editForm.role,
    }).eq('id', id)

    if (error) { toast.error(error.message); return }
    toast.success('Worker updated')
    setEditingId(null)
    fetchWorkers()
  }

  async function createWorker() {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!form.pin.trim() || form.pin.length < 4 || form.pin.length > 6) { toast.error('PIN must be 4–6 digits'); return }
    if (!/^\d+$/.test(form.pin)) { toast.error('PIN must be numbers only'); return }
    if (!orgId) { toast.error('Database not set up yet'); return }
    setSaving(true)

    const { error } = await supabase.from('workers').insert({
      org_id: orgId, warehouse_id: warehouseId,
      name: form.name.trim(), pin: form.pin, role: form.role, is_active: true,
    })

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Worker added')
    setForm(emptyForm)
    setShowForm(false)
    setSaving(false)
    fetchWorkers()
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('workers').update({ is_active: !current }).eq('id', id)
    toast.success(current ? 'Worker deactivated' : 'Worker reactivated')
    fetchWorkers()
  }

  async function deleteWorker(id: string) {
    toast('Delete this worker?', {
      action: { label: 'Delete', onClick: async () => {
        await supabase.from('workers').delete().eq('id', id)
        toast.success('Worker deleted')
        fetchWorkers()
      }},
      cancel: { label: 'Cancel', onClick: () => {} },
    })
  }

  useEffect(() => { fetchWorkers() }, [orgId])
  useEffect(() => { if (tab === 'stats') fetchStats() }, [tab, period, orgId])

  const active = workers.filter(w => w.is_active)
  const inactive = workers.filter(w => !w.is_active)

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Workers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{active.length} active · {inactive.length} inactive</p>
        </div>
        {tab === 'workers' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            <Plus size={16} /> Add Worker
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        <button
          onClick={() => setTab('workers')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'workers' ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <User size={14} /> Workers
        </button>
        <button
          onClick={() => setTab('stats')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'stats' ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <BarChart2 size={14} /> Productivity
        </button>
      </div>

      {tab === 'workers' ? (
        <>
          {showForm && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">New Worker</h2>
                <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Full Name <span className="text-red-400">*</span></label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="Jane Smith" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">PIN (4–6 digits) <span className="text-red-400">*</span></label>
                  <input type="number" value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.slice(0, 6) })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="1234" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Role</label>
                  <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400">
                    <option value="all">All Roles</option>
                    <option value="picker">Picker</option>
                    <option value="packer">Packer</option>
                    <option value="shipper">Shipper</option>
                    <option value="inventory">Inventory Control</option>
                  </select>
                </div>
                <div className="col-span-3 flex gap-3 justify-end pt-2">
                  <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                  <button onClick={createWorker} disabled={saving} className="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                    {saving ? 'Adding...' : 'Add Worker'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Active Workers</h2>
            </div>
            {loading ? (
              <div className="p-6 text-sm text-gray-400">Loading...</div>
            ) : active.length === 0 ? (
              <div className="p-6 text-sm text-gray-400 text-center">No active workers yet.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {active.map(worker => (
                  <div key={worker.id} className="px-6 py-4">
                    {editingId === worker.id ? (
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                          <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full border border-cyan-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" autoFocus />
                        </div>
                        <div className="w-32">
                          <label className="block text-xs font-medium text-gray-500 mb-1">PIN</label>
                          <input type="number" value={editForm.pin} onChange={e => setEditForm({ ...editForm, pin: e.target.value.slice(0, 6) })} className="w-full border border-cyan-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
                        </div>
                        <div className="w-36">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                          <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} className="w-full border border-cyan-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400">
                            <option value="all">Inventory Specialist</option>
                            <option value="picker">Picker</option>
                            <option value="packer">Packer</option>
                            <option value="shipper">Shipper</option>
                          </select>
                        </div>
                        <button onClick={() => saveEdit(worker.id)} className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-600 text-white px-3 py-2 rounded-xl text-sm font-medium">
                          <Check size={14} /> Save
                        </button>
                        <button onClick={cancelEdit} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-cyan-100 rounded-full flex items-center justify-center shrink-0">
                          <User size={16} className="text-cyan-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900">{worker.name}</p>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleColors[worker.role] || 'bg-cyan-50 text-cyan-700'}`}>{roleLabel(worker.role)}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-gray-400 font-mono">PIN: {showPin[worker.id] ? worker.pin : '••••••'}</span>
                            <button onClick={() => setShowPin(p => ({ ...p, [worker.id]: !p[worker.id] }))} className="text-gray-400 hover:text-gray-600">
                              {showPin[worker.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                            <span className="text-xs text-gray-300">·</span>
                            <span className="text-xs text-gray-400">Added {new Date(worker.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => startEdit(worker)} className="p-1.5 text-gray-400 hover:text-cyan-500 rounded-lg transition-colors"><Pencil size={14} /></button>
                          <button onClick={() => toggleActive(worker.id, worker.is_active)} className="text-xs text-gray-500 hover:text-orange-600 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors">Deactivate</button>
                          <button onClick={() => deleteWorker(worker.id)} className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg transition-colors"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {inactive.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm opacity-60">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-600">Inactive Workers</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {inactive.map(worker => (
                  <div key={worker.id} className="flex items-center gap-4 px-6 py-4">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center shrink-0">
                      <User size={16} className="text-gray-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-500">{worker.name}</p>
                      <p className="text-xs text-gray-400">{roleLabel(worker.role)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => startEdit(worker)} className="p-1.5 text-gray-400 hover:text-cyan-500 rounded-lg transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => toggleActive(worker.id, worker.is_active)} className="text-xs text-cyan-500 hover:text-cyan-600 border border-cyan-200 rounded-lg px-2.5 py-1.5 transition-colors">Reactivate</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* Stats tab */
        <div>
          <div className="flex gap-2 mb-6">
            {(['today', 'week', 'month'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${period === p ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-white text-gray-600 border-gray-200 hover:border-cyan-300'}`}
              >
                {p === 'today' ? 'Today' : p === 'week' ? 'Last 7 days' : 'Last 30 days'}
              </button>
            ))}
          </div>

          {statsLoading ? (
            <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>
          ) : stats.length === 0 ? (
            <div className="text-sm text-gray-400 py-8 text-center">No active workers found.</div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Worker</th>
                    <th className="text-center px-4 py-3.5 text-xs font-semibold text-cyan-500 uppercase tracking-wider">Picked</th>
                    <th className="text-center px-4 py-3.5 text-xs font-semibold text-purple-500 uppercase tracking-wider">Packed</th>
                    <th className="text-center px-4 py-3.5 text-xs font-semibold text-orange-500 uppercase tracking-wider">Shipped</th>
                    <th className="text-center px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Pick Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stats.map(row => (
                    <tr key={row.workerId} className="hover:bg-gray-50/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-cyan-100 rounded-full flex items-center justify-center shrink-0">
                            <User size={14} className="text-cyan-500" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{row.name}</p>
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full capitalize ${roleColors[row.role] || 'bg-gray-100 text-gray-600'}`}>{row.role}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`inline-block min-w-[2rem] text-center font-bold text-lg ${row.picked > 0 ? 'text-cyan-500' : 'text-gray-300'}`}>
                          {row.picked}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`inline-block min-w-[2rem] text-center font-bold text-lg ${row.packed > 0 ? 'text-purple-600' : 'text-gray-300'}`}>
                          {row.packed}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`inline-block min-w-[2rem] text-center font-bold text-lg ${row.shipped > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
                          {row.shipped}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center text-sm text-gray-500">
                        {row.avgPickSecs !== null ? fmtDuration(row.avgPickSecs) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-6 py-3 bg-gray-50/50 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  Avg pick time = time from order scan to picking complete. Only shown for workers who completed picks {period === 'today' ? 'today' : period === 'week' ? 'in the last 7 days' : 'in the last 30 days'}.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
