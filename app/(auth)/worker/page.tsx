'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Warehouse, Delete, Check } from 'lucide-react'
import { toast } from 'sonner'

const PAD = ['1','2','3','4','5','6','7','8','9','✓','0','⌫']

export default function WorkerPinPage() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)

  function handlePad(val: string) {
    if (val === '⌫') {
      setPin(p => p.slice(0, -1))
    } else if (val === '✓') {
      if (pin.length >= 4) maybeSubmit(pin)
    } else if (pin.length < 6) {
      const next = pin + val
      setPin(next)
      if (next.length === 6) maybeSubmit(next)
    }
  }

  async function maybeSubmit(currentPin: string) {
    if (currentPin.length < 4) return
    setLoading(true)
    const res = await fetch('/api/worker-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: currentPin }),
    })
    if (res.ok) {
      const data = await res.json()
      const role = data.role
      if (role === 'packer') router.push('/pack')
      else if (role === 'receiver') router.push('/receive')
      else if (role === 'all') router.push('/hub')
      else router.push('/pick')
    } else {
      toast.error('Incorrect PIN')
      setPin('')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-xs">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
            <Warehouse size={20} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-none">Waivy WMS</p>
            <p className="text-xs text-gray-500 leading-none mt-0.5">Worker Login</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <p className="text-center text-sm text-gray-400 mb-6">Enter your PIN</p>

          {/* PIN dots */}
          <div className="flex items-center justify-center gap-3 mb-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  i < pin.length
                    ? 'bg-blue-500 border-blue-500'
                    : 'border-gray-600'
                }`}
              />
            ))}
          </div>

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-3">
            {PAD.map((val, i) => {
              const isConfirm = val === '✓'
              const isBackspace = val === '⌫'
              const isDisabled = loading || (isConfirm && pin.length < 4)
              const isHidden = isConfirm && pin.length < 4

              return (
                <button
                  key={i}
                  onClick={() => val && handlePad(val)}
                  disabled={isDisabled}
                  className={`h-16 rounded-xl text-xl font-semibold transition-all touch-manipulation ${
                    isConfirm
                      ? isHidden
                        ? 'cursor-default opacity-0'
                        : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white'
                      : isBackspace
                      ? 'bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-300'
                      : 'bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white'
                  } disabled:opacity-50`}
                >
                  {isBackspace ? <Delete size={20} className="mx-auto" /> : isConfirm ? <Check size={20} className="mx-auto" /> : val}
                </button>
              )
            })}
          </div>


          {loading && (
            <p className="text-center text-sm text-blue-400 mt-4">Checking...</p>
          )}
        </div>

        <div className="text-center mt-4">
          <a href="/login" className="text-xs text-gray-600 hover:text-gray-400">
            Admin login →
          </a>
        </div>
      </div>
    </div>
  )
}
