'use client'

/**
 * Login page.
 *
 * Posts an audit event to /api/audit on every login attempt:
 *   • LOGIN_SUCCESS — user_email + user_id captured
 *   • LOGIN_FAILED  — user_email captured (no password obviously)
 *
 * Note: /api/audit is in middleware's PUBLIC_API_ROUTES list, so it
 * accepts requests without a session — necessary for failed-login logging.
 *
 * Structure: the page is split into a Suspense wrapper and a LoginForm
 * inner component. Next.js 13+ requires `useSearchParams()` to be inside
 * a Suspense boundary so the page can be statically prerendered. Without
 * the wrapper, the build fails on the static export step.
 */

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

const ERRORS: Record<string, string> = {
  frozen:    'Your account has been frozen. Contact your administrator.',
  expired:   'Your company subscription has expired.',
  inactive:  'Your company is currently inactive.',
  noprofile: 'Account exists but is not set up. Contact support.',
}

// Best-effort audit — never blocks login. Failures are silent
// because we don't want a broken audit endpoint to stop sign-in.
async function recordAudit(payload: any) {
  try {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    /* swallow */
  }
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const errKey = searchParams?.get('error')
    if (errKey && ERRORS[errKey]) setError(ERRORS[errKey])
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const trimmedEmail = email.trim()
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    })

    if (signInError || !data.user) {
      // Failed login — record it
      await recordAudit({
        user_email: trimmedEmail,
        action: 'LOGIN_FAILED',
        entity: 'auth',
        details: { reason: signInError?.message || 'unknown' },
      })
      setError(signInError?.message || 'Sign in failed')
      setSubmitting(false)
      return
    }

    // Success — record it with the real user id, email, and role.
    // We fetch the profile here BEFORE recording the audit so the
    // user_role column is filled in. Without this lookup, every
    // LOGIN_SUCCESS row ends up with role=null, which makes the
    // /superuser/audit viewer harder to filter and read.
    let user_role: string | undefined
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()
      user_role = profile?.role || undefined
    } catch {
      // Profile lookup failed — record the audit anyway with
      // whatever we have.
    }

    await recordAudit({
      user_id: data.user.id,
      user_email: data.user.email,
      user_role,
      action: 'LOGIN_SUCCESS',
      entity: 'auth',
      entity_id: data.user.id,
    })

    router.refresh()
    router.push('/')
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-slate-900">South Lincs Systems</h1>
        <p className="text-sm text-slate-500 mt-1">Sign in to continue</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Suspense fallback={
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900">South Lincs Systems</h1>
            <p className="text-sm text-slate-500 mt-1">Loading…</p>
          </div>
        </div>
      }>
        <LoginForm />
      </Suspense>
    </main>
  )
}
