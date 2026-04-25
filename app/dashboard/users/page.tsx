'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

const DAYS_OF_WEEK = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const DEFAULT_WORKING_DAYS = {
  sun: false, mon: true, tue: true, wed: true, thu: true, fri: true, sat: false
}

const calculateProRata = (
  fullEntitlement: number,
  startDate: string,
  holidayYearStart: string
): number => {
  if (!fullEntitlement || !startDate || !holidayYearStart) return 0

  const start = new Date(startDate)
  const yearStartMonth = new Date(holidayYearStart).getMonth()
  const yearStartDay = new Date(holidayYearStart).getDate()

  let yearStart = new Date(start.getFullYear(), yearStartMonth, yearStartDay)
  if (yearStart > start) {
    yearStart = new Date(start.getFullYear() - 1, yearStartMonth, yearStartDay)
  }

  const yearEnd = new Date(yearStart.getFullYear() + 1, yearStartMonth, yearStartDay)
  yearEnd.setDate(yearEnd.getDate() - 1)

  const totalDaysInYear = Math.ceil((yearEnd.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const remainingDays = Math.ceil((yearEnd.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

  if (remainingDays <= 0) return 0

  const proRata = (fullEntitlement * remainingDays) / totalDaysInYear
  return Math.round(proRata * 2) / 2
}

export default function DashboardUsersPage() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [companyFeatures, setCompanyFeatures] = useState<string[]>([])
  const [features, setFeatures] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [managerTitles, setManagerTitles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [newJobTitle, setNewJobTitle] = useState('')
  const [newUserFeatures, setNewUserFeatures] = useState<Record<string, boolean>>({})
  const [newManagerTitles, setNewManagerTitles] = useState<string[]>([])
  const [newEmploymentStart, setNewEmploymentStart] = useState('')
  const [newFullEntitlement, setNewFullEntitlement] = useState('')
  const [newCalculatedEntitlement, setNewCalculatedEntitlement] = useState('')
  const [newOverrideEntitlement, setNewOverrideEntitlement] = useState('')
  const [newWorkingDays, setNewWorkingDays] = useState(DEFAULT_WORKING_DAYS)

  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editJobTitle, setEditJobTitle] = useState('')
  const [editUserFeatures, setEditUserFeatures] = useState<Record<string, boolean>>({})
  const [editManagerTitles, setEditManagerTitles] = useState<string[]>([])
  const [editEmploymentStart, setEditEmploymentStart] = useState('')
  const [editEntitlement, setEditEntitlement] = useState('')
  const [editWorkingDays, setEditWorkingDays] = useState(DEFAULT_WORKING_DAYS)

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
        .select(`
          *,
          company_features (
            is_enabled,
            feature_id
          )
        `)
        .eq('id', profile.company_id)
        .single()
      if (companyData) {
        setCompany(companyData)
        const enabledFeatureIds = companyData.company_features
          ?.filter((cf: any) => cf.is_enabled)
          .map((cf: any) => cf.feature_id) || []
        setCompanyFeatures(enabledFeatureIds)
        const defaults: Record<string, boolean> = {}
        enabledFeatureIds.forEach((id: string) => { defaults[id] = false })
        setNewUserFeatures(defaults)
      }
    }

    const featRes = await fetch('/api/get-features')
    const featResult = await featRes.json()
    if (featResult.features) setFeatures(featResult.features)

    if (profile.role === 'manager') {
      const { data: titles } = await supabase
        .from('manager_job_titles')
        .select('job_title')
        .eq('manager_id', user.id)
      setManagerTitles(titles?.map((t: any) => t.job_title) || [])
    }

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

  useEffect(() => {
    if (newFullEntitlement && newEmploymentStart && company?.holiday_year_start) {
      const calculated = calculateProRata(
        parseFloat(newFullEntitlement),
        newEmploymentStart,
        company.holiday_year_start
      )
      setNewCalculatedEntitlement(calculated.toString())
    } else {
      setNewCalculatedEntitlement('')
    }
  }, [newFullEntitlement, newEmploymentStart, company])

  const visibleUsers = currentUser?.role === 'admin'
    ? users
    : currentUser?.role === 'manager'
    ? users.filter(u => u.job_title && managerTitles.includes(u.job_title))
    : []

  const jobTitles = [...new Set(
    users
      .filter(u => u.role !== 'admin')
      .map(u => u.job_title)
      .filter(Boolean)
  )] as string[]

  const allJobTitles = [...new Set(users.map(u => u.job_title).filter(Boolean))] as string[]

  const toggleNewManagerTitle = (title: string) => {
    if (newManagerTitles.includes(title)) {
      setNewManagerTitles(newManagerTitles.filter(t => t !== title))
    } else {
      setNewManagerTitles([...newManagerTitles, title])
    }
  }

  const toggleEditManagerTitle = (title: string) => {
    if (editManagerTitles.includes(title)) {
      setEditManagerTitles(editManagerTitles.filter(t => t !== title))
    } else {
      setEditManagerTitles([...editManagerTitles, title])
    }
  }

  const userHasHolidaysFeature = (featuresState: Record<string, boolean>) => {
    const holidaysFeature = features.find(f => f.name === 'Holidays')
    if (!holidaysFeature) return false
    return featuresState[holidaysFeature.id] === true
  }

  const companyHasHolidaysFeature = () => {
    const holidaysFeature = features.find(f => f.name === 'Holidays')
    if (!holidaysFeature) return false
    return companyFeatures.includes(holidaysFeature.id)
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()

    const finalEntitlement = newOverrideEntitlement
      ? parseFloat(newOverrideEntitlement)
      : newCalculatedEntitlement
      ? parseFloat(newCalculatedEntitlement)
      : null

    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newEmail,
        password: newPassword,
        full_name: newName,
        role: newRole,
        job_title: newJobTitle,
        company_id: currentUser?.company_id,
        employment_start_date: newEmploymentStart || null,
        holiday_entitlement: finalEntitlement,
        working_days: newWorkingDays,
        user_features: newRole === 'admin'
          ? companyFeatures.map(id => ({ feature_id: id, is_enabled: true }))
          : companyFeatures.map(id => ({ feature_id: id, is_enabled: newUserFeatures[id] || false })),
        manager_titles: newRole === 'manager' ? newManagerTitles : [],
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      showMessage('Error creating user: ' + result.error, 'error')
      return
    }

    showMessage('User created successfully!', 'success')
    setNewName('')
    setNewEmail('')
    setNewPassword('')
    setNewRole('user')
    setNewJobTitle('')
    setNewManagerTitles([])
    setNewEmploymentStart('')
    setNewFullEntitlement('')
    setNewCalculatedEntitlement('')
    setNewOverrideEntitlement('')
    setNewWorkingDays(DEFAULT_WORKING_DAYS)
    const defaults: Record<string, boolean> = {}
    companyFeatures.forEach(id => { defaults[id] = false })
    setNewUserFeatures(defaults)
    setShowAddForm(false)
    fetchData()
  }

  const handleEditUser = async (user: any) => {
    setEditingUser(user)
    setEditName(user.full_name)
    setEditEmail(user.email)
    setEditRole(user.role)
    setEditJobTitle(user.job_title || '')
    setEditEmploymentStart(user.employment_start_date || '')
    setEditEntitlement(user.holiday_entitlement?.toString() || '')
    setEditWorkingDays(user.working_days || DEFAULT_WORKING_DAYS)

    const featureState: Record<string, boolean> = {}
    companyFeatures.forEach(id => { featureState[id] = false })
    user.user_features?.forEach((uf: any) => {
      featureState[uf.feature_id] = uf.is_enabled
    })
    setEditUserFeatures(featureState)

    const { data: titles } = await supabase
      .from('manager_job_titles')
      .select('job_title')
      .eq('manager_id', user.id)
    setEditManagerTitles(titles?.map((m: any) => m.job_title) || [])
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()

    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: editingUser.id,
        full_name: editName,
        email: editEmail,
        role: editRole,
        job_title: editJobTitle,
        employment_start_date: editEmploymentStart || null,
        holiday_entitlement: editEntitlement ? parseFloat(editEntitlement) : null,
        working_days: editWorkingDays,
        user_features: editRole === 'admin'
          ? companyFeatures.map(id => ({ feature_id: id, is_enabled: true }))
          : companyFeatures.map(id => ({ feature_id: id, is_enabled: editUserFeatures[id] || false })),
        manager_titles: editRole === 'manager' ? editManagerTitles : [],
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
        company_name: company?.name,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      showMessage('Error updating user: ' + result.error, 'error')
      return
    }

    showMessage('User updated successfully!', 'success')
    setEditingUser(null)
    fetchData()
  }

  const handleFreeze = async (user: any) => {
    const { error } = await supabase
      .from('profiles')
      .update({ is_frozen: !user.is_frozen })
      .eq('id', user.id)

    if (error) {
      showMessage('Error updating user', 'error')
      return
    }

    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser?.id,
        user_email: currentUser?.email,
        user_role: currentUser?.role,
        action: user.is_frozen ? 'UNFREEZE_COMPANY_USER' : 'FREEZE_COMPANY_USER',
        entity: 'profile',
        entity_id: user.id,
        details: { company_id: currentUser?.company_id, company_name: company?.name, email: user.email },
      }),
    })

    showMessage(user.is_frozen ? 'User unfrozen' : 'User frozen', 'success')
    fetchData()
  }

  const handleSoftDelete = async (user: any) => {
    const confirmed = confirm(`Remove ${user.full_name} from ${company?.name}?`)
    if (!confirmed) return

    const { error } = await supabase
      .from('profiles')
      .update({ is_deleted: true })
      .eq('id', user.id)

    if (error) {
      showMessage('Error removing user', 'error')
      return
    }

    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser?.id,
        user_email: currentUser?.email,
        user_role: currentUser?.role,
        action: 'REMOVE_COMPANY_USER',
        entity: 'profile',
        entity_id: user.id,
        details: { company_id: currentUser?.company_id, company_name: company?.name, email: user.email },
      }),
    })

    showMessage('User removed successfully', 'success')
    fetchData()
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-purple-100 text-purple-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'user': return 'bg-gray-100 text-gray-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getFeatureName = (featureId: string) => {
    return features.find(f => f.id === featureId)?.name || featureId
  }

  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'manager'

  const renderFeatureSelector = (
    role: string,
    userFeatures: Record<string, boolean>,
    setUserFeatures: (f: Record<string, boolean>) => void
  ) => {
    if (companyFeatures.length === 0) {
      return <p className="text-sm text-gray-400">No features enabled for this company.</p>
    }

    if (role === 'admin') {
      return (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <p className="text-sm text-purple-700 font-medium">
            ✓ Admins automatically get access to all company features
          </p>
        </div>
      )
    }

    return (
      <div className="grid grid-cols-2 gap-2">
        {companyFeatures.map(id => (
          <label
            key={id}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
              userFeatures[id]
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="checkbox"
              checked={userFeatures[id] || false}
              onChange={(e) => setUserFeatures({ ...userFeatures, [id]: e.target.checked })}
              className="w-4 h-4 text-blue-600"
            />
            <p className="text-sm font-medium text-gray-800">{getFeatureName(id)}</p>
          </label>
        ))}
      </div>
    )
  }

  const renderManagerTitles = (
    selectedTitles: string[],
    toggleTitle: (s: string) => void
  ) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Can manage staff with these job titles
      </label>
      {jobTitles.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          No job titles exist yet. Create users with job titles first.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {jobTitles.map(title => (
            <label
              key={title}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                selectedTitles.includes(title)
                  ? 'border-blue-400 bg-blue-100'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedTitles.includes(title)}
                onChange={() => toggleTitle(title)}
                className="w-4 h-4 text-blue-600"
              />
              <p className="text-sm font-medium text-gray-800">{title}</p>
            </label>
          ))}
        </div>
      )}
    </div>
  )

  const renderWorkingDays = (
    workingDays: any,
    setWorkingDays: (d: any) => void
  ) => (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
      <h4 className="font-semibold text-blue-800 text-sm">📅 Working Days</h4>
      <p className="text-xs text-blue-700">
        Tick the days this employee normally works. Holidays will only deduct on these days.
      </p>
      <div className="flex gap-2 flex-wrap">
        {DAYS_OF_WEEK.map(day => (
          <button
            key={day.key}
            type="button"
            onClick={() => setWorkingDays({ ...workingDays, [day.key]: !workingDays[day.key] })}
            className={`px-4 py-2 rounded-lg border-2 font-medium text-sm transition ${
              workingDays[day.key]
                ? 'bg-blue-500 border-blue-500 text-white'
                : 'bg-white border-gray-300 text-gray-600'
            }`}
          >
            {day.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-blue-700">
        Working {Object.values(workingDays).filter(Boolean).length} days per week
      </p>
    </div>
  )

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  const showHolidayFields = companyHasHolidaysFeature() && (newRole === 'admin' || userHasHolidaysFeature(newUserFeatures))
  const showEditHolidayFields = companyHasHolidaysFeature() && (editRole === 'admin' || userHasHolidaysFeature(editUserFeatures))

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">South Lincs Systems</p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">

        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">
            {isAdmin ? 'User Management' : 'Your Team'}
          </h2>
          {isAdmin && (
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              {showAddForm ? 'Cancel' : '+ Add User'}
            </button>
          )}
        </div>

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {isManager && managerTitles.length === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <p className="text-yellow-800 text-sm">
              No job titles have been assigned to you yet. Ask your admin to assign you some.
            </p>
          </div>
        )}

        {isManager && managerTitles.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-blue-800 text-sm">
              You manage staff with these job titles:{' '}
              <span className="font-medium">{managerTitles.join(', ')}</span>
            </p>
          </div>
        )}

        {isAdmin && showAddForm && (
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">New User</h3>
            <form onSubmit={handleAddUser} className="space-y-4" autoComplete="off">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoComplete="off"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Job Title</label>
                  <input
                    type="text"
                    value={newJobTitle}
                    onChange={(e) => setNewJobTitle(e.target.value)}
                    placeholder="e.g. Driver, Cleaner"
                    list="add-job-titles"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoComplete="off"
                  />
                  {allJobTitles.length > 0 && (
                    <datalist id="add-job-titles">
                      {allJobTitles.map(t => <option key={t} value={t} />)}
                    </datalist>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="off"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="new-password"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employment Start Date</label>
                <input
                  type="date"
                  value={newEmploymentStart}
                  onChange={(e) => setNewEmploymentStart(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => {
                    setNewRole(e.target.value)
                    setNewManagerTitles([])
                  }}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="user">User</option>
                </select>
              </div>

              {newRole === 'manager' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  {renderManagerTitles(newManagerTitles, toggleNewManagerTitle)}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Feature Access</label>
                {renderFeatureSelector(newRole, newUserFeatures, setNewUserFeatures)}
              </div>

              {renderWorkingDays(newWorkingDays, setNewWorkingDays)}

              {showHolidayFields && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-4">
                  <h4 className="font-semibold text-yellow-800">🏖️ Holiday Entitlement</h4>

                  {!company?.holiday_year_start && (
                    <p className="text-sm text-yellow-700 italic">
                      ⚠️ Set the company holiday year start date first to enable auto-calculation.
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Annual Entitlement
                        <span className="ml-1 text-xs text-gray-400">(full year days)</span>
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={newFullEntitlement}
                        onChange={(e) => setNewFullEntitlement(e.target.value)}
                        placeholder="e.g. 25"
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Pro-Rata This Year
                        <span className="ml-1 text-xs text-gray-400">(auto-calculated)</span>
                      </label>
                      <input
                        type="text"
                        value={newCalculatedEntitlement ? `${newCalculatedEntitlement} days` : ''}
                        disabled
                        placeholder="—"
                        className="w-full border border-gray-200 rounded-lg px-4 py-2 bg-gray-50 text-gray-700 font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Override Pro-Rata
                      <span className="ml-1 text-xs text-gray-400">(optional - leave blank to use calculated amount)</span>
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={newOverrideEntitlement}
                      onChange={(e) => setNewOverrideEntitlement(e.target.value)}
                      placeholder="Leave blank to use calculated amount"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-medium"
              >
                Create User
              </button>
            </form>
          </div>
        )}

        {isAdmin && editingUser && (
          <div className="bg-white rounded-xl shadow p-6 border-l-4 border-blue-500">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Edit — {editingUser.full_name}</h3>
            <form onSubmit={handleSaveEdit} className="space-y-4" autoComplete="off">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoComplete="off"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Job Title</label>
                  <input
                    type="text"
                    value={editJobTitle}
                    onChange={(e) => setEditJobTitle(e.target.value)}
                    list="edit-job-titles"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoComplete="off"
                  />
                  {allJobTitles.length > 0 && (
                    <datalist id="edit-job-titles">
                      {allJobTitles.map(t => <option key={t} value={t} />)}
                    </datalist>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="off"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employment Start Date</label>
                <input
                  type="date"
                  value={editEmploymentStart}
                  onChange={(e) => setEditEmploymentStart(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => {
                    setEditRole(e.target.value)
                    setEditManagerTitles([])
                  }}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="user">User</option>
                </select>
              </div>

              {editRole === 'manager' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  {renderManagerTitles(editManagerTitles, toggleEditManagerTitle)}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Feature Access</label>
                {renderFeatureSelector(editRole, editUserFeatures, setEditUserFeatures)}
              </div>

              {renderWorkingDays(editWorkingDays, setEditWorkingDays)}

              {showEditHolidayFields && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h4 className="font-semibold text-yellow-800 mb-3">🏖️ Holiday Entitlement</h4>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Days Remaining This Year
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={editEntitlement}
                      onChange={(e) => setEditEntitlement(e.target.value)}
                      placeholder="e.g. 12.5"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            {isAdmin ? `All Users (${visibleUsers.length})` : `Your Team (${visibleUsers.length})`}
          </h3>
          {visibleUsers.length === 0 ? (
            <p className="text-gray-400">No users to display.</p>
          ) : (
            <ul className="space-y-3">
              {visibleUsers.map((user) => (
                <li
                  key={user.id}
                  className={`border rounded-xl p-4 ${
                    user.is_frozen ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-800">{user.full_name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadgeColor(user.role)}`}>
                          {user.role}
                        </span>
                        {user.job_title && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {user.job_title}
                          </span>
                        )}
                        {user.holiday_entitlement !== null && user.holiday_entitlement !== undefined && (
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                            🏖️ {user.holiday_entitlement} days
                          </span>
                        )}
                        {user.is_frozen && (
                          <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">Frozen</span>
                        )}
                        {user.id === currentUser?.id && (
                          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">You</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">{user.email}</p>
                      {user.user_features && user.user_features.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {user.role === 'admin' ? (
                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                              All features
                            </span>
                          ) : (
                            user.user_features
                              .filter((uf: any) => uf.is_enabled)
                              .map((uf: any) => (
                                <span key={uf.feature_id} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                  {getFeatureName(uf.feature_id)}
                                </span>
                              ))
                          )}
                        </div>
                      )}
                    </div>

                    {isAdmin && user.id !== currentUser?.id && (
                      <div className="flex gap-2 ml-4 flex-shrink-0">
                        <button
                          onClick={() => handleEditUser(user)}
                          className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleFreeze(user)}
                          className={`text-sm px-3 py-1.5 rounded-lg transition ${
                            user.is_frozen
                              ? 'bg-green-100 hover:bg-green-200 text-green-700'
                              : 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                          }`}
                        >
                          {user.is_frozen ? 'Unfreeze' : 'Freeze'}
                        </button>
                        <button
                          onClick={() => handleSoftDelete(user)}
                          className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg transition"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}