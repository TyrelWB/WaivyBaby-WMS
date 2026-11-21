'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Loader2, Eye, EyeOff, ExternalLink, RefreshCw, Truck, UploadCloud, CreditCard, Boxes } from 'lucide-react'
import { toast } from 'sonner'

type IntegrationStatus = {
  configured: boolean
  fields: string[]
  last_synced_at: string | null
  is_enabled: boolean
} | null

type Status = { shipstation: IntegrationStatus; needsMigration?: boolean }

const CARRIERS = [
  { value: '', label: 'Not set' },
  { value: 'stamps_com', label: 'Stamps.com (USPS)' },
  { value: 'ups', label: 'UPS' },
  { value: 'fedex', label: 'FedEx' },
  { value: 'usps', label: 'USPS' },
  { value: 'dhl_express', label: 'DHL Express' },
  { value: 'canada_post', label: 'Canada Post' },
]

export default function IntegrationsPage() {
  const [status, setStatus] = useState<Status>({ shipstation: null })
  const [loading, setLoading] = useState(true)

  // ShipStation form
  const [ssForm, setSsForm] = useState({ api_key: '', api_secret: '', default_carrier: '', default_service: '' })
  const [ssShowKey, setSsShowKey] = useState(false)
  const [ssShowSecret, setSsShowSecret] = useState(false)
  const [ssSaving, setSsSaving] = useState(false)
  const [ssTesting, setSsTesting] = useState(false)
  const [ssTestResult, setSsTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  // Stripe
  const [stripeSyncing, setStripeSyncing] = useState(false)
  const [stripeSyncResult, setStripeSyncResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null)

  // Bundle stock utility
  const [recalculating, setRecalculating] = useState(false)
  const [recalcResults, setRecalcResults] = useState<{ name: string; qty: number; components: { name: string; needed: number; available: number; canMake: number }[] }[] | null>(null)

  async function loadStatus() {
    const res = await fetch('/api/integrations')
    const data = await res.json()
    setStatus(data)
    setLoading(false)
  }

  useEffect(() => { loadStatus() }, [])

  async function saveShipStation() {
    if (!ssForm.api_key && !ssForm.api_secret && !ssForm.default_carrier && !ssForm.default_service) {
      toast.error('Enter at least one field to save')
      return
    }
    setSsSaving(true)
    setSsTestResult(null)
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'shipstation', credentials: ssForm }),
    })
    if (res.ok) {
      toast.success('ShipStation credentials saved')
      setSsForm({ api_key: '', api_secret: '', default_carrier: '', default_service: '' })
      await loadStatus()
    } else {
      const d = await res.json()
      toast.error(d.error || 'Save failed')
    }
    setSsSaving(false)
  }

  async function testShipStation() {
    setSsTesting(true)
    setSsTestResult(null)
    const res = await fetch('/api/integrations/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'shipstation' }),
    })
    const d = await res.json()
    setSsTestResult(d)
    setSsTesting(false)
  }

  async function recalculateBundles() {
    setRecalculating(true)
    setRecalcResults(null)
    const res = await fetch('/api/admin/recalculate-bundles', { method: 'POST' })
    const d = await res.json()
    if (d.error) {
      toast.error(d.error)
    } else {
      setRecalcResults(d.results)
      toast.success(`Updated ${d.updated} bundle products`)
    }
    setRecalculating(false)
  }

  async function syncToStripe() {
    setStripeSyncing(true)
    setStripeSyncResult(null)
    const res = await fetch('/api/integrations/stripe/sync', { method: 'POST' })
    const d = await res.json()
    if (d.error) {
      toast.error(d.error)
    } else {
      setStripeSyncResult(d)
      toast.success(`Stripe: ${d.created} products created, ${d.updated} updated`)
    }
    setStripeSyncing(false)
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  if (status.needsMigration) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-bold text-gray-900 mb-2">Integrations</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <p className="font-semibold text-yellow-800 mb-2">Database setup required</p>
          <p className="text-sm text-yellow-700 mb-4">Run the migration in your Supabase SQL editor before using integrations.</p>
          <pre className="bg-yellow-100 rounded-lg p-4 text-xs text-yellow-900 overflow-x-auto whitespace-pre-wrap">
            {`-- Copy from: supabase/migrations/integrations.sql`}
          </pre>
          <a href="https://supabase.com/dashboard" target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-1.5 text-sm text-cyan-500 hover:underline font-medium">
            Open Supabase Dashboard <ExternalLink size={13} />
          </a>
        </div>
      </div>
    )
  }

  const ssConfigured = status.shipstation?.configured

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500 mt-0.5">Connect third-party services to sync orders and shipments</p>
      </div>

      {/* ShipStation */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#4A90D9] rounded-lg flex items-center justify-center">
              <Truck size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">ShipStation</p>
              <p className="text-xs text-gray-400">Create shipments and pull tracking numbers</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ssConfigured ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                <CheckCircle size={11} /> Connected
              </span>
            ) : (
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">Not configured</span>
            )}
            <a href="https://ship13.shipstation.com/settings/api" target="_blank" rel="noopener" className="text-xs text-cyan-500 hover:underline flex items-center gap-1">
              Get API keys <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                API Key {ssConfigured && !ssForm.api_key && <span className="text-green-600 font-normal">• Saved</span>}
              </label>
              <div className="relative">
                <input
                  type={ssShowKey ? 'text' : 'password'}
                  value={ssForm.api_key}
                  onChange={e => setSsForm(f => ({ ...f, api_key: e.target.value }))}
                  placeholder={ssConfigured ? 'Leave blank to keep current' : 'Enter API key'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  autoComplete="off"
                />
                <button onClick={() => setSsShowKey(v => !v)} className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
                  {ssShowKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                API Secret {ssConfigured && !ssForm.api_secret && <span className="text-green-600 font-normal">• Saved</span>}
              </label>
              <div className="relative">
                <input
                  type={ssShowSecret ? 'text' : 'password'}
                  value={ssForm.api_secret}
                  onChange={e => setSsForm(f => ({ ...f, api_secret: e.target.value }))}
                  placeholder={ssConfigured ? 'Leave blank to keep current' : 'Enter API secret'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  autoComplete="off"
                />
                <button onClick={() => setSsShowSecret(v => !v)} className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
                  {ssShowSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Default Carrier</label>
              <select
                value={ssForm.default_carrier}
                onChange={e => setSsForm(f => ({ ...f, default_carrier: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                {CARRIERS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              {ssConfigured && status.shipstation?.fields?.includes('default_carrier') && !ssForm.default_carrier && (
                <p className="text-xs text-green-600 mt-1">• Using saved carrier</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Default Service Code</label>
              <input
                value={ssForm.default_service}
                onChange={e => setSsForm(f => ({ ...f, default_service: e.target.value }))}
                placeholder={ssConfigured ? 'e.g. priority_mail' : 'e.g. ups_ground'}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
          </div>

          {ssTestResult && (
            <div className={`flex items-center gap-2 text-sm rounded-xl px-3 py-2 ${ssTestResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {ssTestResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {ssTestResult.ok ? 'Connected to ShipStation successfully' : ssTestResult.error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={saveShipStation}
              disabled={ssSaving}
              className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {ssSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              {ssSaving ? 'Saving...' : 'Save Credentials'}
            </button>
            <button
              onClick={testShipStation}
              disabled={ssTesting || !ssConfigured}
              className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {ssTesting ? <Loader2 size={14} className="animate-spin" /> : null}
              {ssTesting ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Once connected, use the <span className="font-medium text-gray-600">Push to ShipStation</span> button on any packed order to send it for label creation.
            </p>
          </div>
        </div>
      </div>

      {/* Stripe */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#635BFF] rounded-lg flex items-center justify-center">
              <CreditCard size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Stripe</p>
              <p className="text-xs text-gray-400">Sync WMS inventory to Stripe — auto-deducts when customers buy</p>
            </div>
          </div>
          <a href="https://dashboard.stripe.com" target="_blank" rel="noopener" className="text-xs text-cyan-500 hover:underline flex items-center gap-1">
            Stripe Dashboard <ExternalLink size={11} />
          </a>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl bg-purple-50 border border-purple-100 p-4 space-y-1">
            <p className="text-xs font-semibold text-purple-800">How it works</p>
            <p className="text-xs text-purple-700">1. Click <strong>Sync Products to Stripe</strong> — this creates your WMS products in Stripe with current stock levels.</p>
            <p className="text-xs text-purple-700">2. When a customer buys on Stripe, the webhook automatically deducts stock in WMS.</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={syncToStripe}
              disabled={stripeSyncing}
              className="flex items-center gap-2 bg-[#635BFF] hover:bg-[#4f46e5] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {stripeSyncing ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
              {stripeSyncing ? 'Syncing...' : 'Sync Products to Stripe'}
            </button>
          </div>

          {stripeSyncResult && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-1">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-600">{stripeSyncResult.created}</p>
                  <p className="text-xs text-gray-500">Created</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-600">{stripeSyncResult.updated}</p>
                  <p className="text-xs text-gray-500">Updated</p>
                </div>
              </div>
              {stripeSyncResult.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {stripeSyncResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-500">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-gray-100 space-y-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Webhook URL</p>
            <p className="text-xs text-gray-500">This is already set up in your Stripe webhook destination.</p>
            <code className="block bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700">
              https://waivy-baby-wms.vercel.app/api/webhooks/stripe
            </code>
          </div>
        </div>
      </div>

      {/* Bundle stock utility */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
              <Boxes size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Bundle Stock</p>
              <p className="text-xs text-gray-400">Recalculate bundle quantities from component inventory</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <button
            onClick={recalculateBundles}
            disabled={recalculating}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            {recalculating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {recalculating ? 'Recalculating...' : 'Recalculate Bundle Stock'}
          </button>

          {recalcResults && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-600">Bundle Stock Results</p>
              {recalcResults.map((r, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{r.name}</span>
                    <span className={`text-sm font-bold ${r.qty > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{r.qty} in stock</span>
                  </div>
                  {r.qty === 0 && r.components.length > 0 && (
                    <div className="pl-3 space-y-0.5">
                      {r.components.filter(c => c.canMake === 0).map((c, j) => (
                        <p key={j} className="text-xs text-red-500">
                          ✗ {c.name} — needs {c.needed}, has {c.available}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
