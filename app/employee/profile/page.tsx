'use client'

/**
 * /employee/profile — placeholder.
 *
 * Read-only view of the employee's own info. No edit fields yet —
 * editing comes in the shared profile page work later (which will be
 * reused for both /employee/profile and /dashboard/profile).
 *
 * Bottom nav matches the home page so the user can hop back.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

type Profile = {
  full_name: string | null
  email: string | null
  role: string
  job_title: string | null
  employee_number: string | null
  holiday_entitlement: number | null
}

const firstName = (full: string | null | undefined) =>
  (full || '').split(' ')[0] || ''

async function recordAudit(payload: any) {
  try {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch { /* swallow */ }
}

export default function EmployeeProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }
        const { data } = await supabase
          .from('profiles')
          .select('full_name, email, role, job_title, employee_number, holiday_entitlement')
          .eq('id', user.id)
          .single()
        if (!cancelled && data) setProfile(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [router])

  const handleSignOut = async () => {
    let user_id: string | undefined
    try {
      const { data: { user } } = await supabase.auth.getUser()
      user_id = user?.id
    } catch { /* fine */ }

    await recordAudit({
      user_id,
      user_email: profile?.email,
      user_role: profile?.role,
      action: 'LOGOUT',
      entity: 'auth',
      entity_id: user_id,
    })

    try { await supabase.auth.signOut() } catch { /* fine */ }
    if (typeof window !== 'undefined') window.location.href = '/login'
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400">Loading…</p>
      </main>
    )
  }
  if (!profile) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500">Couldn&apos;t load your profile.</p>
      </main>
    )
  }

  const initial = firstName(profile.full_name).charAt(0).toUpperCase() || '?'

  return (
    <main className="min-h-screen bg-slate-50 pb-24">

      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-800 text-white px-6 pt-10 pb-12 rounded-b-[2rem] shadow-xl">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        />
        <div className="relative flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-white/15 backdrop-blur-sm rounded-full flex items-center justify-center text-3xl font-bold mb-3">
            {initial}
          </div>
          <h1 className="text-2xl font-bold">{profile.full_name || 'Your profile'}</h1>
          <p className="text-indigo-100/90 text-sm mt-1">{profile.email}</p>
          {profile.job_title && (
            <span className="inline-block mt-3 bg-white/15 text-white text-xs px-3 py-1 rounded-full font-medium">
              {profile.job_title}
            </span>
          )}
        </div>
      </header>

      <div className="px-5 pt-5 space-y-3">

        {/* Info cards */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
          <Row label="Email" value={profile.email || '—'} />
          {profile.employee_number && (
            <Row label="Employee number" value={profile.employee_number} />
          )}
          <Row label="Role" value={profile.role} capitalize />
          {profile.job_title && <Row label="Job title" value={profile.job_title} />}
          {profile.holiday_entitlement !== null && profile.holiday_entitlement !== undefined && (
            <Row label="Holiday balance" value={`${profile.holiday_entitlement} days`} />
          )}
        </div>

        {/* Coming soon */}
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-4 text-center">
          <p className="text-sm text-slate-600 font-medium">Editing coming soon</p>
          <p className="text-xs text-slate-500 mt-1">
            Soon you&apos;ll be able to update your details and change your password from here.
          </p>
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full bg-white border border-slate-200 hover:bg-slate-50 active:bg-slate-100 rounded-2xl shadow-sm py-4 text-slate-700 font-medium transition"
        >
          Sign out
        </button>
      </div>

      {/* BOTTOM NAV */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-slate-200 shadow-lg safe-bottom">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button
            onClick={() => router.push('/employee')}
            className="flex flex-col items-center gap-0.5 px-6 py-1 rounded-lg text-slate-400 hover:text-slate-600 transition"
          >
            <span className="text-xl" aria-hidden>🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button
            onClick={() => router.push('/employee/profile')}
            className="flex flex-col items-center gap-0.5 px-6 py-1 rounded-lg text-indigo-600 transition"
          >
            <span className="text-xl" aria-hidden>👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}

function Row({
  label, value, capitalize,
}: {
  label: string
  value: string
  capitalize?: boolean
}) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-4">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm text-slate-800 font-medium text-right ${capitalize ? 'capitalize' : ''}`}>
        {value}
      </span>
    </div>
  )
}
