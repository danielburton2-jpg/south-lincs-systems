'use client'

/**
 * /employee/phone-directory — driver-side phone directory.
 *
 * Three rendering states, in order:
 *   1. setup — user has no code yet. Form to choose & confirm a 6-digit code.
 *   2. unlock — user has a code; needs to enter it.
 *   3. unlocked — shows the directory: name + phone + "Call" button.
 *
 * The page itself doesn't trust the client to gate access to the
 * data — the entries API requires a valid unlock cookie before it
 * returns rows, so even if someone bypassed the UI they'd hit a 403.
 *
 * Mobile-first. Big tap targets. Tap-to-call uses tel: hrefs which
 * works on every modern phone browser.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import OnCallCard from '@/components/phone-directory/OnCallCard'

const supabase = createClient()

type Entry = {
  id: string
  name: string
  phone_number: string
  notes: string | null
  sort_order: number
}

type Mode = 'loading' | 'setup' | 'unlock' | 'unlocked' | 'no_access'

const CODE_RE = /^\d{6}$/

export default function EmployeePhoneDirectoryPage() {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('loading')
  const [companyName, setCompanyName] = useState<string>('')
  const [error, setError] = useState('')

  // Setup form
  const [code1, setCode1] = useState('')
  const [code2, setCode2] = useState('')

  // Unlock form
  const [unlockCode, setUnlockCode] = useState('')

  // Unlocked
  const [entries, setEntries] = useState<Entry[]>([])
  const [submitting, setSubmitting] = useState(false)

  // ── Initial load: figure out which mode to show ──────────────────
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, company_id, role')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!profile?.company_id) { router.push('/employee'); return }

      const { data: company } = await supabase
        .from('companies')
        .select('name, company_features (is_enabled, features (name, slug))')
        .eq('id', profile.company_id)
        .single()
      if (cancelled) return
      if (!company) { router.push('/employee'); return }
      setCompanyName(company.name || '')

      // Company-level gate
      const companyHasIt = (company.company_features || []).some(
        (cf: any) => cf.is_enabled && cf.features?.slug === 'phone_directory'
      )
      if (!companyHasIt) {
        setMode('no_access')
        return
      }

      // User-level gate (admins bypass)
      let userHasIt = profile.role === 'admin'
      if (profile.role !== 'admin') {
        const { data: feature } = await supabase
          .from('features').select('id').eq('slug', 'phone_directory').single()
        if (feature) {
          const { data: uf } = await supabase
            .from('user_features')
            .select('is_enabled')
            .eq('user_id', user.id)
            .eq('feature_id', feature.id)
            .maybeSingle()
          userHasIt = !!uf?.is_enabled
        }
      }
      if (!userHasIt) {
        setMode('no_access')
        return
      }

      // Does the user have a code set?
      const { data: codeRow } = await supabase
        .from('phone_directory_codes')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (cancelled) return

      // Step 19: always require the driver to enter their PIN on
      // every fresh page mount. We deliberately skip the
      // try-load-entries-and-skip-the-form shortcut from earlier
      // versions. Mode is 'setup' if no PIN exists, 'unlock' if it
      // does. The user enters the PIN, the verify-code API issues
      // the short-lived cookie, then loadEntries() runs.
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
    if (code1 !== code2) { setError('Codes don\'t match'); return }
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
      // Code set + cookie issued — load entries directly
      await loadEntries()
      setMode('unlocked')
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
      await loadEntries()
      setMode('unlocked')
      setUnlockCode('')
    } catch (e: any) {
      setError(e?.message || 'Server error')
    } finally {
      setSubmitting(false)
    }
  }

  const loadEntries = async () => {
    const res = await fetch('/api/phone-directory/entries')
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.error || 'Failed to load directory')
    }
    const data = await res.json()
    setEntries(data.entries || [])
  }

  // ── Render ───────────────────────────────────────────────────────
  if (mode === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading…</p>
      </main>
    )
  }

  if (mode === 'no_access') {
    return (
      <main className="min-h-screen bg-gray-50 pb-24">
        <Header companyName={companyName} title="Phone Directory" router={router} />
        <div className="px-6 pt-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <p className="text-gray-700 mb-3">Phone Directory isn&apos;t available for your account.</p>
            <button
              onClick={() => router.push('/employee')}
              className="text-blue-600 hover:underline text-sm"
            >Back to home</button>
          </div>
        </div>
        <BottomNav router={router} />
      </main>
    )
  }

  if (mode === 'setup') {
    return (
      <main className="min-h-screen bg-gray-50 pb-24">
        <Header companyName={companyName} title="Set your PIN" router={router} />
        <div className="px-6 pt-6">
          <form onSubmit={handleSetup} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
            <p className="text-sm text-gray-700">
              Choose a 6-digit code. You&apos;ll enter this every time you open Phone Directory.
              Keep it private — anyone with your code and your phone can see the directory.
            </p>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Code</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="off"
                value={code1}
                onChange={e => setCode1(e.target.value.replace(/\D/g, ''))}
                className="w-full text-2xl tracking-[0.5em] text-center bg-gray-50 border border-gray-300 rounded-xl px-4 py-3"
                placeholder="••••••"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Confirm code</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="off"
                value={code2}
                onChange={e => setCode2(e.target.value.replace(/\D/g, ''))}
                className="w-full text-2xl tracking-[0.5em] text-center bg-gray-50 border border-gray-300 rounded-xl px-4 py-3"
                placeholder="••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Set code'}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Forgotten codes can only be reset by an admin.
            </p>
          </form>
        </div>
        <BottomNav router={router} />
      </main>
    )
  }

  if (mode === 'unlock') {
    return (
      <main className="min-h-screen bg-gray-50 pb-24">
        <Header companyName={companyName} title="Phone Directory" router={router} />
        <div className="px-6 pt-6">
          <form onSubmit={handleUnlock} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
            <p className="text-sm text-gray-700">Enter your 6-digit PIN to open the directory.</p>
            <div>
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="off"
                value={unlockCode}
                onChange={e => setUnlockCode(e.target.value.replace(/\D/g, ''))}
                className="w-full text-3xl tracking-[0.5em] text-center bg-gray-50 border border-gray-300 rounded-xl px-4 py-4"
                placeholder="••••••"
                autoFocus
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={submitting || !CODE_RE.test(unlockCode)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
            >
              {submitting ? 'Checking…' : 'Unlock'}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Forgotten? Ask an admin to reset.
            </p>
          </form>
        </div>
        <BottomNav router={router} />
      </main>
    )
  }

  // unlocked
  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <Header companyName={companyName} title="Phone Directory" router={router} />
      <div className="px-4 pt-4">
        {/* On-call card is the most actionable thing on this page —
            sits at the top so a driver in a hurry can tap and go. */}
        <OnCallCard />

        {entries.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <p className="text-gray-500 italic">No numbers in the directory yet.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map(e => (
              <li key={e.id}>
                <a
                  href={`tel:${cleanPhoneForTel(e.phone_number)}`}
                  className="block bg-white border border-gray-200 rounded-2xl p-4 active:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-base truncate">{e.name}</p>
                      <p className="text-sm text-gray-700 mt-0.5">{e.phone_number}</p>
                      {e.notes && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{e.notes}</p>
                      )}
                    </div>
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-2 text-sm font-semibold flex-shrink-0">
                      📞 Call
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BottomNav router={router} />
    </main>
  )
}

// ── Sub-components ────────────────────────────────────────────────
function Header({
  companyName, title, router,
}: { companyName: string; title: string; router: any }) {
  return (
    <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
      <div className="flex items-center justify-between">
        <button onClick={() => router.push('/employee')} className="text-blue-100 text-sm hover:text-white">← Home</button>
        <p className="text-blue-100 text-sm">{companyName}</p>
      </div>
      <h1 className="text-2xl font-bold mt-2">📞 {title}</h1>
    </div>
  )
}

function BottomNav({ router }: { router: any }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
      <div className="flex justify-around items-center h-16 max-w-md mx-auto">
        <button onClick={() => router.push('/employee')} className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600">
          <span className="text-xl">🏠</span>
          <span className="text-xs font-medium">Home</span>
        </button>
        <button onClick={() => router.push('/employee/profile')} className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600">
          <span className="text-xl">👤</span>
          <span className="text-xs font-medium">Profile</span>
        </button>
      </div>
    </nav>
  )
}

// Strip everything except digits and a leading '+'. tel: handles
// spaces and dashes fine on most phones but normalising is safer.
function cleanPhoneForTel(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return plus + trimmed.replace(/[^\d]/g, '')
}
