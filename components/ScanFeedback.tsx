'use client'

import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react'

export type ScanResult = { result: 'success' | 'error' | 'warning'; message: string } | null

const STYLES = {
  success: { wrap: 'bg-green-950 border-green-800', text: 'text-green-300', icon: 'text-green-400', Icon: CheckCircle },
  warning: { wrap: 'bg-orange-950 border-orange-800', text: 'text-orange-300', icon: 'text-orange-400', Icon: AlertTriangle },
  error: { wrap: 'bg-red-950 border-red-800', text: 'text-red-300', icon: 'text-red-400', Icon: XCircle },
} as const

export default function ScanFeedback({ scan, size = 'md' }: { scan: ScanResult; size?: 'sm' | 'md' }) {
  if (!scan) return null
  const s = STYLES[scan.result]
  const Icon = s.Icon

  if (size === 'sm') {
    return (
      <div className={`flex items-center gap-2 mt-2.5 rounded-lg border px-3 py-2 ${s.wrap}`}>
        <Icon size={14} className={`${s.icon} shrink-0`} />
        <p className={`text-sm font-medium ${s.text}`}>{scan.message}</p>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl border p-4 max-w-lg w-full ${s.wrap}`}>
      <Icon size={18} className={`${s.icon} shrink-0`} />
      <p className={`text-base font-medium ${s.text}`}>{scan.message}</p>
    </div>
  )
}
