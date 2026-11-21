'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Admin page crashed:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-24 gap-5">
      <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center">
        <AlertTriangle size={32} className="text-red-500" />
      </div>
      <div className="max-w-sm">
        <p className="text-xl font-bold text-gray-900 mb-1">This page hit an error</p>
        <p className="text-gray-500 text-sm">
          Something on this screen broke unexpectedly. Try again, or use the sidebar to go elsewhere.
        </p>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors"
      >
        <RotateCw size={16} /> Try Again
      </button>
    </div>
  )
}
