'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, MapPin, X, Package, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminContext } from '../admin-context'

type Zone = {
  id: string
  name: string
  code: string
  description: string | null
  bins: Bin[]
}

type Bin = {
  id: string
  location_code: string
  zone_id: string | null
  is_active: boolean
  inventory: { qty_on_hand: number; products: { name: string; sku: string } }[]
}

const emptyZoneForm = { name: '', code: '', description: '' }
const emptyBinForm = { location_code: '', zone_id: '' }

export default function LocationsPage() {
  const supabase = createClient()
  const { orgId, warehouseId } = useAdminContext()
  const [zones, setZones] = useState<Zone[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [loading, setLoading] = useState(true)
  const [showZoneForm, setShowZoneForm] = useState(false)
  const [showBinForm, setShowBinForm] = useState(false)
  const [zoneForm, setZoneForm] = useState(emptyZoneForm)
  const [binForm, setBinForm] = useState(emptyBinForm)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [zoneSearch, setZoneSearch] = useState('')
  const [view, setView] = useState<'bins' | 'zones'>('bins')

  async function fetchData() {
    if (!orgId) { setLoading(false); return }

    const [{ data: zoneData }, { data: binData }] = await Promise.all([
      supabase.from('zones').select('id, name, code, description').eq('org_id', orgId).order('code'),
      supabase.from('bins').select('id, location_code, zone_id, is_active, inventory(qty_on_hand, products(name, sku))').eq('org_id', orgId).order('location_code'),
    ])

    const zonesWithBins = (zoneData || []).map(z => ({
      ...z,
      bins: (binData || []).filter(b => b.zone_id === z.id) as unknown as Bin[],
    }))

    setZones(zonesWithBins as unknown as Zone[])
    setBins(binData as unknown as Bin[] || [])
    setLoading(false)
  }

  async function createZone() {
    if (!zoneForm.name.trim() || !zoneForm.code.trim()) { toast.error('Name and code are required'); return }
    if (!orgId) return
    setSaving(true)

    const { error } = await supabase.from('zones').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      name: zoneForm.name.trim(),
      code: zoneForm.code.trim().toUpperCase(),
      description: zoneForm.description || null,
    })

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Zone created')
    setZoneForm(emptyZoneForm)
    setShowZoneForm(false)
    setSaving(false)
    fetchData()
  }

  async function createBin() {
    if (!binForm.location_code.trim()) { toast.error('Location code is required'); return }
    if (!orgId) return
    setSaving(true)

    const { error } = await supabase.from('bins').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      location_code: binForm.location_code.trim().toUpperCase(),
      zone_id: binForm.zone_id || null,
      is_active: true,
    })

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Bin location created')
    setBinForm(emptyBinForm)
    setShowBinForm(false)
    setSaving(false)
    fetchData()
  }

  async function toggleBin(id: string, current: boolean) {
    await supabase.from('bins').update({ is_active: !current }).eq('id', id)
    toast.success(current ? 'Bin deactivated' : 'Bin activated')
    fetchData()
  }

  useEffect(() => { fetchData() }, [orgId])

  const filteredBins = bins.filter(b =>
    b.location_code.toLowerCase().includes(search.toLowerCase())
  )

  const filteredZones = zones.filter(z =>
    z.name.toLowerCase().includes(zoneSearch.toLowerCase()) ||
    z.code.toLowerCase().includes(zoneSearch.toLowerCase())
  )

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
          <p className="text-sm text-gray-500 mt-0.5">{bins.length} bins · {zones.length} zones</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowZoneForm(!showZoneForm); setShowBinForm(false) }} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} /> Zone
          </button>
          <button onClick={() => { setShowBinForm(!showBinForm); setShowZoneForm(false) }} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} /> Bin
          </button>
        </div>
      </div>

      {/* Zone form */}
      {showZoneForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Zone</h2>
            <button onClick={() => setShowZoneForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Zone Name <span className="text-red-400">*</span></label>
              <input value={zoneForm.name} onChange={e => setZoneForm({ ...zoneForm, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Bulk Storage" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Code <span className="text-red-400">*</span></label>
              <input value={zoneForm.code} onChange={e => setZoneForm({ ...zoneForm, code: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" placeholder="A" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Description</label>
              <input value={zoneForm.description} onChange={e => setZoneForm({ ...zoneForm, description: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Optional" />
            </div>
            <div className="col-span-3 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowZoneForm(false); setZoneForm(emptyZoneForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createZone} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Creating...' : 'Create Zone'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bin form */}
      {showBinForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Bin Location</h2>
            <button onClick={() => setShowBinForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Location Code <span className="text-red-400">*</span></label>
              <input value={binForm.location_code} onChange={e => setBinForm({ ...binForm, location_code: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" placeholder="A-01-02" autoFocus />
              <p className="text-xs text-gray-400 mt-1">Format: Zone-Aisle-Shelf (e.g. A-01-02)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Zone</label>
              <select value={binForm.zone_id} onChange={e => setBinForm({ ...binForm, zone_id: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">No zone</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.code} — {z.name}</option>)}
              </select>
            </div>
            <div className="col-span-2 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowBinForm(false); setBinForm(emptyBinForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createBin} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Creating...' : 'Create Bin'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View toggle + search */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={() => setView('bins')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'bins' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Bins</button>
          <button onClick={() => setView('zones')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'zones' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Zones</button>
        </div>
        {view === 'bins' && (
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bins..." className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
        {view === 'zones' && (
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={zoneSearch} onChange={e => setZoneSearch(e.target.value)} placeholder="Search zones..." className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 p-6">Loading...</div>
      ) : view === 'bins' ? (
        filteredBins.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <MapPin size={36} className="text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">No bin locations</p>
            <p className="text-sm text-gray-400 mt-1">Create bin locations to track where products are stored.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-50">
              {filteredBins.map(bin => {
                const zone = zones.find(z => z.id === bin.zone_id)
                const itemCount = bin.inventory?.length || 0
                return (
                  <div key={bin.id} className={`flex items-center gap-4 px-6 py-4 ${!bin.is_active ? 'opacity-50' : ''}`}>
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                      <MapPin size={16} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 font-mono">{bin.location_code}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                        {zone && <span>{zone.name}</span>}
                        {itemCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Package size={10} /> {itemCount} SKU{itemCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {itemCount === 0 && <span className="text-gray-300">Empty</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleBin(bin.id, bin.is_active)}
                      className={`text-xs border rounded-lg px-2.5 py-1.5 transition-colors ${bin.is_active ? 'text-gray-500 border-gray-200 hover:text-orange-600' : 'text-blue-600 border-blue-200 hover:bg-blue-50'}`}
                    >
                      {bin.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      ) : (
        zones.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <MapPin size={36} className="text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">No zones yet</p>
            <p className="text-sm text-gray-400 mt-1">Zones group bins into logical areas of your warehouse.</p>
          </div>
        ) : filteredZones.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
            <p className="text-sm text-gray-400">No zones match your search.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredZones.map(zone => (
              <div key={zone.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">{zone.code}</div>
                  <div>
                    <p className="font-semibold text-gray-900">{zone.name}</p>
                    {zone.description && <p className="text-xs text-gray-400">{zone.description}</p>}
                  </div>
                  <span className="ml-auto text-xs text-gray-400">{zone.bins.length} bins</span>
                </div>
                {zone.bins.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {zone.bins.map(bin => (
                      <span key={bin.id} className={`text-xs font-mono px-2 py-1 rounded-md ${bin.is_active ? 'bg-gray-100 text-gray-700' : 'bg-gray-50 text-gray-400 line-through'}`}>
                        {bin.location_code}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
