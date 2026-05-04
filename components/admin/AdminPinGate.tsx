'use client'

/**
 * AdminPinGate — wrap admin Phone Directory pages with this. Always
 * shows the PIN form on mount. Once the PIN is entered correctly,
 * renders children. Click away (route change) → component unmounts
 * → state is gone → next mount re-prompts.
 *
 * Three internal states:
 *   - loading: figuring out whether the admin has a PIN set yet
 *   - setup:   first time, prompt to choose a PIN
 *   - unlock:  PIN exists, prompt to enter it
 *   - ok:      render children
 *
 * The server-side admin write APIs ALSO check a short-lived
 * `pd_admin` cookie issued on PIN entry. So this component can't
 * be bypassed by hitting the API directly — both layers must
 * succeed.
 *
 * Usage:
 *   export default function MyAdminPage() {
 *     return (
 *       <AdminPinGate title="Phone Directory · Manage">
 *         {/* normal page contents *\/}
 *       </AdminPinGate>
 *     )
 *   }
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

const supabase = createClient()
const CODE_RE = /^\d{6}$/

type Mode = 'loading' | 'setup' | 'unlock' | 'ok'

type Props = {
  children: React.ReactNode
  /** Heading shown on the gate screen, e.g. "Phone Directory · Manage" */
  title: string
}

export default function AdminPinGate({ children, title }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('loading')
  const [error, setError] = useState('')

  // Setup form
  const [code1, setCode1] = useState('')
  const [code2, setCode2] = useState('')

  // Unlock form
  const [unlockCode, setUnlockCode] = useState('')

  const [submitting, setSubmitting] = useState(false)

  // ── Determine initial mode ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Check if THIS admin has a PIN set
      const { data: codeRow } = await supabase
        .from('phone_directory_codes')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (cancelled) return

      setMode(codeRow ? 'unlock' : 'setup')
    }
    init()
    return () => { cancelled = true }
  }, [router])

  // ── Setup ────────────────────────────────────────────────────────
  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!CODE_RE.test(code1)) { setError('Code must be exactly 6 digits'); return }
    if (code1 !== code2) { setError("Codes don't match"); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/phone-directory/set-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code1 }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to set code')
        return
      }
      setMode('ok')
    } catch (e: any) {
      setError(e?.message || 'Server error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Unlock ───────────────────────────────────────────────────────
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!CODE_RE.test(unlockCode)) { setError('Code must be exactly 6 digits'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/phone-directory/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: unlockCode }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || 'Wrong code')
        setUnlockCode('')
        return
      }
      setMode('ok')
      setUnlockCode('')
    } catch (e: any) {
      setError(e?.message || 'Server error')
    } finally {
      setSubmitting(false)
    }
  }

  if (mode === 'ok') return <>{children}</>

  // ── Render gate ──────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-lg">
      <div className="mb-4">
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to dashboard</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">{title}</h1>
      </div>

      {mode === 'loading' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <p className="text-slate-400 italic">Checking…</p>
        </div>
      )}

      {mode === 'setup' && (
        <form onSubmit={handleSetup} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <p className="text-sm text-slate-700">
            Choose a 6-digit code. You&apos;ll enter this every time you open the
            Phone Directory admin pages. The same code also unlocks the driver
            view if you sign in there.
          </p>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Code</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="off"
              value={code1}
              onChange={e => setCode1(e.target.value.replace(/\D/g, ''))}
              className="w-full text-2xl tracking-[0.5em] text-center bg-slate-50 border border-slate-300 rounded-xl px-4 py-3"
              placeholder="••••••"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Confirm code</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="off"
              value={code2}
              onChange={e => setCode2(e.target.value.replace(/\D/g, ''))}
              className="w-full text-2xl tracking-[0.5em] text-center bg-slate-50 border border-slate-300 rounded-xl px-4 py-3"
              placeholder="••••••"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Set code'}
          </button>
          <p className="text-xs text-slate-500 text-center">
            Forgotten codes can only be reset by another admin.
          </p>
        </form>
      )}

      {mode === 'unlock' && (
        <form onSubmit={handleUnlock} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <p className="text-sm text-slate-700">Enter your 6-digit PIN to continue.</p>
          <div>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="off"
              value={unlockCode}
              onChange={e => setUnlockCode(e.target.value.replace(/\D/g, ''))}
              className="w-full text-3xl tracking-[0.5em] text-center bg-slate-50 border border-slate-300 rounded-xl px-4 py-4"
              placeholder="••••••"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !CODE_RE.test(unlockCode)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Unlock'}
          </button>
          <p className="text-xs text-slate-500 text-center">
            Forgotten? Another admin can reset it from the Manage page.
          </p>
        </form>
      )}
    </div>
  )
}
