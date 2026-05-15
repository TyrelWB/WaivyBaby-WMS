'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Loader2, Eye, EyeOff, ExternalLink, RefreshCw, Truck, ShoppingCart, Package, UploadCloud, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'

type IntegrationStatus = {
  configured: boolean
  fields: string[]
  last_synced_at: string | null
  is_enabled: boolean
} | null

type Status = { wix: IntegrationStatus; shipstation: IntegrationStatus; needsMigration?: boolean }

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
  const [status, setStatus] = useState<Status>({ wix: null, shipstation: null })
  const [loading, setLoading] = useState(true)

  // ShipStation form
  const [ssForm, setSsForm] = useState({ api_key: '', api_secret: '', default_carrier: '', default_service: '' })
  const [ssShowKey, setSsShowKey] = useState(false)
  const [ssShowSecret, setSsShowSecret] = useState(false)
  const [ssSaving, setSsSaving] = useState(false)
  const [ssTesting, setSsTesting] = useState(false)
  const [ssTestResult, setSsTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  // Wix form
  const [wixForm, setWixForm] = useState({ api_key: '', site_id: '', webhook_secret: '' })
  const [wixShowKey, setWixShowKey] = useState(false)
  const [wixSaving, setWixSaving] = useState(false)
  const [wixTesting, setWixTesting] = useState(false)
  const [wixTestResult, setWixTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [wixSyncing, setWixSyncing] = useState(false)
  const [wixMapping, setWixMapping] = useState(false)
  const [wixSyncingInv, setWixSyncingInv] = useState(false)
  const [wixSyncingOrders, setWixSyncingOrders] = useState(false)
  const [webhookCopied, setWebhookCopied] = useState(false)

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

  async function saveWix() {
    if (!wixForm.api_key && !wixForm.site_id && !wixForm.webhook_secret) {
      toast.error('Enter at least one field to save')
      return
    }
    setWixSaving(true)
    setWixTestResult(null)
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'wix', credentials: wixForm }),
    })
    if (res.ok) {
      toast.success('Wix credentials saved')
      setWixForm({ api_key: '', site_id: '', webhook_secret: '' })
      await loadStatus()
    } else {
      const d = await res.json()
      toast.error(d.error || 'Save failed')
    }
    setWixSaving(false)
  }

  async function mapProducts() {
    setWixMapping(true)
    const res = await fetch('/api/integrations/wix/map-products', { method: 'POST' })
    const d = await res.json()
    if (d.error) {
      toast.error(d.error)
    } else {
      toast.success(`Mapped ${d.mapped} products (${d.skipped} skipped, ${d.total} in Wix)`)
    }
    setWixMapping(false)
  }

  async function syncInventory() {
    setWixSyncingInv(true)
    const res = await fetch('/api/integrations/wix/sync-inventory', { method: 'POST' })
    const d = await res.json()
    if (d.error) {
      toast.error(d.error)
    } else if (d.failed && d.errors?.length) {
      toast.error(`${d.errors[0]}`)
    } else {
      toast.success(`Synced ${d.synced} products to Wix${d.failed ? ` (${d.failed} failed)` : ''}`)
    }
    setWixSyncingInv(false)
  }

  async function syncOrders() {
    setWixSyncingOrders(true)
    const res = await fetch('/api/integrations/wix/sync', { method: 'POST' })
    const d = await res.json()
    if (d.error) {
      toast.error(d.error)
    } else {
      toast.success(`Imported ${d.imported} new order${d.imported !== 1 ? 's' : ''} from Wix`)
    }
    setWixSyncingOrders(false)
  }

  function copyWebhookUrl() {
    const secret = wixForm.webhook_secret || '(save-secret-first)'
    const url = `${window.location.origin}/api/webhooks/wix?secret=${secret}`
    navigator.clipboard.writeText(url).then(() => {
      setWebhookCopied(true)
      setTimeout(() => setWebhookCopied(false), 2000)
    })
  }

  async function testWix() {
    setWixTesting(true)
    setWixTestResult(null)
    const res = await fetch('/api/integrations/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'wix' }),
    })
    const d = await res.json()
    setWixTestResult(d)
    setWixTesting(false)
  }

  async function syncWix() {
    setWixSyncing(true)
    const res = await fetch('/api/integrations/wix/sync', { method: 'POST' })
    const d = await res.json()
    if (d.error) {
      toast.error(d.error)
    } else {
      toast.success(`Synced: ${d.imported} imported, ${d.skipped} skipped`)
      await loadStatus()
    }
    setWixSyncing(false)
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  if (status.needsMigration) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Integrations</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <p className="font-semibold text-yellow-800 mb-2">Database setup required</p>
          <p className="text-sm text-yellow-700 mb-4">Run the migration in your Supabase SQL editor before using integrations.</p>
          <pre className="bg-yellow-100 rounded-lg p-4 text-xs text-yellow-900 overflow-x-auto whitespace-pre-wrap">
            {`-- Copy from: supabase/migrations/integrations.sql`}
          </pre>
          <a href="https://supabase.com/dashboard" target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium">
            Open Supabase Dashboard <ExternalLink size={13} />
          </a>
        </div>
      </div>
    )
  }

  const ssConfigured = status.shipstation?.configured
  const wixConfigured = status.wix?.configured

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500 mt-0.5">Connect third-party services to sync orders and shipments</p>
      </div>

      {/* ShipStation */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
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
            <a href="https://ship13.shipstation.com/settings/api" target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {ssTestResult && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${ssTestResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {ssTestResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {ssTestResult.ok ? 'Connected to ShipStation successfully' : ssTestResult.error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={saveShipStation}
              disabled={ssSaving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {ssSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              {ssSaving ? 'Saving...' : 'Save Credentials'}
            </button>
            <button
              onClick={testShipStation}
              disabled={ssTesting || !ssConfigured}
              className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
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

      {/* Wix */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center">
              <ShoppingCart size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Wix eCommerce</p>
              <p className="text-xs text-gray-400">Import paid orders automatically from your Wix store</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {wixConfigured ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                <CheckCircle size={11} /> Connected
              </span>
            ) : (
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">Not configured</span>
            )}
            <a href="https://manage.wix.com/account/api-keys" target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              Get API keys <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                API Key {wixConfigured && !wixForm.api_key && <span className="text-green-600 font-normal">• Saved</span>}
              </label>
              <div className="relative">
                <input
                  type={wixShowKey ? 'text' : 'password'}
                  value={wixForm.api_key}
                  onChange={e => setWixForm(f => ({ ...f, api_key: e.target.value }))}
                  placeholder={wixConfigured ? 'Leave blank to keep current' : 'Enter API key'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="off"
                />
                <button onClick={() => setWixShowKey(v => !v)} className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
                  {wixShowKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Site ID {wixConfigured && !wixForm.site_id && <span className="text-green-600 font-normal">• Saved</span>}
              </label>
              <input
                value={wixForm.site_id}
                onChange={e => setWixForm(f => ({ ...f, site_id: e.target.value }))}
                placeholder={wixConfigured ? 'Leave blank to keep current' : 'e.g. a1b2c3d4-...'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Webhook Secret {wixConfigured && !wixForm.webhook_secret && <span className="text-green-600 font-normal">• Saved</span>}
            </label>
            <input
              value={wixForm.webhook_secret}
              onChange={e => setWixForm(f => ({ ...f, webhook_secret: e.target.value }))}
              placeholder={wixConfigured ? 'Leave blank to keep current' : 'Create a secret password for webhook security'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="off"
            />
            <p className="text-xs text-gray-400 mt-1">Used to authenticate incoming webhooks from Wix. Choose any string.</p>
          </div>

          {wixTestResult && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${wixTestResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {wixTestResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {wixTestResult.ok ? 'Connected to Wix successfully' : wixTestResult.error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={saveWix}
              disabled={wixSaving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {wixSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              {wixSaving ? 'Saving...' : 'Save Credentials'}
            </button>
            <button
              onClick={testWix}
              disabled={wixTesting || !wixConfigured}
              className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {wixTesting ? <Loader2 size={14} className="animate-spin" /> : null}
              {wixTesting ? 'Testing...' : 'Test Connection'}
            </button>
            {wixConfigured && (
              <button
                onClick={syncWix}
                disabled={wixSyncing}
                className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors ml-auto"
              >
                <RefreshCw size={14} className={wixSyncing ? 'animate-spin' : ''} />
                {wixSyncing ? 'Syncing...' : 'Sync Orders Now'}
              </button>
            )}
          </div>

          {status.wix?.last_synced_at && (
            <p className="text-xs text-gray-400">
              Last synced: {new Date(status.wix.last_synced_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
          )}

          {wixConfigured && (
            <>
              <div className="pt-2 border-t border-gray-100 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Inventory Management</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={mapProducts}
                    disabled={wixMapping}
                    className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {wixMapping ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
                    {wixMapping ? 'Mapping...' : 'Map Products'}
                  </button>
                  <button
                    onClick={syncInventory}
                    disabled={wixSyncingInv}
                    className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {wixSyncingInv ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                    {wixSyncingInv ? 'Syncing...' : 'Push Inventory to Wix'}
                  </button>
                  <button
                    onClick={syncOrders}
                    disabled={wixSyncingOrders}
                    className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {wixSyncingOrders ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
                    {wixSyncingOrders ? 'Importing...' : 'Sync Orders from Wix'}
                  </button>
                </div>
                <p className="text-xs text-gray-400">Run <span className="font-medium text-gray-600">Map Products</span> first to link WMS SKUs to Wix products. Then use <span className="font-medium text-gray-600">Push Inventory</span> to set Wix stock levels from WMS.</p>
              </div>

              <div className="pt-2 border-t border-gray-100 space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Webhook URL</p>
                <p className="text-xs text-gray-500">Register this URL in your <a href="https://dev.wix.com/dc3/my-apps" target="_blank" rel="noopener" className="text-blue-600 hover:underline">Wix Developer Center</a> to receive new orders automatically.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 truncate">
                    {typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/webhooks/wix?secret={(wixForm.webhook_secret || '(your-secret)')}
                  </code>
                  <button
                    onClick={copyWebhookUrl}
                    className="flex-shrink-0 flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    {webhookCopied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                    {webhookCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
