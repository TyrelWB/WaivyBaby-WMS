'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCw, LogOut } from 'lucide-react'

export default function WorkerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Worker page crashed:', error)
  }, [error])

  async function handleLogout() {
    await fetch('/api/worker-auth', { method: 'DELETE' })
    window.location.href = '/worker'
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center text-center px-6 gap-6">
      <div className="w-20 h-20 bg-red-950 rounded-2xl flex items-center justify-center">
        <AlertTriangle size={40} className="text-red-400" />
      </div>
      <div className="max-w-sm">
        <p className="text-2xl font-bold text-white mb-2">Something went wrong</p>
        <p className="text-gray-400">
          This screen hit an unexpected error. Your progress up to this point is saved — tap below to try again.
        </p>
      </div>
      <div className="flex gap-3 w-full max-w-xs">
        <button
          onClick={reset}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3.5 rounded-xl font-semibold"
        >
          <RotateCw size={18} /> Try Again
        </button>
      </div>
      <div className="flex items-center gap-4">
        <button onClick={() => window.location.reload()} className="text-sm text-gray-500 hover:text-gray-300 underline transition-colors">
          Reload page
        </button>
        <span className="text-gray-700">|</span>
        <button onClick={handleLogout} className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
          <LogOut size={16} /> Log out
        </button>
      </div>
    </div>
  )
}
