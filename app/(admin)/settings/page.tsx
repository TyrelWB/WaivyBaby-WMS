'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Building2, LogOut, Save, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

type OrgSettings = {
  id: string
  name: string
  slug: string
}

type WarehouseSettings = {
  id: string
  name: string
  address: string | null
  timezone: string | null
}

type AdminUser = {
  id: string
  email: string | null
  org_id: string
  warehouse_id: string
}

export default function SettingsPage() {
  const supabase = createClient()
  const [org, setOrg] = useState<OrgSettings | null>(null)
  const [warehouse, setWarehouse] = useState<WarehouseSettings | null>(null)
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [orgForm, setOrgForm] = useState({ name: '' })
  const [warehouseForm, setWarehouseForm] = useState({ name: '', address: '', timezone: '' })
  const [resetConfirm, setResetConfirm] = useState('')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => { fetchSettings() }, [])

  async function fetchSettings() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, org_id, warehouse_id')
      .eq('id', user.id)
      .single()

    if (!adminData) { setLoading(false); return }

    setAdminUser({ ...adminData, email: user.email || null })

    const [{ data: orgData }, { data: whData }] = await Promise.all([
      supabase.from('organizations').select('id, name, slug').eq('id', adminData.org_id).single(),
      supabase.from('warehouses').select('id, name, address, timezone').eq('id', adminData.warehouse_id).single(),
    ])

    if (orgData) {
      setOrg(orgData)
      setOrgForm({ name: orgData.name })
    }
    if (whData) {
      setWarehouse(whData)
      setWarehouseForm({ name: whData.name, address: whData.address || '', timezone: whData.timezone || '' })
    }

    setLoading(false)
  }

  async function saveOrg() {
    if (!org || !orgForm.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const { error } = await supabase.from('organizations').update({ name: orgForm.name.trim() }).eq('id', org.id)
    if (error) { toast.error(error.message) } else { toast.success('Organization updated') }
    setSaving(false)
  }

  async function saveWarehouse() {
    if (!warehouse || !warehouseForm.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const { error } = await supabase.from('warehouses').update({
      name: warehouseForm.name.trim(),
      address: warehouseForm.address || null,
      timezone: warehouseForm.timezone || null,
    }).eq('id', warehouse.id)
    if (error) { toast.error(error.message) } else { toast.success('Warehouse updated') }
    setSaving(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  async function handleReset() {
    if (resetConfirm !== 'RESET') { toast.error('Type RESET to confirm'); return }
    setResetting(true)
    const res = await fetch('/api/reset-data', { method: 'POST' })
    if (!res.ok) {
      toast.error('Reset failed. Try again.')
      setResetting(false)
      return
    }
    toast.success('All data has been reset')
    setShowResetConfirm(false)
    setResetConfirm('')
    setResetting(false)
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your organization and warehouse configuration</p>
      </div>

      {/* Account */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Account</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">{adminUser?.email || '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">Administrator</p>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-3 py-2 transition-colors">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>

      {/* Organization */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={18} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">Organization</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Organization Name</label>
            <input
              value={orgForm.name}
              onChange={e => setOrgForm({ name: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Slug</label>
            <input
              value={org?.slug || ''}
              disabled
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">Slug cannot be changed after creation</p>
          </div>
          <div className="flex justify-end">
            <button onClick={saveOrg} disabled={saving} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
              <Save size={14} /> Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Warehouse */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Warehouse</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Warehouse Name</label>
            <input
              value={warehouseForm.name}
              onChange={e => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Address</label>
            <input
              value={warehouseForm.address}
              onChange={e => setWarehouseForm({ ...warehouseForm, address: e.target.value })}
              placeholder="123 Warehouse St, City, State"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Timezone</label>
            <select
              value={warehouseForm.timezone}
              onChange={e => setWarehouseForm({ ...warehouseForm, timezone: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select timezone</option>
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Chicago">Central Time (CT)</option>
              <option value="America/Denver">Mountain Time (MT)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
              <option value="America/Anchorage">Alaska Time (AKT)</option>
              <option value="Pacific/Honolulu">Hawaii Time (HT)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div className="flex justify-end">
            <button onClick={saveWarehouse} disabled={saving} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
              <Save size={14} /> Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-xl border border-red-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={18} className="text-red-400" />
          <h2 className="font-semibold text-red-600">Danger Zone</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">These actions are permanent and cannot be undone.</p>
        <div className="p-4 border border-red-100 rounded-lg bg-red-50 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">Reset all data</p>
              <p className="text-xs text-gray-500 mt-0.5">Deletes all orders, inventory, workers, products, and warehouse records. Organization and your account are kept.</p>
            </div>
            {!showResetConfirm && (
              <button
                onClick={() => setShowResetConfirm(true)}
                className="text-xs text-red-600 border border-red-300 hover:bg-red-100 rounded-lg px-3 py-2 transition-colors font-medium shrink-0"
              >
                Reset Data
              </button>
            )}
          </div>
          {showResetConfirm && (
            <div className="space-y-3 pt-1 border-t border-red-200">
              <p className="text-xs font-medium text-red-700">Type <span className="font-mono font-bold">RESET</span> to confirm:</p>
              <input
                value={resetConfirm}
                onChange={e => setResetConfirm(e.target.value)}
                className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400 font-mono"
                placeholder="RESET"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  disabled={resetting || resetConfirm !== 'RESET'}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {resetting ? 'Resetting...' : 'Confirm Reset'}
                </button>
                <button
                  onClick={() => { setShowResetConfirm(false); setResetConfirm('') }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
