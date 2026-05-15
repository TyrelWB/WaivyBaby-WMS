'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Warehouse } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '', fullName: '', orgName: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return }

    setLoading(true)

    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, password: form.password, fullName: form.fullName, orgName: form.orgName }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Signup failed')
      setLoading(false)
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
    if (signInError) {
      setError('Account created. Please sign in.')
      setLoading(false)
      router.push('/login')
      return
    }

    router.push('/dashboard')
  }

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
            <Warehouse size={20} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-lg leading-none">Waivy WMS</p>
            <p className="text-xs text-gray-500 leading-none mt-0.5">Admin Portal</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <h1 className="text-xl font-bold text-white mb-1">Create your account</h1>
          <p className="text-sm text-gray-500 mb-6">Set up your warehouse in minutes</p>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Organization Name <span className="text-red-400">*</span></label>
              <input type="text" value={form.orgName} onChange={e => update('orgName', e.target.value)} required className={inputClass} placeholder="Acme Logistics" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Your Name</label>
              <input type="text" value={form.fullName} onChange={e => update('fullName', e.target.value)} className={inputClass} placeholder="Jane Smith" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Email <span className="text-red-400">*</span></label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)} required className={inputClass} placeholder="admin@company.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Password <span className="text-red-400">*</span></label>
              <input type="password" value={form.password} onChange={e => update('password', e.target.value)} required className={inputClass} placeholder="Min. 8 characters" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Confirm Password <span className="text-red-400">*</span></label>
              <input type="password" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} required className={inputClass} placeholder="••••••••" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium text-sm transition-colors"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-800 text-center">
            <p className="text-xs text-gray-500">Already have an account?</p>
            <a href="/login" className="text-sm text-blue-400 hover:text-blue-300 font-medium mt-1 inline-block">Sign in →</a>
          </div>
        </div>
      </div>
    </div>
  )
}
