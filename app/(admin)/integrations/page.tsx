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

type Status = { shippo: IntegrationStatus; needsMigration?: boolean }

export default function IntegrationsPage() {
  const [status, setStatus] = useState<Status>({ shippo: null })
  const [loading, setLoading] = useState(true)

  // Shippo form
  const [shippoForm, setShippoForm] = useState({
    api_key: '',
    ship_from_name: '', ship_from_street1: '', ship_from_street2: '',
    ship_from_city: '', ship_from_state: '', ship_from_zip: '', ship_from_country: 'US',
    ship_from_phone: '', ship_from_email: '',
  })
  const [shippoShowKey, setShippoShowKey] = useState(false)
  const [shippoSaving, setShippoSaving] = useState(false)
  const [shippoTesting, setShippoTesting] = useState(false)
  const [shippoTestResult, setShippoTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

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

  async function saveShippo() {
    if (!Object.values(shippoForm).some(v => v.trim())) {
      toast.error('Enter at least one field to save')
      return
    }
    setShippoSaving(true)
    setShippoTestResult(null)
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'shippo', credentials: shippoForm }),
    })
    if (res.ok) {
      toast.success('Shippo credentials saved')
      setShippoForm({
        api_key: '',
        ship_from_name: '', ship_from_street1: '', ship_from_street2: '',
        ship_from_city: '', ship_from_state: '', ship_from_zip: '', ship_from_country: 'US',
        ship_from_phone: '', ship_from_email: '',
      })
      await loadStatus()
    } else {
      const d = await res.json()
      toast.error(d.error || 'Save failed')
    }
    setShippoSaving(false)
  }

  async function testShippo() {
    setShippoTesting(true)
    setShippoTestResult(null)
    const res = await fetch('/api/integrations/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'shippo' }),
    })
    const d = await res.json()
    setShippoTestResult(d)
    setShippoTesting(false)
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

  const shippoConfigured = status.shippo?.configured

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500 mt-0.5">Connect third-party services to sync orders and shipments</p>
      </div>

      {/* Shippo */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5A31F4] rounded-lg flex items-center justify-center">
              <Truck size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Shippo</p>
              <p className="text-xs text-gray-400">Get rates, create shipping labels, and track packages</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {shippoConfigured ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                <CheckCircle size={11} /> Connected
              </span>
            ) : (
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">Not configured</span>
            )}
            <a href="https://apps.goshippo.com/settings/api" target="_blank" rel="noopener" className="text-xs text-cyan-500 hover:underline flex items-center gap-1">
              Get API key <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              API Token {shippoConfigured && !shippoForm.api_key && <span className="text-green-600 font-normal">• Saved</span>}
            </label>
            <div className="relative">
              <input
                type={shippoShowKey ? 'text' : 'password'}
                value={shippoForm.api_key}
                onChange={e => setShippoForm(f => ({ ...f, api_key: e.target.value }))}
                placeholder={shippoConfigured ? 'Leave blank to keep current' : 'shippo_live_...'}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                autoComplete="off"
              />
              <button onClick={() => setShippoShowKey(v => !v)} className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
                {shippoShowKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Ship-From Address</p>
            <div className="grid grid-cols-2 gap-3">
              <input value={shippoForm.ship_from_name} onChange={e => setShippoForm(f => ({ ...f, ship_from_name: e.target.value }))} placeholder="Warehouse name" className="col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              <input value={shippoForm.ship_from_street1} onChange={e => setShippoForm(f => ({ ...f, ship_from_street1: e.target.value }))} placeholder="Street address" className="col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              <input value={shippoForm.ship_from_street2} onChange={e => setShippoForm(f => ({ ...f, ship_from_street2: e.target.value }))} placeholder="Suite / Unit (optional)" className="col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              <input value={shippoForm.ship_from_city} onChange={e => setShippoForm(f => ({ ...f, ship_from_city: e.target.value }))} placeholder="City" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              <input value={shippoForm.ship_from_state} onChange={e => setShippoForm(f => ({ ...f, ship_from_state: e.target.value }))} placeholder="State" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              <input value={shippoForm.ship_from_zip} onChange={e => setShippoForm(f => ({ ...f, ship_from_zip: e.target.value }))} placeholder="ZIP" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
              <input value={shippoForm.ship_from_phone} onChange={e => setShippoForm(f => ({ ...f, ship_from_phone: e.target.value }))} placeholder="Phone" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400" />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">This is the return address printed on every label — set it once.</p>
          </div>

          {shippoTestResult && (
            <div className={`flex items-center gap-2 text-sm rounded-xl px-3 py-2 ${shippoTestResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {shippoTestResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {shippoTestResult.ok ? 'Connected to Shippo successfully' : shippoTestResult.error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={saveShippo}
              disabled={shippoSaving}
              className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {shippoSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              {shippoSaving ? 'Saving...' : 'Save Credentials'}
            </button>
            <button
              onClick={testShippo}
              disabled={shippoTesting || !shippoConfigured}
              className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {shippoTesting ? <Loader2 size={14} className="animate-spin" /> : null}
              {shippoTesting ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Once connected, use <span className="font-medium text-gray-600">Get Rates</span> on any packed order to compare carrier prices and create a label.
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
