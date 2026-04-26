'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const supabase = createClient()

export default function EmployeeProfile() {
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

    if (profile) {
      setCurrentUser(profile)
      if (profile.company_id) {
        const { data: companyData } = await supabase
          .from('companies')
          .select('name')
          .eq('id', profile.company_id)
          .single()
        setCompany(companyData)
      }
    }

    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime: profile + company updates
  useEffect(() => {
    if (!currentUser?.id) return

    const profileChannel = supabase
      .channel('employee-profile-self')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${currentUser.id}`,
        },
        () => fetchData()
      )
      .subscribe()

    let companyChannel: any = null
    if (currentUser.company_id) {
      companyChannel = supabase
        .channel('employee-profile-company')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'companies',
            filter: `id=eq.${currentUser.company_id}`,
          },
          () => fetchData()
        )
        .subscribe()
    }

    return () => {
      supabase.removeChannel(profileChannel)
      if (companyChannel) supabase.removeChannel(companyChannel)
    }
  }, [currentUser?.id, currentUser?.company_id, fetchData])

  const handleSignOut = async () => {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser?.id,
        user_email: currentUser?.email,
        user_role: currentUser?.role,
        action: 'LOGOUT',
        entity: 'auth',
        details: { email: currentUser?.email },
      }),
    })
    await supabase.auth.signOut()
    router.push('/login')
  }

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
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-6 pt-10 pb-20 rounded-b-3xl shadow-lg">
        <div className="flex items-center mb-4">
          <button
            onClick={() => router.push('/employee')}
            className="text-white text-sm"
          >
            ← Back
          </button>
        </div>
        <div className="flex flex-col items-center">
          <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center text-4xl font-bold mb-3">
            {currentUser?.full_name?.charAt(0)}
          </div>
          <h1 className="text-2xl font-bold">{currentUser?.full_name}</h1>
          <p className="text-blue-100 text-sm">{currentUser?.job_title || 'Employee'}</p>
        </div>
      </div>

      <div className="px-6 -mt-10 space-y-4">

        {message && (
          <div className={`p-4 rounded-xl text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-6 border border-gray-100 space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Email</p>
            <p className="text-gray-800 mt-1">{currentUser?.email}</p>
          </div>
          {currentUser?.employee_number && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Employee Number</p>
              <p className="text-gray-800 mt-1">{currentUser.employee_number}</p>
            </div>
          )}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Company</p>
            <p className="text-gray-800 mt-1">{company?.name || '—'}</p>
          </div>
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Job Title</p>
            <p className="text-gray-800 mt-1">{currentUser?.job_title || '—'}</p>
          </div>
        </div>

        {!showPasswordForm ? (
          <button
            onClick={() => setShowPasswordForm(true)}
            className="w-full bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-200 text-gray-800 py-4 rounded-2xl font-medium transition flex items-center justify-center gap-2"
          >
            🔒 Change Password
          </button>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">Change Password</h2>
              <button
                onClick={() => {
                  setShowPasswordForm(false)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
                className="text-gray-400"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                  required
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-500 mt-1">At least 6 characters</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
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

        <button
          onClick={handleSignOut}
          className="w-full bg-white hover:bg-red-50 active:bg-red-100 border border-red-200 text-red-600 py-4 rounded-2xl font-medium transition"
        >
          Sign Out
        </button>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button
            onClick={() => router.push('/employee')}
            className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button
            onClick={() => router.push('/employee/profile')}
            className="flex flex-col items-center gap-0.5 text-blue-600"
          >
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}