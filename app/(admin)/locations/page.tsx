'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, MapPin, X, Package, Search, ChevronDown, ChevronUp, Boxes } from 'lucide-react'
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
const emptyBinForm = { rack: '', row: '', bin: '', zone_id: '' }

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
  const [confirmDeleteBin, setConfirmDeleteBin] = useState<Bin | null>(null)
  const [confirmDeleteZone, setConfirmDeleteZone] = useState<Zone | null>(null)
  const [expandedBins, setExpandedBins] = useState<Record<string, boolean>>({})

  function toggleExpand(id: string) {
    setExpandedBins(prev => ({ ...prev, [id]: !prev[id] }))
  }

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
    toast.success('Overstock location created')
    setZoneForm(emptyZoneForm)
    setShowZoneForm(false)
    setSaving(false)
    fetchData()
  }

  async function deleteZone(zone: Zone) {
    if (zone.bins.length > 0) { toast.error('Move or delete its bins first'); return }
    const { error } = await supabase.from('zones').delete().eq('id', zone.id)
    if (error) { toast.error(error.message); return }
    toast.success(`${zone.name} deleted`)
    setConfirmDeleteZone(null)
    fetchData()
  }

  async function createBin() {
    const rack = binForm.rack.trim()
    const row = binForm.row.trim()
    const bin = binForm.bin.trim()
    if (!rack || !row || !bin) { toast.error('Rack, row, and bin are all required'); return }
    if (!orgId) return
    setSaving(true)

    const location_code = `${rack}-${row}-${bin}`.toUpperCase()

    const { error } = await supabase.from('bins').insert({
      org_id: orgId,
      warehouse_id: warehouseId,
      location_code,
      zone_id: binForm.zone_id || null,
      is_active: true,
    })

    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(`Bin ${location_code} created`)
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

  async function deleteBin(bin: Bin) {
    const { error } = await supabase.from('bins').delete().eq('id', bin.id)
    if (error) { toast.error(error.message); return }
    toast.success(`Bin ${bin.location_code} deleted`)
    setConfirmDeleteBin(null)
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
      {confirmDeleteBin && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm">
            <p className="font-semibold text-gray-900 mb-1">Delete bin {confirmDeleteBin.location_code}?</p>
            <p className="text-sm text-gray-500 mb-5">This bin is empty, so this is safe. This can't be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeleteBin(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={() => deleteBin(confirmDeleteBin)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-sm font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteZone && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm">
            <p className="font-semibold text-gray-900 mb-1">Delete {confirmDeleteZone.name}?</p>
            <p className="text-sm text-gray-500 mb-5">This overstock location is empty, so this is safe. This can't be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeleteZone(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={() => deleteZone(confirmDeleteZone)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-sm font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Locations</h1>
          <p className="text-sm text-gray-500 mt-0.5">{bins.length} bins · {zones.length} overstock locations</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowZoneForm(!showZoneForm); setShowBinForm(false) }} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium transition-colors">
            <Plus size={16} /> Overstock
          </button>
          <button onClick={() => { setShowBinForm(!showBinForm); setShowZoneForm(false) }} className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-3 py-2 rounded-xl text-sm font-medium transition-colors">
            <Plus size={16} /> Bin
          </button>
        </div>
      </div>

      {/* Overstock form */}
      {showZoneForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Overstock Location</h2>
            <button onClick={() => setShowZoneForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Name <span className="text-red-400">*</span></label>
              <input value={zoneForm.name} onChange={e => setZoneForm({ ...zoneForm, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="Overflow Rack" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Code <span className="text-red-400">*</span></label>
              <input value={zoneForm.code} onChange={e => setZoneForm({ ...zoneForm, code: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 uppercase" placeholder="A" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Description</label>
              <input value={zoneForm.description} onChange={e => setZoneForm({ ...zoneForm, description: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="Optional" />
            </div>
            <div className="col-span-3 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowZoneForm(false); setZoneForm(emptyZoneForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createZone} disabled={saving} className="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium">
                {saving ? 'Creating...' : 'Create Overstock Location'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bin form */}
      {showBinForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">New Bin Location</h2>
            <button onClick={() => setShowBinForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Rack <span className="text-red-400">*</span></label>
              <input value={binForm.rack} onChange={e => setBinForm({ ...binForm, rack: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="1" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Row <span className="text-red-400">*</span></label>
              <input value={binForm.row} onChange={e => setBinForm({ ...binForm, row: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" placeholder="2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Bin <span className="text-red-400">*</span></label>
              <input value={binForm.bin} onChange={e => setBinForm({ ...binForm, bin: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 uppercase" placeholder="B" />
            </div>
            <div className="col-span-3">
              <p className="text-xs text-gray-400">
                Location code: <span className="font-mono font-semibold text-gray-600">
                  {(binForm.rack.trim() || binForm.row.trim() || binForm.bin.trim())
                    ? `${binForm.rack.trim() || '?'}-${binForm.row.trim() || '?'}-${binForm.bin.trim() || '?'}`.toUpperCase()
                    : 'e.g. 1-2-B (Rack 1, Row 2, Bin B)'}
                </span>
              </p>
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Overstock Location (optional)</label>
              <select value={binForm.zone_id} onChange={e => setBinForm({ ...binForm, zone_id: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400">
                <option value="">None</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.code} — {z.name}</option>)}
              </select>
            </div>
            <div className="col-span-3 flex gap-3 justify-end pt-2">
              <button onClick={() => { setShowBinForm(false); setBinForm(emptyBinForm) }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={createBin} disabled={saving} className="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium">
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
          <button onClick={() => setView('zones')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'zones' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Overstock</button>
        </div>
        {view === 'bins' && (
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bins..." className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
          </div>
        )}
        {view === 'zones' && (
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={zoneSearch} onChange={e => setZoneSearch(e.target.value)} placeholder="Search overstock..." className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 p-6">Loading...</div>
      ) : view === 'bins' ? (
        filteredBins.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <MapPin size={36} className="text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">No bin locations</p>
            <p className="text-sm text-gray-400 mt-1">Create bin locations to track where products are stored.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-50">
              {filteredBins.map(bin => {
                const zone = zones.find(z => z.id === bin.zone_id)
                const itemCount = bin.inventory?.length || 0
                const isExpanded = !!expandedBins[bin.id]
                return (
                  <div key={bin.id} className={!bin.is_active ? 'opacity-50' : ''}>
                    <div className="flex items-center gap-4 px-6 py-4">
                      <div className="w-10 h-10 bg-cyan-50 rounded-lg flex items-center justify-center shrink-0">
                        <MapPin size={16} className="text-cyan-500" />
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
                      <div className="flex items-center gap-2 shrink-0">
                        {itemCount === 0 ? (
                          <button
                            onClick={() => setConfirmDeleteBin(bin)}
                            className="text-xs border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 rounded-lg px-2.5 py-1.5 transition-colors"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300" title="Deactivate instead — this bin still has inventory in it">Delete</span>
                        )}
                        <button
                          onClick={() => toggleBin(bin.id, bin.is_active)}
                          className={`text-xs border rounded-lg px-2.5 py-1.5 transition-colors ${bin.is_active ? 'text-gray-500 border-gray-200 hover:text-orange-600' : 'text-cyan-500 border-cyan-200 hover:bg-cyan-50'}`}
                        >
                          {bin.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        {itemCount > 0 && (
                          <button onClick={() => toggleExpand(bin.id)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        )}
                      </div>
                    </div>
                    {isExpanded && itemCount > 0 && (
                      <div className="px-6 pb-4 pl-20 space-y-1.5">
                        {bin.inventory.map((inv, i) => (
                          <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm text-gray-800 truncate">{inv.products?.name || 'Unknown product'}</p>
                              <p className="text-xs text-gray-400 font-mono">{inv.products?.sku || '—'}</p>
                            </div>
                            <span className="text-sm font-semibold text-gray-700 shrink-0">{inv.qty_on_hand}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      ) : (
        zones.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <Boxes size={36} className="text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">No overstock locations yet</p>
            <p className="text-sm text-gray-400 mt-1">Overstock holds extra stock that doesn't fit in its bin.</p>
          </div>
        ) : filteredZones.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <p className="text-sm text-gray-400">No overstock locations match your search.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredZones.map(zone => (
              <div key={zone.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">{zone.code}</div>
                  <div>
                    <p className="font-semibold text-gray-900">{zone.name}</p>
                    {zone.description && <p className="text-xs text-gray-400">{zone.description}</p>}
                  </div>
                  <span className="ml-auto text-xs text-gray-400">{zone.bins.length} bins</span>
                  {zone.bins.length === 0 ? (
                    <button
                      onClick={() => setConfirmDeleteZone(zone)}
                      className="text-xs border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      Delete
                    </button>
                  ) : (
                    <span className="text-xs text-gray-300" title="Move its bins out first">Delete</span>
                  )}
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
