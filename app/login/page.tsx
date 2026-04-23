'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { startAuthentication } from '@simplewebauthn/browser'

const supabase = createClient()

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [biometricLoading, setBiometricLoading] = useState(false)
  const [hasBiometric, setHasBiometric] = useState(false)
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

    // Check if biometric is available and user has registered on this device
    const savedEmail = localStorage.getItem('biometric_email')
    if (savedEmail && window.PublicKeyCredential) {
      setHasBiometric(true)
      setEmail(savedEmail)
    }
  }, [searchParams])

  const routeByRole = async (userId: string) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_frozen, is_deleted, company_id')
      .eq('id', userId)
      .single()

    if (profile?.is_frozen) {
      await supabase.auth.signOut()
      setError('Your account has been frozen. Please contact your administrator.')
      return
    }

    if (profile?.is_deleted) {
      await supabase.auth.signOut()
      setError('This account no longer exists. Please contact your administrator.')
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
          return
        }

        if (isExpired) {
          await supabase.auth.signOut()
          setError('Your company subscription has expired. Please contact your administrator.')
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
        user_id: userId,
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

    await routeByRole(data.user.id)
    setLoading(false)
  }

  const handleBiometricLogin = async () => {
    setBiometricLoading(true)
    setError('')

    try {
      const savedEmail = localStorage.getItem('biometric_email')
      if (!savedEmail) {
        setError('No biometric account set up on this device')
        setBiometricLoading(false)
        return
      }

      // Get authentication options
      const optRes = await fetch('/api/biometric/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: savedEmail }),
      })

      if (!optRes.ok) {
        const err = await optRes.json()
        setError('Biometric login failed: ' + err.error)
        setBiometricLoading(false)
        return
      }

      const options = await optRes.json()

      // Prompt user for biometric (Face ID / fingerprint)
      const response = await startAuthentication({ optionsJSON: options })

      // Verify with server
      const verifyRes = await fetch('/api/biometric/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: options.user_id,
          response,
        }),
      })

      const result = await verifyRes.json()

      if (!verifyRes.ok || !result.action_link) {
        setError('Biometric authentication failed')
        setBiometricLoading(false)
        return
      }

      // Use the magic link to sign in
      window.location.href = result.action_link
    } catch (err: any) {
      setError('Biometric login cancelled or failed')
      setBiometricLoading(false)
    }
  }

  const handleForgetDevice = () => {
    localStorage.removeItem('biometric_email')
    setHasBiometric(false)
    setEmail('')
  }

  return (
    <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md">
      <h1 className="text-3xl font-bold text-blue-700 mb-2 text-center">South Lincs Systems</h1>
      <p className="text-gray-500 text-center mb-8">Sign in to your account</p>

      {/* Biometric login button */}
      {hasBiometric && (
        <div className="mb-6">
          <button
            onClick={handleBiometricLogin}
            disabled={biometricLoading}
            className="w-full bg-gradient-to-br from-blue-600 to-blue-800 text-white py-4 rounded-xl hover:opacity-90 transition font-medium flex items-center justify-center gap-3 shadow-lg"
          >
            <span className="text-2xl">👆</span>
            <span>{biometricLoading ? 'Authenticating...' : 'Sign in with Face ID / Fingerprint'}</span>
          </button>
          <p className="text-center text-xs text-gray-500 mt-2">
            Signing in as <span className="font-medium">{email}</span>
            {' · '}
            <button
              type="button"
              onClick={handleForgetDevice}
              className="text-blue-600 underline"
            >
              Use different account
            </button>
          </p>
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-gray-200"></div>
            <span className="text-xs text-gray-400 uppercase">or</span>
            <div className="flex-1 h-px bg-gray-200"></div>
          </div>
        </div>
      )}

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