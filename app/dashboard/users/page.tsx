'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_LABELS: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat'
}

const DEFAULT_WORKING_DAYS = {
  sun: false, mon: true, tue: true, wed: true, thu: true, fri: true, sat: false
}

// Pro-rata helper (mirrors server-side logic so we can preview the result)
function calculateProRata(
  fullYearEntitlement: number,
  employmentStartDate: string,
  holidayYearStartDate: string | null
): number {
  if (!fullYearEntitlement || !employmentStartDate) return fullYearEntitlement || 0

  const startDate = new Date(employmentStartDate + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const effectiveStart = startDate < today ? today : startDate

  let yearStartMonth = 0
  let yearStartDay = 1
  if (holidayYearStartDate) {
    const hys = new Date(holidayYearStartDate + 'T00:00:00')
    yearStartMonth = hys.getMonth()
    yearStartDay = hys.getDate()
  }

  let yearEnd = new Date(effectiveStart.getFullYear(), yearStartMonth, yearStartDay)
  if (yearEnd <= effectiveStart) {
    yearEnd = new Date(effectiveStart.getFullYear() + 1, yearStartMonth, yearStartDay)
  }

  const msPerDay = 1000 * 60 * 60 * 24
  const daysRemaining = Math.ceil((yearEnd.getTime() - effectiveStart.getTime()) / msPerDay)
  const yearStart = new Date(yearEnd.getFullYear() - 1, yearStartMonth, yearStartDay)
  const totalDays = Math.round((yearEnd.getTime() - yearStart.getTime()) / msPerDay)

  const proRated = (fullYearEntitlement * daysRemaining) / totalDays
  return Math.round(proRated * 2) / 2
}

export default function DashboardUsers() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [features, setFeatures] = useState<any[]>([])
  const [companyFeatures, setCompanyFeatures] = useState<any[]>([])
  const [company, setCompany] = useState<any>(null)
  const [managerTitles, setManagerTitles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [showAddForm, setShowAddForm] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [jobTitle, setJobTitle] = useState('')
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [employmentStartDate, setEmploymentStartDate] = useState('')
  const [fullYearEntitlement, setFullYearEntitlement] = useState('')
  const [holidayEntitlement, setHolidayEntitlement] = useState('')
  const [workingDays, setWorkingDays] = useState<any>(DEFAULT_WORKING_DAYS)
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([])
  const [selectedManagerTitles, setSelectedManagerTitles] = useState<string[]>([])

  // Change password modal state
  const [changePasswordUser, setChangePasswordUser] = useState<any>(null)
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('')
  const [submittingPassword, setSubmittingPassword] = useState(false)

  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)

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

    setCurrentUser(profile)

    if (profile.company_id) {
      const { data: companyData } = await supabase
        .from('companies')
        .select(`*, company_features(is_enabled, feature_id, features(id, name))`)
        .eq('id', profile.company_id)
        .single()
      setCompany(companyData)

      const enabled = companyData?.company_features?.filter((cf: any) => cf.is_enabled) || []
      setCompanyFeatures(enabled)
    }

    if (profile.role === 'manager') {
      const { data: titles } = await supabase
        .from('manager_job_titles')
        .select('job_title')
        .eq('manager_id', user.id)
      setManagerTitles(titles?.map((t: any) => t.job_title) || [])
    }

    const featuresRes = await fetch('/api/get-features')
    const featuresResult = await featuresRes.json()
    if (featuresResult.features) setFeatures(featuresResult.features)

    const usersRes = await fetch('/api/get-company-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: profile.company_id }),
    })
    const usersResult = await usersRes.json()
    if (usersResult.users) setUsers(usersResult.users)

    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime
  useEffect(() => {
    if (!currentUser?.company_id) return

    const channel = supabase
      .channel('dashboard-users-page')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `company_id=eq.${currentUser.company_id}`,
        },
        () => fetchData()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser?.company_id, fetchData])

  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'manager'

  const visibleUsers = isAdmin
    ? users.filter(u => !u.is_deleted)
    : isManager
    ? users.filter(u => !u.is_deleted && u.job_title && managerTitles.includes(u.job_title))
    : []

  const allJobTitles: string[] = Array.from(new Set<string>(
    users.filter(u => u.job_title && !u.is_deleted).map((u: any) => u.job_title)
  )).sort()

  // Live pro-rata preview
  const proRataPreview = useMemo(() => {
    if (!fullYearEntitlement || isNaN(parseFloat(fullYearEntitlement))) return null
    if (!employmentStartDate) return null
    const fy = parseFloat(fullYearEntitlement)
    return calculateProRata(fy, employmentStartDate, company?.holiday_year_start || null)
  }, [fullYearEntitlement, employmentStartDate, company?.holiday_year_start])

  const resetForm = () => {
    setFullName('')
    setEmail('')
    setPassword('')
    setRole('user')
    setJobTitle('')
    setEmployeeNumber('')
    setEmploymentStartDate('')
    setFullYearEntitlement('')
    setHolidayEntitlement('')
    setWorkingDays(DEFAULT_WORKING_DAYS)
    setSelectedFeatures([])
    setSelectedManagerTitles([])
  }

  const handleStartEdit = async (user: any) => {
    setEditingUser(user)
    setFullName(user.full_name || '')
    setEmail(user.email || '')
    setRole(user.role || 'user')
    setJobTitle(user.job_title || '')
    setEmployeeNumber(user.employee_number || '')
    setEmploymentStartDate(user.employment_start_date || '')
    setFullYearEntitlement(user.full_year_entitlement?.toString() || '')
    setHolidayEntitlement(user.holiday_entitlement?.toString() || '')
    setWorkingDays(user.working_days || DEFAULT_WORKING_DAYS)
    setSelectedFeatures(
      user.user_features?.filter((uf: any) => uf.is_enabled).map((uf: any) => uf.feature_id) || []
    )

    if (user.role === 'manager') {
      const { data: titles } = await supabase
        .from('manager_job_titles')
        .select('job_title')
        .eq('manager_id', user.id)
      setSelectedManagerTitles((titles?.map((t: any) => t.job_title) || []) as string[])
    } else {
      setSelectedManagerTitles([])
    }

    setShowAddForm(true)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName,
        email,
        password,
        role,
        company_id: currentUser.company_id,
        job_title: jobTitle,
        employee_number: employeeNumber || null,
        employment_start_date: employmentStartDate || null,
        full_year_entitlement: fullYearEntitlement ? parseFloat(fullYearEntitlement) : null,
        holiday_entitlement: holidayEntitlement ? parseFloat(holidayEntitlement) : null,
        working_days: workingDays,
        feature_ids: selectedFeatures,
        manager_job_titles: role === 'manager' ? selectedManagerTitles : [],
        actor_id: currentUser.id,
        actor_email: currentUser.email,
        actor_role: currentUser.role,
      }),
    })

    const result = await res.json()
    setSubmitting(false)

    if (!res.ok) {
      showMessage('Error: ' + result.error, 'error')
      return
    }

    const proRataMsg = result.pro_rata_entitlement !== null && result.pro_rata_entitlement !== undefined
      ? ` (pro-rata: ${result.pro_rata_entitlement} days)`
      : ''
    showMessage('User created!' + proRataMsg, 'success')
    setShowAddForm(false)
    resetForm()
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    const userFeaturesPayload = features
      .filter(f => companyFeatures.some((cf: any) => cf.feature_id === f.id))
      .map(f => ({
        feature_id: f.id,
        is_enabled: selectedFeatures.includes(f.id),
      }))

    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: editingUser.id,
        full_name: fullName,
        email: editingUser.email,
        role,
        job_title: jobTitle,
        employee_number: employeeNumber || null,
        employment_start_date: employmentStartDate || null,
        full_year_entitlement: fullYearEntitlement ? parseFloat(fullYearEntitlement) : null,
        holiday_entitlement: holidayEntitlement ? parseFloat(holidayEntitlement) : null,
        working_days: workingDays,
        user_features: userFeaturesPayload,
        manager_titles: role === 'manager' ? selectedManagerTitles : [],
        actor_id: currentUser.id,
        actor_email: currentUser.email,
        actor_role: currentUser.role,
        company_name: company?.name,
      }),
    })

    const result = await res.json()
    setSubmitting(false)

    if (!res.ok) {
      showMessage('Error: ' + result.error, 'error')
      return
    }

    showMessage('User updated!', 'success')
    setEditingUser(null)
    setShowAddForm(false)
    resetForm()
  }

  const handleToggleFreeze = async (user: any) => {
    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        toggle_freeze: !user.is_frozen,
        actor_id: currentUser.id,
        actor_email: currentUser.email,
        actor_role: currentUser.role,
      }),
    })

    if (!res.ok) {
      showMessage('Error toggling freeze', 'error')
      return
    }
    showMessage(user.is_frozen ? 'User unfrozen' : 'User frozen', 'success')
  }

  const handleDelete = async (user: any) => {
    if (!confirm(`Are you sure you want to delete ${user.full_name}? This cannot be undone.`)) return

    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        delete: true,
        actor_id: currentUser.id,
        actor_email: currentUser.email,
        actor_role: currentUser.role,
      }),
    })

    if (!res.ok) {
      showMessage('Error deleting user', 'error')
      return
    }
    showMessage('User deleted', 'success')
  }

  const handleChangeUserPassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newAdminPassword.length < 6) {
      showMessage('Password must be at least 6 characters', 'error')
      return
    }

    if (newAdminPassword !== confirmAdminPassword) {
      showMessage('Passwords do not match', 'error')
      return
    }

    setSubmittingPassword(true)

    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'admin_change',
        target_user_id: changePasswordUser.id,
        new_password: newAdminPassword,
        actor_id: currentUser.id,
        actor_email: currentUser.email,
        actor_role: currentUser.role,
      }),
    })

    const result = await res.json()
    setSubmittingPassword(false)

    if (!res.ok) {
      showMessage('Error: ' + (result.error || 'Failed to change password'), 'error')
      return
    }

    showMessage(`Password changed for ${changePasswordUser.full_name}`, 'success')
    setChangePasswordUser(null)
    setNewAdminPassword('')
    setConfirmAdminPassword('')
  }

  const toggleWorkingDay = (day: string) => {
    setWorkingDays({ ...workingDays, [day]: !workingDays[day] })
  }

  const toggleFeature = (featureId: string) => {
    setSelectedFeatures(prev =>
      prev.includes(featureId) ? prev.filter(f => f !== featureId) : [...prev, featureId]
    )
  }

  const toggleManagerTitle = (title: string) => {
    setSelectedManagerTitles(prev =>
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    )
  }

  const getRoleBadgeColor = (r: string) => {
    switch (r) {
      case 'admin': return 'bg-purple-100 text-purple-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'user': return 'bg-gray-100 text-gray-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  const showHolidayFields = companyFeatures.some((cf: any) => cf.features?.name === 'Holidays')
    && selectedFeatures.includes(features.find(f => f.name === 'Holidays')?.id)

  const holidayYearStartLabel = company?.holiday_year_start
    ? new Date(company.holiday_year_start + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
    : '1 January (default)'

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">{isAdmin ? 'Manage Users' : 'Your Team'}</p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-6">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {isAdmin && !showAddForm && (
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => {
                setShowAddForm(true)
                setEditingUser(null)
                resetForm()
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              + Add User
            </button>
            <button
              onClick={() => router.push('/dashboard/users/order')}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium transition"
            >
              ↕ Set Order
            </button>
          </div>
        )}

        {/* Add/Edit form */}
        {showAddForm && isAdmin && (
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">{editingUser ? 'Edit User' : 'Add New User'}</h2>
              <button
                onClick={() => {
                  setShowAddForm(false)
                  setEditingUser(null)
                  resetForm()
                }}
                className="text-gray-400 text-xl"
              >
                ✕
              </button>
            </div>

            <form onSubmit={editingUser ? handleUpdate : handleAdd} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    required
                    disabled={!!editingUser}
                  />
                </div>
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    required
                    minLength={6}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 bg-white"
                  >
                    <option value="user">User</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Job Title</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Employee Number <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="e.g. 27"
                  />
                </div>
              </div>

              {role === 'manager' && allJobTitles.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Job Titles This Manager Oversees</label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {allJobTitles.map(title => (
                      <label key={title} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedManagerTitles.includes(title)}
                          onChange={() => toggleManagerTitle(title)}
                          className="w-4 h-4"
                        />
                        <span className="text-sm text-gray-700">{title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Features */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Features</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {features
                    .filter(f => companyFeatures.some((cf: any) => cf.feature_id === f.id))
                    .map(feature => (
                    <label key={feature.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedFeatures.includes(feature.id)}
                        onChange={() => toggleFeature(feature.id)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-gray-700">{feature.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Holiday-specific fields */}
              {showHolidayFields && (
                <>
                  <div className="pt-4 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">🏖️ Holiday Settings</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Holiday year starts: <span className="font-medium">{holidayYearStartLabel}</span>
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Employment Start Date</label>
                        <input
                          type="date"
                          value={employmentStartDate}
                          onChange={(e) => setEmploymentStartDate(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Full Year Entitlement <span className="text-gray-400">(days/year)</span>
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={fullYearEntitlement}
                          onChange={(e) => setFullYearEntitlement(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                          placeholder="e.g. 28"
                        />
                      </div>
                    </div>

                    {!editingUser && proRataPreview !== null && (
                      <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                        <p className="font-medium text-blue-800">📐 Pro-rata calculation</p>
                        <p className="text-blue-700 mt-1">
                          Based on starting <span className="font-semibold">{new Date(employmentStartDate + 'T00:00:00').toLocaleDateString('en-GB')}</span>,
                          this employee will be granted{' '}
                          <span className="font-bold">{proRataPreview} days</span> for the rest of this holiday year.
                        </p>
                        <p className="text-xs text-blue-600 mt-1">
                          (Their full-year entitlement of {fullYearEntitlement} days will apply from the next holiday year.)
                        </p>
                      </div>
                    )}

                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Current Balance <span className="text-gray-400">(days available now)</span>
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        value={holidayEntitlement}
                        onChange={(e) => setHolidayEntitlement(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                        placeholder={!editingUser && proRataPreview !== null ? `Will default to ${proRataPreview}` : 'e.g. 28'}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {editingUser
                          ? 'Override the current balance manually if needed.'
                          : 'Leave blank to use the pro-rata value above. Override with a custom number if needed.'}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Working Days</label>
                    <div className="grid grid-cols-7 gap-2">
                      {DAY_KEYS.map(day => (
                        <label key={day} className="flex flex-col items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={workingDays[day]}
                            onChange={() => toggleWorkingDay(day)}
                            className="w-4 h-4 mb-1"
                          />
                          <span className="text-xs text-gray-600">{DAY_LABELS[day]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : (editingUser ? 'Update User' : 'Create User')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false)
                    setEditingUser(null)
                    resetForm()
                  }}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* User list */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            {isAdmin ? 'All Users' : 'Your Team'} ({visibleUsers.length})
          </h2>

          {visibleUsers.length === 0 ? (
            <p className="text-gray-400 text-sm">No users to display.</p>
          ) : (
            <ul className="space-y-2">
              {visibleUsers.map((user) => (
                <li
                  key={user.id}
                  className={`border rounded-lg p-4 ${
                    user.is_frozen ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-800">{user.full_name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadgeColor(user.role)}`}>
                          {user.role}
                        </span>
                        {user.employee_number && (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                            {user.employee_number}
                          </span>
                        )}
                        {user.job_title && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {user.job_title}
                          </span>
                        )}
                        {user.is_frozen && (
                          <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">Frozen</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{user.email}</p>
                      {user.holiday_entitlement !== null && user.holiday_entitlement !== undefined && (
                        <p className="text-xs text-gray-500 mt-1">
                          🏖️ {user.holiday_entitlement} days
                          {user.full_year_entitlement && user.full_year_entitlement !== user.holiday_entitlement && (
                            <span className="text-gray-400"> (full year: {user.full_year_entitlement})</span>
                          )}
                        </p>
                      )}
                    </div>

                    {isAdmin && user.id !== currentUser.id && (
                      <div className="flex flex-wrap gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleStartEdit(user)}
                          className="text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            setChangePasswordUser(user)
                            setNewAdminPassword('')
                            setConfirmAdminPassword('')
                          }}
                          className="text-sm bg-yellow-100 hover:bg-yellow-200 text-yellow-700 px-3 py-1 rounded transition"
                        >
                          🔒 Password
                        </button>
                        <button
                          onClick={() => handleToggleFreeze(user)}
                          className="text-sm bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-1 rounded transition"
                        >
                          {user.is_frozen ? 'Unfreeze' : 'Freeze'}
                        </button>
                        <button
                          onClick={() => handleDelete(user)}
                          className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded transition"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Change password modal */}
        {changePasswordUser && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
              <div className="p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Change Password</h2>
                    <p className="text-sm text-gray-500 mt-1">For {changePasswordUser.full_name}</p>
                  </div>
                  <button
                    onClick={() => {
                      setChangePasswordUser(null)
                      setNewAdminPassword('')
                      setConfirmAdminPassword('')
                    }}
                    className="text-gray-400 text-2xl leading-none"
                  >
                    ×
                  </button>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
                  ⚠️ This will immediately change their password. Make sure to communicate it securely to the user.
                </div>

                <form onSubmit={handleChangeUserPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                    <input
                      type="text"
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-gray-500 mt-1">At least 6 characters</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                    <input
                      type="text"
                      value={confirmAdminPassword}
                      onChange={(e) => setConfirmAdminPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setChangePasswordUser(null)
                        setNewAdminPassword('')
                        setConfirmAdminPassword('')
                      }}
                      className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-lg font-medium transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingPassword}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
                    >
                      {submittingPassword ? 'Changing...' : 'Change Password'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
