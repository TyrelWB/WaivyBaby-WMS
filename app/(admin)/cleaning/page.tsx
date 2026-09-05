'use client'

import { useEffect, useState } from 'react'
import { Plus, Loader2, CheckCircle, Circle, Trash2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

type CleaningTask = {
  id: string
  title: string
  description: string | null
  frequency: 'daily' | 'weekly' | 'monthly'
  area: string | null
  is_done: boolean
  last_completion: { completed_by: string | null; completed_at: string } | null
}

const FREQ_COLORS = {
  daily: 'bg-blue-100 text-blue-700',
  weekly: 'bg-purple-100 text-purple-700',
  monthly: 'bg-orange-100 text-orange-700',
}

const DEFAULT_TASKS = [
  { title: 'Wipe down packing stations', frequency: 'daily', area: 'Packing' },
  { title: 'Sweep warehouse floor', frequency: 'daily', area: 'Warehouse' },
  { title: 'Empty trash bins', frequency: 'daily', area: 'All Areas' },
  { title: 'Clean restrooms', frequency: 'daily', area: 'Restrooms' },
  { title: 'Sanitize shared equipment', frequency: 'daily', area: 'All Areas' },
  { title: 'Organize supply storage area', frequency: 'weekly', area: 'Storage' },
  { title: 'Deep clean packing stations', frequency: 'weekly', area: 'Packing' },
  { title: 'Inspect and clean shelving', frequency: 'weekly', area: 'Warehouse' },
  { title: 'Clean break room appliances', frequency: 'weekly', area: 'Break Room' },
  { title: 'Deep clean warehouse floor', frequency: 'monthly', area: 'Warehouse' },
  { title: 'Inspect fire extinguishers', frequency: 'monthly', area: 'Safety' },
  { title: 'Clean lighting fixtures', frequency: 'monthly', area: 'Warehouse' },
]

export default function CleaningPage() {
  const [tasks, setTasks] = useState<CleaningTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [completing, setCompleting] = useState<string | null>(null)
  const [completedBy, setCompletedBy] = useState('')
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [seeding, setSeeding] = useState(false)

  const [form, setForm] = useState({
    title: '',
    description: '',
    frequency: 'daily',
    area: '',
  })

  async function load() {
    const res = await fetch('/api/cleaning-tasks')
    const data = await res.json()
    if (!data.error) setTasks(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function completeTask(taskId: string) {
    setCompleting(taskId)
    const res = await fetch('/api/cleaning-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', task_id: taskId, completed_by: completedBy }),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success('Task marked complete')
      await load()
    }
    setCompleting(null)
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const res = await fetch('/api/cleaning-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) {
      toast.error(data.error)
    } else {
      toast.success('Task added')
      setForm({ title: '', description: '', frequency: 'daily', area: '' })
      setShowForm(false)
      await load()
    }
    setSubmitting(false)
  }

  async function deleteTask(id: string) {
    const res = await fetch(`/api/cleaning-tasks/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Task removed')
      await load()
    }
  }

  async function seedDefaultTasks() {
    setSeeding(true)
    for (const task of DEFAULT_TASKS) {
      await fetch('/api/cleaning-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      })
    }
    await load()
    toast.success('Default cleaning tasks added')
    setSeeding(false)
  }

  const filtered = tasks.filter(t => t.frequency === activeTab)
  const doneCount = filtered.filter(t => t.is_done).length
  const totalCount = filtered.length

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading...</div>

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Cleaning Checklist</h1>
          <p className="text-sm text-gray-500 mt-0.5">Daily, weekly, and monthly cleaning tasks</p>
        </div>
        <div className="flex items-center gap-2">
          {tasks.length === 0 && (
            <button
              onClick={seedDefaultTasks}
              disabled={seeding}
              className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {seeding ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {seeding ? 'Adding...' : 'Load Defaults'}
            </button>
          )}
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Add Task
          </button>
        </div>
      </div>

      {/* Name input */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Your name (for completions)</label>
        <input
          value={completedBy}
          onChange={e => setCompletedBy(e.target.value)}
          placeholder="Enter your name before checking off tasks"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
      </div>

      {/* Add Task Form */}
      {showForm && (
        <form onSubmit={addTask} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <p className="font-semibold text-gray-800">Add Cleaning Task</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Task Title *</label>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Wipe down packing stations"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Frequency</label>
              <select
                value={form.frequency}
                onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Area</label>
              <input
                value={form.area}
                onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
                placeholder="e.g. Packing, Warehouse, Break Room"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Description</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional details..."
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
              {submitting ? 'Adding...' : 'Add Task'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {(['daily', 'weekly', 'monthly'] as const).map(tab => {
          const tabTasks = tasks.filter(t => t.frequency === tab)
          const tabDone = tabTasks.filter(t => t.is_done).length
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === tab ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tabTasks.length > 0 && (
                <span className={`ml-2 text-xs ${activeTab === tab ? 'text-gray-300' : 'text-gray-400'}`}>
                  {tabDone}/{tabTasks.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Progress</p>
            <p className="text-sm font-bold text-gray-800">{doneCount}/{totalCount}</p>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${doneCount === totalCount ? 'bg-green-500' : 'bg-cyan-500'}`}
              style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
            />
          </div>
          {doneCount === totalCount && totalCount > 0 && (
            <p className="text-xs text-green-600 font-medium mt-2">All {activeTab} tasks complete!</p>
          )}
        </div>
      )}

      {/* Task List */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <Sparkles size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No {activeTab} tasks yet</p>
            <p className="text-gray-400 text-xs mt-1">Add tasks or click "Load Defaults" to get started</p>
          </div>
        )}
        {filtered.map(task => (
          <div
            key={task.id}
            className={`bg-white rounded-2xl border shadow-sm p-4 flex items-center gap-4 ${task.is_done ? 'border-green-100 bg-green-50/30' : 'border-gray-100'}`}
          >
            <button
              onClick={() => !task.is_done && completeTask(task.id)}
              disabled={!!completing || task.is_done}
              className="shrink-0"
            >
              {completing === task.id ? (
                <Loader2 size={22} className="animate-spin text-cyan-500" />
              ) : task.is_done ? (
                <CheckCircle size={22} className="text-green-500" />
              ) : (
                <Circle size={22} className="text-gray-300 hover:text-cyan-400 transition-colors" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`font-medium text-sm ${task.is_done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {task.title}
                </p>
                {task.area && (
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{task.area}</span>
                )}
              </div>
              {task.description && <p className="text-xs text-gray-400 mt-0.5">{task.description}</p>}
              {task.is_done && task.last_completion && (
                <p className="text-xs text-green-600 mt-0.5">
                  Done by {task.last_completion.completed_by || 'staff'} at {new Date(task.last_completion.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </p>
              )}
            </div>

            <button
              onClick={() => deleteTask(task.id)}
              className="shrink-0 text-gray-200 hover:text-red-400 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
