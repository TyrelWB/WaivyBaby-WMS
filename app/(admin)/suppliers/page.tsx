'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Building2, X, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../admin-context'

type Supplier = {
  id: string
  name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  lead_time_days: number | null
  created_at: string
}

const emptyForm = { name: '', contact_name: '', email: '', phone: '', lead_time_days: '7' }

export default function SuppliersPage() {
  const supabase = createClient()
  const { orgId } = useAdminContext()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function fetchSuppliers() {
    if (!orgId) { setLoading(false); return }

    const { data } = await supabase
      .from('suppliers')
      .select('id, name, contact_name, email, phone, lead_time_days, created_at')
      .eq('org_id', orgId)
      .order('name')

    setSuppliers(data || [])
    setLoading(false)
  }

  async function saveSupplier() {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!orgId) return
    setSaving(true)

    const payload = {
      org_id: orgId,
      name: form.name.trim(),
      contact_name: form.contact_name || null,
      email: form.email || null,
      phone: form.phone || null,
      lead_time_days: form.lead_time_days ? parseInt(form.lead_time_days) : 7,
    }

    if (editingId) {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', editingId)
      if (error) { toast.error(error.message); setSaving(false); return }
      toast.success('Supplier updated')
    } else {
      const { error } = await supabase.from('suppliers').insert(payload)
      if (error) { toast.error(error.message); setSaving(false); return }
      toast.success('Supplier added')
    }

    setForm(emptyForm)
    setShowForm(false)
    setEditingId(null)
    setSaving(false)
    fetchSuppliers()
  }

  async function deleteSupplier(id: string) {
    toast('Delete this supplier?', {
      action: {
        label: 'Delete', onClick: async () => {
          await supabase.from('suppliers').delete().eq('id', id)
          toast.success('Supplier deleted')
          fetchSuppliers()
        }
      },
      cancel: { label: 'Cancel', onClick: () => {} },
    })
  }

  function editSupplier(supplier: Supplier) {
    setForm({
      name: supplier.name,
      contact_name: supplier.contact_name || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      lead_time_days: supplier.lead_time_days?.toString() || '7',
    })
    setEditingId(supplier.id)
    setShowForm(true)
  }

  useEffect(() => { fetchSuppliers() }, [orgId])

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{suppliers.length} suppliers</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(emptyForm) }} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> Add Supplier
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">{editingId ? 'Edit Supplier' : 'New Supplier'}</h2>
            <button onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm) }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Company Name <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Acme Corp" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Contact Name</label>
              <input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="orders@acme.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Phone</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="(555) 000-0000" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Lead Time (days)</label>
              <input type="number" value={form.lead_time_days} onChange={e => setForm({ ...form, lead_time_days: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" min="0" />
            </div>
            <div className="col-span-2 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={saveSupplier} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Saving...' : editingId ? 'Update' : 'Add Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400 p-6">Loading...</div>
      ) : suppliers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <Building2 size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-900">No suppliers yet</p>
          <p className="text-sm text-gray-400 mt-1">Add suppliers to link to receiving records and products.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50">
            {suppliers.map(supplier => (
              <div key={supplier.id} className="flex items-center gap-4 px-6 py-4">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center shrink-0">
                  <Building2 size={16} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{supplier.name}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                    {supplier.contact_name && <span>{supplier.contact_name}</span>}
                    {supplier.email && <span>{supplier.email}</span>}
                    {supplier.phone && <span>{supplier.phone}</span>}
                    {supplier.lead_time_days !== null && <span>{supplier.lead_time_days}d lead time</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => editSupplier(supplier)} className="text-xs text-gray-500 hover:text-blue-600 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors">
                    Edit
                  </button>
                  <button onClick={() => deleteSupplier(supplier.id)} className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
