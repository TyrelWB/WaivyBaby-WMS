'use client'

import { useEffect, useState } from 'react'
import { Plus, Loader2, AlertTriangle, CheckCircle, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'

type Incident = {
  id: string
  title: string
  description: string
  severity: 'low' | 'medium' | 'high'
  category: string
  location: string | null
  reported_by: string | null
  status: 'open' | 'investigating' | 'resolved'
  resolution_notes: string | null
  resolved_at: string | null
  created_at: string
}

const SEVERITY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
}

const STATUS_COLORS = {
  open: 'bg-red-100 text-red-700',
  investigating: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
}

const CATEGORIES = ['injury', 'damage', 'theft', 'spill', 'equipment', 'safety', 'other']

export default function IncidentLogPage() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'open' | 'investigating' | 'resolved'>('all')
  const [resolutionNote, setResolutionNote] = useState('')

  const [form, setForm] = useState({
    title: '',
    description: '',
    severity: 'low',
    category: 'other',
    location: '',
    reported_by: '',
  })

  async function load() {
    const res = await fetch('/api/incident-logs')
    const data = await res.json()
    if (!data.error) setIncidents(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const res = await fetch('/api/incident-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success('Incident reported')
      setForm({ title: '', description: '', severity: 'low', category: 'other', location: '', reported_by: '' })
      setShowForm(false)
      await load()
    }
    setSubmitting(false)
  }

  async function updateStatus(id: string, status: string) {
    setUpdating(id)
    const res = await fetch(`/api/incident-logs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, resolution_notes: status === 'resolved' ? resolutionNote : undefined }),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success(`Incident marked as ${status}`)
      setResolutionNote('')
      await load()
    }
    setUpdating(null)
  }

  const filtered = filter === 'all' ? incidents : incidents.filter(i => i.status === filter)
  const openCount = incidents.filter(i => i.status === 'open').length
  const investigatingCount = incidents.filter(i => i.status === 'investigating').length

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Incident Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">Report and track warehouse incidents</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Report Incident
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{openCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Open</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{investigatingCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Investigating</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-700">{incidents.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total</p>
        </div>
      </div>

      {/* Report Form */}
      {showForm && (
        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <p className="font-semibold text-gray-800">Report an Incident</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Title *</label>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Brief description of what happened"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Full Description *</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe what happened in detail..."
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 resize-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Category</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Severity</label>
              <select
                value={form.severity}
                onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Location</label>
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Packing station 2, Aisle B"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reported By</label>
              <input
                value={form.reported_by}
                onChange={e => setForm(f => ({ ...f, reported_by: e.target.value }))}
                placeholder="Your name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'open', 'investigating', 'resolved'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Incidents List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <CheckCircle size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No incidents found</p>
          </div>
        )}
        {filtered.map(incident => (
          <div key={incident.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${incident.severity === 'high' && incident.status !== 'resolved' ? 'border-red-200' : 'border-gray-100'}`}>
            <div
              className="p-4 cursor-pointer"
              onClick={() => setExpanded(expanded === incident.id ? null : incident.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900">{incident.title}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[incident.status]}`}>
                      {incident.status.charAt(0).toUpperCase() + incident.status.slice(1)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[incident.severity]}`}>
                      {incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                      {incident.category.charAt(0).toUpperCase() + incident.category.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    {incident.location && <span>{incident.location}</span>}
                    {incident.reported_by && <span>By {incident.reported_by}</span>}
                    <span>{new Date(incident.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                </div>
                {expanded === incident.id ? <ChevronUp size={16} className="text-gray-400 shrink-0 mt-1" /> : <ChevronDown size={16} className="text-gray-400 shrink-0 mt-1" />}
              </div>
            </div>

            {expanded === incident.id && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-700">{incident.description}</p>
                {incident.resolution_notes && (
                  <div className="bg-green-50 rounded-xl p-3">
                    <p className="text-xs font-semibold text-green-700 mb-1">Resolution Notes</p>
                    <p className="text-sm text-green-800">{incident.resolution_notes}</p>
                  </div>
                )}
                {incident.status !== 'resolved' && (
                  <div className="space-y-3">
                    {incident.status === 'open' && (
                      <button
                        onClick={() => updateStatus(incident.id, 'investigating')}
                        disabled={updating === incident.id}
                        className="flex items-center gap-2 border border-yellow-200 text-yellow-700 hover:bg-yellow-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                      >
                        {updating === incident.id ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                        Mark Investigating
                      </button>
                    )}
                    <div className="space-y-2">
                      <textarea
                        value={resolutionNote}
                        onChange={e => setResolutionNote(e.target.value)}
                        placeholder="Resolution notes (optional)..."
                        rows={2}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 resize-none"
                      />
                      <button
                        onClick={() => updateStatus(incident.id, 'resolved')}
                        disabled={updating === incident.id}
                        className="flex items-center gap-2 border border-green-200 text-green-700 hover:bg-green-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                      >
                        {updating === incident.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                        Mark Resolved
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
