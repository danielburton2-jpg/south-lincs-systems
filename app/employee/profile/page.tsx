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
  id: string
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

  // Change password state
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submittingPassword, setSubmittingPassword] = useState(false)
  const [pwMessage, setPwMessage] = useState('')
  const [pwMessageType, setPwMessageType] = useState<'success' | 'error'>('success')

  const showPwMessage = (msg: string, type: 'success' | 'error') => {
    setPwMessage(msg)
    setPwMessageType(type)
    setTimeout(() => setPwMessage(''), 5000)
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return

    if (newPassword.length < 6) {
      showPwMessage('New password must be at least 6 characters', 'error')
      return
    }
    if (newPassword !== confirmPassword) {
      showPwMessage('New passwords do not match', 'error')
      return
    }
    if (currentPassword === newPassword) {
      showPwMessage('New password must be different from current', 'error')
      return
    }

    setSubmittingPassword(true)
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'self_change',
        target_user_id: profile.id,
        current_password: currentPassword,
        new_password: newPassword,
        actor_id: profile.id,
        actor_email: profile.email,
        actor_role: profile.role,
      }),
    })
    const result = await res.json()
    setSubmittingPassword(false)

    if (!res.ok) {
      showPwMessage(result.error || 'Failed to change password', 'error')
      return
    }

    showPwMessage('Password changed successfully!', 'success')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowPasswordForm(false)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, email, role, job_title, employee_number, holiday_entitlement')
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

        {/* View Switcher — admins/managers only. Drivers don't see this. */}
        {(profile.role === 'admin' || profile.role === 'manager') && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
            <h2 className="text-base font-bold text-slate-800 mb-1">📱 Switch View</h2>
            <p className="text-xs text-slate-500 mb-3">
              You&apos;re currently in the App view. Switch back to the full Dashboard.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="border-2 border-indigo-600 bg-indigo-50 rounded-xl p-4 text-center">
                <p className="text-2xl mb-1">📱</p>
                <p className="font-semibold text-indigo-800 text-sm">App</p>
                <p className="text-xs text-indigo-600 mt-0.5">You&apos;re here</p>
              </div>
              <button
                onClick={() => router.push('/dashboard')}
                className="border-2 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 active:bg-indigo-100/50 rounded-xl p-4 text-center transition"
              >
                <p className="text-2xl mb-1">🖥️</p>
                <p className="font-semibold text-slate-700 text-sm">Dashboard</p>
                <p className="text-xs text-slate-500 mt-0.5">Switch back</p>
              </button>
            </div>
          </div>
        )}

        {/* Password change message */}
        {pwMessage && (
          <div className={`p-3 rounded-2xl text-sm font-medium ${
            pwMessageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {pwMessage}
          </div>
        )}

        {/* Change Password */}
        {!showPasswordForm ? (
          <button
            onClick={() => setShowPasswordForm(true)}
            className="w-full bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200 rounded-2xl shadow-sm py-4 text-slate-700 font-medium transition flex items-center justify-center gap-2"
          >
            🔒 Change Password
          </button>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">Change Password</h2>
              <button
                onClick={() => {
                  setShowPasswordForm(false)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
                className="text-slate-400 text-lg"
                aria-label="Cancel"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900"
                  required
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <p className="text-xs text-slate-500 mt-0.5">At least 6 characters</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>

              <button
                type="submit"
                disabled={submittingPassword}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-medium transition disabled:opacity-50"
              >
                {submittingPassword ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </div>
        )}

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
