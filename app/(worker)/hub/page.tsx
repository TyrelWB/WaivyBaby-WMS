'use client'

import { useEffect, useState } from 'react'
import { ShoppingBasket, Package, Truck, LogOut } from 'lucide-react'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }

export default function WorkerHubPage() {
  const [worker, setWorker] = useState<WorkerSession | null>(null)

  useEffect(() => {
    fetch('/api/worker-session')
      .then(r => r.ok ? r.json() : null)
      .then(session => { if (session) setWorker(session) })
  }, [])

  async function handleLogout() {
    await fetch('/api/worker-auth', { method: 'DELETE' })
    window.location.href = '/worker'
  }

  const tasks = [
    { label: 'Picking', description: 'Collect items for orders', href: '/pick', icon: ShoppingBasket, color: 'bg-blue-600 hover:bg-blue-500', iconBg: 'bg-blue-700' },
    { label: 'Packing', description: 'Pack picked orders into boxes', href: '/pack', icon: Package, color: 'bg-purple-600 hover:bg-purple-500', iconBg: 'bg-purple-700' },
    { label: 'Receiving', description: 'Check in incoming shipments', href: '/receive', icon: Truck, color: 'bg-green-600 hover:bg-green-500', iconBg: 'bg-green-700' },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <div>
          <p className="font-bold text-white">{worker?.name || 'Worker'}</p>
          <p className="text-xs text-gray-500">All Roles</p>
        </div>
        <button onClick={handleLogout} className="p-2 text-gray-600 hover:text-gray-400">
          <LogOut size={18} />
        </button>
      </div>

      <div className="flex-1 flex flex-col px-4 py-8 max-w-sm mx-auto w-full">
        <p className="text-2xl font-bold text-white mb-2">What are you doing today?</p>
        <p className="text-gray-500 text-sm mb-8">Select your task to get started.</p>

        <div className="space-y-4">
          {tasks.map(task => (
            <a key={task.href} href={task.href} className={`flex items-center gap-5 ${task.color} rounded-2xl p-5 transition-colors`}>
              <div className={`w-14 h-14 ${task.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                <task.icon size={26} className="text-white" />
              </div>
              <div>
                <p className="font-bold text-white text-lg">{task.label}</p>
                <p className="text-white/70 text-sm">{task.description}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
