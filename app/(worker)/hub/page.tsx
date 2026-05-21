'use client'

import { useEffect, useState } from 'react'
import { ShoppingBasket, Package, Truck, Send, LogOut } from 'lucide-react'

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
    { label: 'Shipping', description: 'Ship packed orders out', href: '/ship', icon: Send, color: 'bg-orange-600 hover:bg-orange-500', iconBg: 'bg-orange-700' },
    { label: 'Receiving', description: 'Check in incoming shipments', href: '/receive', icon: Truck, color: 'bg-green-600 hover:bg-green-500', iconBg: 'bg-green-700' },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-8 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center">
            <Package size={18} className="text-gray-400" />
          </div>
          <div>
            <p className="font-bold text-white">{worker?.name || 'Worker'}</p>
            <p className="text-xs text-gray-500">Warehouse Management</p>
          </div>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
          <LogOut size={16} /> Log out
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
        <div className="w-full max-w-2xl">
          <h1 className="text-3xl font-bold text-white mb-2">What are you working on?</h1>
          <p className="text-gray-500 mb-10">Select your task to get started.</p>

          <div className="grid grid-cols-2 gap-4">
            {tasks.map(task => (
              <a key={task.href} href={task.href} className={`flex items-center gap-5 ${task.color} rounded-2xl p-6 transition-colors`}>
                <div className={`w-14 h-14 ${task.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                  <task.icon size={26} className="text-white" />
                </div>
                <div>
                  <p className="font-bold text-white text-xl">{task.label}</p>
                  <p className="text-white/70 text-sm mt-0.5">{task.description}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
