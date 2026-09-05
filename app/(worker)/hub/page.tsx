'use client'

import { useEffect, useState } from 'react'
import { ShoppingBasket, Package, Truck, Send, LogOut, Warehouse, ChevronDown } from 'lucide-react'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }

// Picking and packing are cross-visible to both roles: on the floor, whoever
// finishes picking with nobody else around to pack often needs to pack it
// themselves, so both roles need to be able to reach both task screens.
const ALL_TASKS = [
  { key: 'pick',    label: 'Picking',   description: 'Collect items for orders',     href: '/pick',    icon: ShoppingBasket, color: 'bg-blue-600 hover:bg-blue-500',   iconBg: 'bg-blue-700',   roles: ['picker', 'packer', 'all'] },
  { key: 'pack',    label: 'Packing',   description: 'Pack orders into boxes',        href: '/pack',    icon: Package,        color: 'bg-purple-600 hover:bg-purple-500', iconBg: 'bg-purple-700', roles: ['picker', 'packer', 'all'] },
  { key: 'ship',    label: 'Shipping',  description: 'Ship packed orders out',        href: '/ship',    icon: Send,           color: 'bg-orange-600 hover:bg-orange-500', iconBg: 'bg-orange-700', roles: ['shipper',  'all'] },
  { key: 'receive', label: 'Receiving', description: 'Check in incoming shipments',   href: '/receive', icon: Truck,          color: 'bg-green-600 hover:bg-green-500',  iconBg: 'bg-green-700',  roles: ['receiver', 'all'] },
]

const FOCUS_KEY = 'wms_worker_focus'

export default function WorkerHubPage() {
  const [worker, setWorker] = useState<WorkerSession | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [showSwitcher, setShowSwitcher] = useState(false)

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) {
          setWorker(session)
          if (session.role === 'all') {
            const saved = sessionStorage.getItem(FOCUS_KEY)
            setFocus(saved || null)
          }
        }
      })
  }, [])

  async function handleLogout() {
    sessionStorage.removeItem(FOCUS_KEY)
    await fetch('/api/worker-auth', { method: 'DELETE' })
    window.location.href = '/worker'
  }

  function setTaskFocus(key: string) {
    sessionStorage.setItem(FOCUS_KEY, key)
    setFocus(key)
    setShowSwitcher(false)
  }

  if (!worker) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  const visibleTasks = ALL_TASKS.filter(t => t.roles.includes(worker.role))
  const isAllRole = worker.role === 'all'
  const focusedTask = isAllRole && focus ? visibleTasks.find(t => t.key === focus) : null

  // Single-role workers go straight to their one task
  const isSingleTask = visibleTasks.length === 1

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center">
            <Warehouse size={18} className="text-gray-400" />
          </div>
          <div>
            <p className="font-bold text-white">{worker.name}</p>
            <p className="text-xs text-gray-500 capitalize">
              {isAllRole && focusedTask ? `${focusedTask.label} today` : worker.role}
            </p>
          </div>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
          <LogOut size={16} /> Log out
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">

        {/* ── ALL ROLE: no focus set yet → pick your focus ── */}
        {isAllRole && !focus && (
          <div className="w-full max-w-lg">
            <h1 className="text-3xl font-bold text-white mb-2">What are you doing today?</h1>
            <p className="text-gray-500 mb-8">Choose your main task and the hub will stay focused on it.</p>
            <div className="space-y-3">
              {visibleTasks.map(task => {
                const Icon = task.icon
                return (
                  <button
                    key={task.key}
                    onClick={() => setTaskFocus(task.key)}
                    className={`w-full flex items-center gap-5 ${task.color} rounded-2xl p-5 transition-colors text-left`}
                  >
                    <div className={`w-12 h-12 ${task.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                      <Icon size={22} className="text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-lg">{task.label}</p>
                      <p className="text-white/70 text-sm">{task.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── ALL ROLE: focus set → show focused task + switch option ── */}
        {isAllRole && focus && focusedTask && (
          <div className="w-full max-w-sm">
            {(() => {
              const Icon = focusedTask.icon
              return (
                <a
                  href={focusedTask.href}
                  className={`flex flex-col items-center gap-5 ${focusedTask.color} rounded-2xl p-10 transition-colors mb-4`}
                >
                  <div className={`w-20 h-20 ${focusedTask.iconBg} rounded-2xl flex items-center justify-center`}>
                    <Icon size={36} className="text-white" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-white text-2xl">{focusedTask.label}</p>
                    <p className="text-white/70 text-sm mt-1">{focusedTask.description}</p>
                  </div>
                </a>
              )
            })()}

            {/* Switch task */}
            <div className="relative">
              <button
                onClick={() => setShowSwitcher(s => !s)}
                className="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-gray-300 text-sm py-2 transition-colors"
              >
                Switch task <ChevronDown size={14} className={`transition-transform ${showSwitcher ? 'rotate-180' : ''}`} />
              </button>

              {showSwitcher && (
                <div className="mt-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  {visibleTasks.filter(t => t.key !== focus).map(task => {
                    const Icon = task.icon
                    return (
                      <button
                        key={task.key}
                        onClick={() => setTaskFocus(task.key)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left"
                      >
                        <div className={`w-8 h-8 ${task.iconBg} rounded-lg flex items-center justify-center shrink-0`}>
                          <Icon size={15} className="text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{task.label}</p>
                          <p className="text-xs text-gray-500">{task.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SINGLE ROLE: big card ── */}
        {!isAllRole && isSingleTask && (() => {
          const task = visibleTasks[0]
          const Icon = task.icon
          return (
            <div className="w-full max-w-sm">
              <p className="text-gray-500 text-center mb-6">Ready to start?</p>
              <a href={task.href} className={`flex flex-col items-center gap-5 ${task.color} rounded-2xl p-10 transition-colors`}>
                <div className={`w-20 h-20 ${task.iconBg} rounded-2xl flex items-center justify-center`}>
                  <Icon size={36} className="text-white" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-white text-2xl">{task.label}</p>
                  <p className="text-white/70 text-sm mt-1">{task.description}</p>
                </div>
              </a>
            </div>
          )
        })()}

        {/* ── MULTI ROLE (non-all, e.g. picker+packer) ── */}
        {!isAllRole && !isSingleTask && (
          <div className="w-full max-w-2xl">
            <h1 className="text-3xl font-bold text-white mb-2">What are you working on?</h1>
            <p className="text-gray-500 mb-10">Select your task to get started.</p>
            <div className={`grid gap-4 ${visibleTasks.length === 2 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {visibleTasks.map(task => {
                const Icon = task.icon
                return (
                  <a key={task.href} href={task.href} className={`flex items-center gap-5 ${task.color} rounded-2xl p-6 transition-colors`}>
                    <div className={`w-14 h-14 ${task.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                      <Icon size={26} className="text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-xl">{task.label}</p>
                      <p className="text-white/70 text-sm mt-0.5">{task.description}</p>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
