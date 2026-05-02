'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
const supabase = createClient()

export default function DashboardProfile() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submittingPassword, setSubmittingPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const router = useRouter()
  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 5000)
  }

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!profile) {
      router.push('/login')
      return
    }

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      router.push('/employee/profile')
      return
    }

    setCurrentUser(profile)

    if (profile.company_id) {
      const { data: companyData } = await supabase
        .from('companies')
        .select('name')
        .eq('id', profile.company_id)
        .single()
      setCompany(companyData)
    }

    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword.length < 6) {
      showMessage('New password must be at least 6 characters', 'error')
      return
    }

    if (newPassword !== confirmPassword) {
      showMessage('New passwords do not match', 'error')
      return
    }

    if (currentPassword === newPassword) {
      showMessage('New password must be different from current password', 'error')
      return
    }

    setSubmittingPassword(true)

    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'self_change',
        target_user_id: currentUser.id,
        current_password: currentPassword,
        new_password: newPassword,
        actor_id: currentUser.id,
        actor_email: currentUser.email,
        actor_role: currentUser.role,
      }),
    })

    const result = await res.json()
    setSubmittingPassword(false)

    if (!res.ok) {
      showMessage(result.error || 'Failed to change password', 'error')
      return
    }

    showMessage('Password changed successfully!', 'success')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowPasswordForm(false)
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading profile…</div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">My Profile</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-sm text-slate-600 hover:text-slate-800"
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="space-y-4">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-2xl font-bold text-blue-700">
              {currentUser?.full_name?.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{currentUser?.full_name}</h2>
              <p className="text-slate-500 text-sm capitalize">{currentUser?.role}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Email</p>
              <p className="text-slate-800 mt-1">{currentUser?.email}</p>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Job Title</p>
              <p className="text-slate-800 mt-1">{currentUser?.job_title || '—'}</p>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Company</p>
              <p className="text-slate-800 mt-1">{company?.name || '—'}</p>
            </div>
          </div>
        </div>

        {/* View Switcher — admins/managers can flip to App view to see what employees see */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-1">📱 Switch View</h2>
          <p className="text-sm text-slate-500 mb-4">
            See the App as a driver would, e.g. to do a walk-round check or view your schedule.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="border-2 border-blue-600 bg-blue-50 rounded-xl p-4 text-center">
              <p className="text-2xl mb-1">🖥️</p>
              <p className="font-semibold text-blue-800">Dashboard</p>
              <p className="text-xs text-blue-600 mt-0.5">You're here</p>
            </div>
            <button
              onClick={() => router.push('/employee')}
              className="border-2 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 rounded-xl p-4 text-center transition"
            >
              <p className="text-2xl mb-1">📱</p>
              <p className="font-semibold text-slate-700">App</p>
              <p className="text-xs text-slate-500 mt-0.5">Driver / mobile view</p>
            </button>
          </div>
        </div>

        {/* Change Password */}
        {!showPasswordForm ? (
          <button
            onClick={() => setShowPasswordForm(true)}
            className="w-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 py-4 rounded-xl font-medium transition flex items-center justify-center gap-2"
          >
            🔒 Change Password
          </button>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">Change Password</h2>
              <button
                onClick={() => {
                  setShowPasswordForm(false)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
                className="text-slate-400"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                  required
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <p className="text-xs text-slate-500 mt-1">At least 6 characters</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>

              <button
                type="submit"
                disabled={submittingPassword}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {submittingPassword ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  )
}
