'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'

const supabase = createClient()

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam === 'frozen') {
      setError('Your account has been frozen. Please contact your administrator.')
    } else if (errorParam === 'expired') {
      setError('Your company subscription has expired. Please contact your administrator.')
    } else if (errorParam === 'inactive') {
      setError('Your company account is inactive. Please contact your administrator.')
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'LOGIN_FAILED',
          entity: 'auth',
          details: { email, reason: error.message },
        }),
      })
      setError('Invalid email or password')
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_frozen, is_deleted, company_id')
      .eq('id', data.user.id)
      .single()

    if (profile?.is_frozen) {
      await supabase.auth.signOut()
      setError('Your account has been frozen. Please contact your administrator.')
      setLoading(false)
      return
    }

    if (profile?.is_deleted) {
      await supabase.auth.signOut()
      setError('This account no longer exists. Please contact your administrator.')
      setLoading(false)
      return
    }

    if (profile?.company_id && profile?.role !== 'superuser') {
      const { data: company } = await supabase
        .from('companies')
        .select('is_active, end_date, override_end_date')
        .eq('id', profile.company_id)
        .single()

      if (company) {
        const effectiveEnd = company.override_end_date || company.end_date
        const isExpired = effectiveEnd && new Date(effectiveEnd) < new Date()

        if (!company.is_active) {
          await supabase.auth.signOut()
          setError('Your company account is inactive. Please contact your administrator.')
          setLoading(false)
          return
        }

        if (isExpired) {
          await supabase.auth.signOut()
          setError('Your company subscription has expired. Please contact your administrator.')
          setLoading(false)
          return
        }
      }
    }

    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'LOGIN_SUCCESS',
        entity: 'auth',
        user_id: data.user.id,
        user_email: email,
        user_role: profile?.role,
        details: { email },
      }),
    })

    if (profile?.role === 'superuser') {
      router.push('/superuser')
    } else if (profile?.role === 'admin' || profile?.role === 'manager') {
      router.push('/dashboard')
    } else {
      router.push('/employee')
    }
  }

  return (
    <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md">
      <h1 className="text-3xl font-bold text-blue-700 mb-2 text-center">South Lincs Systems</h1>
      <p className="text-gray-500 text-center mb-8">Sign in to your account</p>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="you@example.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="••••••••"
            required
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-medium"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <Suspense fallback={
        <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md">
          <h1 className="text-3xl font-bold text-blue-700 mb-2 text-center">South Lincs Systems</h1>
          <p className="text-gray-500 text-center">Loading...</p>
        </div>
      }>
        <LoginForm />
      </Suspense>
    </main>
  )
}