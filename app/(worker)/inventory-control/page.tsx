'use client'

import { useEffect, useState } from 'react'
import {
  Truck, Scale, MapPin, ShoppingCart, ClipboardList, AlertTriangle, RotateCcw, LogOut, Boxes,
} from 'lucide-react'

type WorkerSession = { workerId: string; name: string; role: string; orgId: string; warehouseId: string }

const SECTIONS = [
  { href: '/receive', label: 'Receiving', description: 'Check in incoming shipments', icon: Truck, color: 'bg-green-600' },
  { href: '/inventory-control/adjust', label: 'Adjust Stock', description: 'Add or remove inventory manually', icon: Scale, color: 'bg-cyan-600' },
  { href: '/inventory-control/locations', label: 'Locations', description: 'Manage bins and product placement', icon: MapPin, color: 'bg-blue-600' },
  { href: '/inventory-control/shopping-list', label: 'Shopping List', description: 'Request supplies and check off arrivals', icon: ShoppingCart, color: 'bg-purple-600' },
  { href: '/inventory-control/cycle-counts', label: 'Cycle Counts', description: 'Count bins and reconcile stock', icon: ClipboardList, color: 'bg-amber-600' },
  { href: '/inventory-control/damage-reports', label: 'Damage Reports', description: 'Log damaged or unsellable items', icon: AlertTriangle, color: 'bg-red-600' },
  { href: '/inventory-control/returns', label: 'Returns', description: 'Process customer returns', icon: RotateCcw, color: 'bg-orange-600' },
]

export default function InventoryHubPage() {
  const [worker, setWorker] = useState<WorkerSession | null>(null)

  useEffect(() => {
    fetch('/api/worker-session').then(r => r.ok ? r.json() : null).then(setWorker)
  }, [])

  async function handleLogout() {
    await fetch('/api/worker-auth', { method: 'DELETE' })
    window.location.href = '/worker'
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
            <Boxes size={18} className="text-green-600" />
          </div>
          <div>
            <p className="font-bold text-gray-900">{worker?.name || 'Worker'}</p>
            <p className="text-xs text-gray-500">Inventory Control</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a href="/hub" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Switch task</a>
          <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm transition-colors">
            <LogOut size={15} /> Log out
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 sm:p-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Inventory Control</h1>
          <p className="text-gray-500 mb-8">Choose what you're working on.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SECTIONS.map(section => {
              const Icon = section.icon
              return (
                <a
                  key={section.href}
                  href={section.href}
                  className="flex items-center gap-4 bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-gray-300 transition-all"
                >
                  <div className={`w-12 h-12 ${section.color} rounded-xl flex items-center justify-center shrink-0`}>
                    <Icon size={22} className="text-white" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{section.label}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{section.description}</p>
                  </div>
                </a>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
