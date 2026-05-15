'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../admin-context'
import { Plus, User, X, Eye, EyeOff, Trash2, Pencil, Check } from 'lucide-react'
import { toast } from 'sonner'

type Worker = {
  id: string
  name: string
  pin: string
  role: string
  is_active: boolean
  created_at: string
}

const emptyForm = { name: '', pin: '', role: 'picker' }

const roleColors: Record<string, string> = {
  picker: 'bg-blue-100 text-blue-700',
  packer: 'bg-purple-100 text-purple-700',
  receiver: 'bg-green-100 text-green-700',
  all: 'bg-orange-100 text-orange-700',
}

export default function WorkersPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showPin, setShowPin] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', pin: '', role: '' })

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

  function startEdit(worker: Worker) {
    setEditingId(worker.id)
    setEditForm({ name: worker.name, pin: worker.pin, role: worker.role })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim()) { toast.error('Name is required'); return }
    if (!editForm.pin || editForm.pin.length < 4 || editForm.pin.length > 6) { toast.error('PIN must be 4–6 digits'); return }
    if (!/^\d+$/.test(editForm.pin)) { toast.error('PIN must be numbers only'); return }

    const { error } = await supabase.from('workers').update({
      name: editForm.name.trim(),
      pin: editForm.pin,
      role: editForm.role,
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
      org_id: orgId,
      warehouse_id: warehouseId,
      name: form.name.trim(),
      pin: form.pin,
      role: form.role,
      is_active: true,
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

  const active = workers.filter(w => w.is_active)
  const inactive = workers.filter(w => !w.is_active)

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{active.length} active · {inactive.length} inactive</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> Add Worker
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Worker</h2>
            <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Full Name <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Jane Smith" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">PIN (4–6 digits) <span className="text-red-400">*</span></label>
              <input type="number" value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.slice(0, 6) })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="1234" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Role</label>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="picker">Picker</option>
                <option value="packer">Packer</option>
                <option value="receiver">Receiver</option>
                <option value="all">All Roles</option>
              </select>
            </div>
            <div className="col-span-3 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowForm(false); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createWorker} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                {saving ? 'Adding...' : 'Add Worker'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active workers */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-4">
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
                      <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
                    </div>
                    <div className="w-32">
                      <label className="block text-xs font-medium text-gray-500 mb-1">PIN</label>
                      <input type="number" value={editForm.pin} onChange={e => setEditForm({ ...editForm, pin: e.target.value.slice(0, 6) })} className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="w-36">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                      <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="picker">Picker</option>
                        <option value="packer">Packer</option>
                        <option value="receiver">Receiver</option>
                        <option value="all">All Roles</option>
                      </select>
                    </div>
                    <button onClick={() => saveEdit(worker.id)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
                      <Check size={14} /> Save
                    </button>
                    <button onClick={cancelEdit} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                      <User size={16} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{worker.name}</p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${roleColors[worker.role] || 'bg-gray-100 text-gray-600'}`}>{worker.role}</span>
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
                      <button onClick={() => startEdit(worker)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg transition-colors"><Pencil size={14} /></button>
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
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm opacity-60">
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
                  <p className="text-xs text-gray-400 capitalize">{worker.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(worker)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => toggleActive(worker.id, worker.is_active)} className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-2.5 py-1.5 transition-colors">Reactivate</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
