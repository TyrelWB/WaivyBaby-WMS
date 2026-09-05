'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAdminContext } from '../admin-context'
import {
  Warehouse, Users, Link2, CheckCircle, ChevronRight,
  Plus, X, Zap
} from 'lucide-react'

type Worker = {
  name: string
  role: string
  pin: string
}

type IntegrationStatus = {
  wix: boolean
  shipstation: boolean
}

const TOTAL_STEPS = 4

export default function OnboardingPage() {
  const supabase = createClient()
  const router = useRouter()
  const { orgId, warehouseId } = useAdminContext()

  const [step, setStep] = useState(1)
  const [orgName, setOrgName] = useState('')
  const [warehouseName, setWarehouseName] = useState('')
  const [warehouseLoading, setWarehouseLoading] = useState(false)

  const [workerName, setWorkerName] = useState('')
  const [workerRole, setWorkerRole] = useState('all')
  const [workerPin, setWorkerPin] = useState('')
  const [workers, setWorkers] = useState<Worker[]>([])
  const [workerError, setWorkerError] = useState('')

  const [wixApiKey, setWixApiKey] = useState('')
  const [wixSiteId, setWixSiteId] = useState('')
  const [ssApiKey, setSsApiKey] = useState('')
  const [ssApiSecret, setSsApiSecret] = useState('')
  const [integrations, setIntegrations] = useState<IntegrationStatus>({ wix: false, shipstation: false })
  const [wixLoading, setWixLoading] = useState(false)
  const [ssLoading, setSsLoading] = useState(false)
  const [wixError, setWixError] = useState('')
  const [ssError, setSsError] = useState('')

  useEffect(() => {
    async function loadInitial() {
      if (!orgId) return
      const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).single()
      if (org) setOrgName(org.name)
      const { data: wh } = await supabase.from('warehouses').select('name').eq('org_id', orgId).single()
      if (wh) setWarehouseName(wh.name)
    }
    loadInitial()
  }, [orgId])

  async function handleWarehouseContinue() {
    if (!warehouseName.trim() || !orgId) { setStep(2); return }
    setWarehouseLoading(true)
    await supabase.from('warehouses').update({ name: warehouseName.trim() }).eq('org_id', orgId)
    setWarehouseLoading(false)
    setStep(2)
  }

  async function handleAddWorker() {
    setWorkerError('')
    if (!workerName.trim()) { setWorkerError('Name is required.'); return }
    if (!/^\d{4}$/.test(workerPin)) { setWorkerError('PIN must be exactly 4 digits.'); return }

    const { error } = await supabase.from('workers').insert({
      org_id: orgId,
      warehouse_id: warehouseId || null,
      name: workerName.trim(),
      role: workerRole,
      pin: workerPin,
      is_active: true,
    })

    if (error) { setWorkerError(error.message); return }

    setWorkers(prev => [...prev, { name: workerName.trim(), role: workerRole, pin: workerPin }])
    setWorkerName('')
    setWorkerRole('picker')
    setWorkerPin('')
  }

  async function handleRemoveWorker(index: number) {
    const w = workers[index]
    await supabase.from('workers').delete().eq('org_id', orgId).eq('name', w.name).eq('pin', w.pin)
    setWorkers(prev => prev.filter((_, i) => i !== index))
  }

  async function handleConnectWix() {
    setWixError('')
    if (!wixApiKey.trim() || !wixSiteId.trim()) { setWixError('Both fields are required.'); return }
    setWixLoading(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'wix', credentials: { api_key: wixApiKey.trim(), site_id: wixSiteId.trim() } }),
      })
      if (!res.ok) { const d = await res.json(); setWixError(d?.error || 'Connection failed.') }
      else setIntegrations(prev => ({ ...prev, wix: true }))
    } catch {
      setWixError('Connection failed.')
    }
    setWixLoading(false)
  }

  async function handleConnectShipStation() {
    setSsError('')
    if (!ssApiKey.trim() || !ssApiSecret.trim()) { setSsError('Both fields are required.'); return }
    setSsLoading(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'shipstation', credentials: { api_key: ssApiKey.trim(), api_secret: ssApiSecret.trim() } }),
      })
      if (!res.ok) { const d = await res.json(); setSsError(d?.error || 'Connection failed.') }
      else setIntegrations(prev => ({ ...prev, shipstation: true }))
    } catch {
      setSsError('Connection failed.')
    }
    setSsLoading(false)
  }

  const connectedCount = [integrations.wix, integrations.shipstation].filter(Boolean).length

  const stepMeta = [
    { label: 'Welcome', icon: Warehouse },
    { label: 'Workers', icon: Users },
    { label: 'Integrations', icon: Link2 },
    { label: 'Done', icon: CheckCircle },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-2xl">

        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {stepMeta.map((s, i) => {
              const num = i + 1
              const active = num === step
              const done = num < step
              const Icon = s.icon
              return (
                <div key={s.label} className="flex flex-col items-center gap-1.5 flex-1">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors
                    ${done ? 'bg-green-500' : active ? 'bg-blue-600' : 'bg-gray-200'}`}>
                    {done
                      ? <CheckCircle size={18} className="text-white" />
                      : <Icon size={18} className={active ? 'text-white' : 'text-gray-400'} />
                    }
                  </div>
                  <span className={`text-xs font-medium ${active ? 'text-blue-600' : done ? 'text-green-600' : 'text-gray-400'}`}>
                    {s.label}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${((step - 1) / (TOTAL_STEPS - 1)) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-2 text-right">Step {step} of {TOTAL_STEPS}</p>
        </div>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center">
                <Warehouse size={22} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Let's set up your warehouse</h1>
                <p className="text-sm text-gray-400">A few quick steps to get you started.</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Organization</label>
                <input
                  type="text"
                  value={orgName}
                  readOnly
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 text-sm cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Warehouse Name</label>
                <input
                  type="text"
                  value={warehouseName}
                  onChange={e => setWarehouseName(e.target.value)}
                  placeholder="e.g. Main Warehouse"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <button
              onClick={handleWarehouseContinue}
              disabled={warehouseLoading}
              className="mt-8 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {warehouseLoading ? 'Saving...' : 'Continue'}
              {!warehouseLoading && <ChevronRight size={18} />}
            </button>
          </div>
        )}

        {/* Step 2: Add Workers */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Users size={22} className="text-indigo-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Who's working in your warehouse?</h1>
                <p className="text-sm text-gray-400">Add workers so they can log in with their PIN.</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                  <input
                    type="text"
                    value={workerName}
                    onChange={e => setWorkerName(e.target.value)}
                    placeholder="Worker name"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">PIN (4 digits)</label>
                  <input
                    type="number"
                    value={workerPin}
                    onChange={e => setWorkerPin(e.target.value.slice(0, 4))}
                    placeholder="1234"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select
                  value={workerRole}
                  onChange={e => setWorkerRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="all">Inventory Specialist</option>
                  <option value="picker">Picker</option>
                  <option value="packer">Packer</option>
                  <option value="shipper">Shipper</option>
                </select>
              </div>
              {workerError && <p className="text-xs text-red-600">{workerError}</p>}
              <button
                onClick={handleAddWorker}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus size={15} />
                Add Worker
              </button>
            </div>

            {workers.length > 0 && (
              <div className="mb-5 space-y-2">
                {workers.map((w, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{w.name}</p>
                      <p className="text-xs text-gray-400">Inventory Specialist · PIN: ••••</p>
                    </div>
                    <button onClick={() => handleRemoveWorker(i)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(3)}
                className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium py-3 rounded-xl text-sm transition-colors"
              >
                Skip
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                Continue
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Integrations */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 bg-purple-100 rounded-xl flex items-center justify-center">
                <Zap size={22} className="text-purple-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Connect your tools</h1>
                <p className="text-sm text-gray-400">All integrations are optional — you can add them later.</p>
              </div>
            </div>

            <div className="space-y-5">
              {/* Wix */}
              <div className="border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Link2 size={16} className="text-gray-500" />
                    <span className="font-semibold text-gray-900 text-sm">Wix</span>
                  </div>
                  {integrations.wix && (
                    <div className="flex items-center gap-1.5 text-green-600">
                      <CheckCircle size={16} />
                      <span className="text-xs font-medium">Connected</span>
                    </div>
                  )}
                </div>
                {!integrations.wix && (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={wixApiKey}
                      onChange={e => setWixApiKey(e.target.value)}
                      placeholder="API Key"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={wixSiteId}
                      onChange={e => setWixSiteId(e.target.value)}
                      placeholder="Site ID"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {wixError && <p className="text-xs text-red-600">{wixError}</p>}
                    <button
                      onClick={handleConnectWix}
                      disabled={wixLoading}
                      className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                    >
                      {wixLoading ? 'Connecting...' : 'Connect Wix'}
                    </button>
                  </div>
                )}
              </div>

              {/* ShipStation */}
              <div className="border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Link2 size={16} className="text-gray-500" />
                    <span className="font-semibold text-gray-900 text-sm">ShipStation</span>
                  </div>
                  {integrations.shipstation && (
                    <div className="flex items-center gap-1.5 text-green-600">
                      <CheckCircle size={16} />
                      <span className="text-xs font-medium">Connected</span>
                    </div>
                  )}
                </div>
                {!integrations.shipstation && (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={ssApiKey}
                      onChange={e => setSsApiKey(e.target.value)}
                      placeholder="API Key"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="password"
                      value={ssApiSecret}
                      onChange={e => setSsApiSecret(e.target.value)}
                      placeholder="API Secret"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {ssError && <p className="text-xs text-red-600">{ssError}</p>}
                    <button
                      onClick={handleConnectShipStation}
                      disabled={ssLoading}
                      className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                    >
                      {ssLoading ? 'Connecting...' : 'Connect ShipStation'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setStep(4)}
                className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium py-3 rounded-xl text-sm transition-colors"
              >
                Skip
              </button>
              <button
                onClick={() => setStep(4)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                Continue
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 4 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={32} className="text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">You're all set!</h1>
            <p className="text-sm text-gray-400 mb-8">Your warehouse is configured and ready to go.</p>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-3xl font-bold text-gray-900">{workers.length}</p>
                <p className="text-sm text-gray-400 mt-1">Worker{workers.length !== 1 ? 's' : ''} added</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-3xl font-bold text-gray-900">{connectedCount}</p>
                <p className="text-sm text-gray-400 mt-1">Integration{connectedCount !== 1 ? 's' : ''} connected</p>
              </div>
            </div>

            {(workers.length > 0 || connectedCount > 0) && (
              <div className="text-left bg-gray-50 rounded-xl p-4 mb-8 space-y-2">
                {workers.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <CheckCircle size={14} className="text-green-500 shrink-0" />
                    {workers.length} worker{workers.length !== 1 ? 's' : ''}: {workers.map(w => w.name).join(', ')}
                  </div>
                )}
                {integrations.wix && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <CheckCircle size={14} className="text-green-500 shrink-0" />
                    Wix connected
                  </div>
                )}
                {integrations.shipstation && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <CheckCircle size={14} className="text-green-500 shrink-0" />
                    ShipStation connected
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => router.push('/dashboard')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors text-base"
            >
              Go to Dashboard
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
