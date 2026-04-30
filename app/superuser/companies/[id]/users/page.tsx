'use client'

/**
 * /superuser/companies/[id]/users
 *
 * Users page with HR custom fields integration.
 *
 * On top of the basic users page, this version:
 *   • Adds a ⚙️ button next to "+ Add User" that opens HRFieldsManager
 *   • Loads the company's HR field definitions
 *   • Renders HRFieldsPanel inside both the add and edit forms
 *   • Validates required HR fields before saving
 *   • Sends extra_fields through to /api/create-user and /api/update-user
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import HRFieldsManager, { type HRFieldDef } from '@/components/HRFieldsManager'
import HRFieldsPanel, { validateHRFields } from '@/components/HRFieldsPanel'

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
  sun: false, mon: true, tue: true, wed: true, thu: true, fri: true, sat: false,
}

type Feature = { id: string; slug: string; name: string }

type User = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  job_title: string | null
  employee_number: string | null
  employment_start_date: string | null
  holiday_entitlement: number | null
  full_year_entitlement: number | null
  working_days: any
  is_frozen: boolean
  extra_fields: Record<string, any> | null
  user_features: { feature_id: string; is_enabled: boolean; can_view: boolean; can_edit: boolean; can_view_reports: boolean }[]
  manager_titles: string[]
}

const calculateProRata = (
  fullEntitlement: number,
  startDate: string,
  holidayYearStart: string,
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
  const totalDays    = Math.ceil((yearEnd.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const remainingDays = Math.ceil((yearEnd.getTime() - start.getTime())     / (1000 * 60 * 60 * 24)) + 1
  if (remainingDays <= 0) return 0
  return Math.round((fullEntitlement * remainingDays / totalDays) * 2) / 2
}

const HOLIDAYS_SLUG = 'holidays'

export default function CompanyUsersPage() {
  const router = useRouter()
  const params = useParams()
  const companyId = params?.id as string

  const [company, setCompany] = useState<any>(null)
  const [users, setUsers] = useState<User[]>([])
  const [features, setFeatures] = useState<Feature[]>([])
  const [companyFeatureIds, setCompanyFeatureIds] = useState<string[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)

  // HR fields
  const [hrFields, setHrFields] = useState<HRFieldDef[]>([])
  const [showHrSettings, setShowHrSettings] = useState(false)

  const [showAddForm, setShowAddForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Add form state
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [newJobTitle, setNewJobTitle] = useState('')
  const [newEmployeeNumber, setNewEmployeeNumber] = useState('')
  const [newEmploymentStart, setNewEmploymentStart] = useState('')
  const [newFullEntitlement, setNewFullEntitlement] = useState('')
  const [newCalculatedEntitlement, setNewCalculatedEntitlement] = useState('')
  const [newOverrideEntitlement, setNewOverrideEntitlement] = useState('')
  const [newWorkingDays, setNewWorkingDays] = useState<any>(DEFAULT_WORKING_DAYS)
  const [newUserFeatures, setNewUserFeatures] = useState<Record<string, boolean>>({})
  const [newManagerTitles, setNewManagerTitles] = useState<string[]>([])
  const [newExtraFields, setNewExtraFields] = useState<Record<string, any>>({})

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editJobTitle, setEditJobTitle] = useState('')
  const [editEmployeeNumber, setEditEmployeeNumber] = useState('')
  const [editEmploymentStart, setEditEmploymentStart] = useState('')
  const [editEntitlement, setEditEntitlement] = useState('')
  const [editWorkingDays, setEditWorkingDays] = useState<any>(DEFAULT_WORKING_DAYS)
  const [editUserFeatures, setEditUserFeatures] = useState<Record<string, boolean>>({})
  const [editManagerTitles, setEditManagerTitles] = useState<string[]>([])
  const [editExtraFields, setEditExtraFields] = useState<Record<string, any>>({})

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  // ─── Loaders ────────────────────────────────────────────────
  const fetchCurrentUser = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, role, full_name')
        .eq('id', user.id)
        .single()
      setCurrentUser(profile)
    }
  }, [])

  const fetchFeatures = useCallback(async () => {
    const res = await fetch('/api/list-features')
    const data = await res.json()
    if (Array.isArray(data.features)) setFeatures(data.features)
  }, [])

  const fetchCompany = useCallback(async () => {
    const res = await fetch(`/api/get-company?id=${encodeURIComponent(companyId)}`)
    const data = await res.json()
    if (res.ok) {
      setCompany(data.company)
      setCompanyFeatureIds(data.enabled_feature_ids || [])
      const defaults: Record<string, boolean> = {}
      ;(data.enabled_feature_ids || []).forEach((id: string) => { defaults[id] = false })
      setNewUserFeatures(defaults)
    }
  }, [companyId])

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/api/get-company-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId }),
    })
    const data = await res.json()
    if (res.ok && Array.isArray(data.users)) setUsers(data.users)
  }, [companyId])

  const fetchHrFields = useCallback(async () => {
    const res = await fetch(`/api/company-user-fields?company_id=${companyId}`)
    const data = await res.json()
    if (res.ok && Array.isArray(data.fields)) setHrFields(data.fields)
  }, [companyId])

  useEffect(() => {
    fetchCurrentUser()
    fetchFeatures()
    fetchCompany()
    fetchUsers()
    fetchHrFields()
  }, [fetchCurrentUser, fetchFeatures, fetchCompany, fetchUsers, fetchHrFields])

  useEffect(() => {
    if (newFullEntitlement && newEmploymentStart && company?.holiday_year_start) {
      const calc = calculateProRata(
        parseFloat(newFullEntitlement),
        newEmploymentStart,
        company.holiday_year_start,
      )
      setNewCalculatedEntitlement(calc.toString())
    } else {
      setNewCalculatedEntitlement('')
    }
  }, [newFullEntitlement, newEmploymentStart, company])

  // ─── Derived ────────────────────────────────────────────────
  const featureById = (id: string) => features.find(f => f.id === id)
  const featureBySlug = (slug: string) => features.find(f => f.slug === slug)
  const holidaysFeature = featureBySlug(HOLIDAYS_SLUG)
  const companyHasHolidays = !!holidaysFeature && companyFeatureIds.includes(holidaysFeature.id)
  const userHasHolidaysFeature = (state: Record<string, boolean>) =>
    holidaysFeature ? !!state[holidaysFeature.id] : false
  const showHolidayFieldsNew  = companyHasHolidays && (newRole === 'admin'  || userHasHolidaysFeature(newUserFeatures))
  const showHolidayFieldsEdit = companyHasHolidays && (editRole === 'admin' || userHasHolidaysFeature(editUserFeatures))

  const jobTitles = Array.from(new Set(
    users.filter(u => u.role !== 'admin').map(u => u.job_title).filter(Boolean) as string[]
  ))
  const allJobTitles = Array.from(new Set(
    users.map(u => u.job_title).filter(Boolean) as string[]
  ))

  const adminCount   = users.filter(u => u.role === 'admin').length
  const managerCount = users.filter(u => u.role === 'manager').length
  const userCount    = users.filter(u => u.role === 'user').length
  const frozenCount  = users.filter(u => u.is_frozen).length

  const toggleNewManagerTitle = (title: string) => {
    setNewManagerTitles(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title])
  }
  const toggleEditManagerTitle = (title: string) => {
    setEditManagerTitles(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title])
  }

  const resetAddForm = () => {
    setNewName('')
    setNewEmail('')
    setNewPassword('')
    setNewRole('user')
    setNewJobTitle('')
    setNewEmployeeNumber('')
    setNewEmploymentStart('')
    setNewFullEntitlement('')
    setNewCalculatedEntitlement('')
    setNewOverrideEntitlement('')
    setNewWorkingDays(DEFAULT_WORKING_DAYS)
    setNewManagerTitles([])
    setNewExtraFields({})
    const defaults: Record<string, boolean> = {}
    companyFeatureIds.forEach(id => { defaults[id] = false })
    setNewUserFeatures(defaults)
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate required HR fields
    const hrErr = validateHRFields(hrFields, newExtraFields)
    if (hrErr) {
      showMessage(hrErr, 'error')
      return
    }

    const finalEntitlement = newOverrideEntitlement
      ? parseFloat(newOverrideEntitlement)
      : (newCalculatedEntitlement ? parseFloat(newCalculatedEntitlement) : null)

    const buildFeatures = () => {
      if (newRole === 'admin') {
        return companyFeatureIds.map(id => ({
          feature_id: id, is_enabled: true, can_view: true, can_edit: true, can_view_reports: true,
        }))
      }
      return companyFeatureIds.map(id => ({
        feature_id: id,
        is_enabled: !!newUserFeatures[id],
        can_view: !!newUserFeatures[id],
        can_edit: !!newUserFeatures[id],
        can_view_reports: false,
      }))
    }

    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newEmail,
        password: newPassword,
        full_name: newName,
        role: newRole,
        company_id: companyId,
        job_title: newJobTitle || null,
        employee_number: newEmployeeNumber || null,
        employment_start_date: newEmploymentStart || null,
        holiday_entitlement: finalEntitlement,
        full_year_entitlement: newFullEntitlement ? parseFloat(newFullEntitlement) : null,
        working_days: newWorkingDays,
        user_features: buildFeatures(),
        manager_titles: newRole === 'manager' ? newManagerTitles : [],
        extra_fields: newExtraFields,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error creating user: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage('User created', 'success')
    resetAddForm()
    setShowAddForm(false)
    fetchUsers()
  }

  const startEdit = (u: User) => {
    setEditingUser(u)
    setEditName(u.full_name || '')
    setEditEmail(u.email || '')
    setEditRole(u.role || 'user')
    setEditJobTitle(u.job_title || '')
    setEditEmployeeNumber(u.employee_number || '')
    setEditEmploymentStart(u.employment_start_date || '')
    setEditEntitlement(u.holiday_entitlement?.toString() || '')
    setEditWorkingDays(u.working_days || DEFAULT_WORKING_DAYS)
    const featureState: Record<string, boolean> = {}
    companyFeatureIds.forEach(id => { featureState[id] = false })
    u.user_features?.forEach(uf => { featureState[uf.feature_id] = !!uf.is_enabled })
    setEditUserFeatures(featureState)
    setEditManagerTitles(u.manager_titles || [])
    setEditExtraFields(u.extra_fields || {})
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return

    // Validate required HR fields
    const hrErr = validateHRFields(hrFields, editExtraFields)
    if (hrErr) {
      showMessage(hrErr, 'error')
      return
    }

    const buildFeatures = () => {
      if (editRole === 'admin') {
        return companyFeatureIds.map(id => ({
          feature_id: id, is_enabled: true, can_view: true, can_edit: true, can_view_reports: true,
        }))
      }
      return companyFeatureIds.map(id => ({
        feature_id: id,
        is_enabled: !!editUserFeatures[id],
        can_view: !!editUserFeatures[id],
        can_edit: !!editUserFeatures[id],
        can_view_reports: false,
      }))
    }

    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: editingUser.id,
        full_name: editName,
        email: editEmail,
        role: editRole,
        job_title: editJobTitle || null,
        employee_number: editEmployeeNumber || null,
        employment_start_date: editEmploymentStart || null,
        holiday_entitlement: editEntitlement ? parseFloat(editEntitlement) : null,
        working_days: editWorkingDays,
        user_features: buildFeatures(),
        manager_titles: editRole === 'manager' ? editManagerTitles : [],
        extra_fields: editExtraFields,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
        company_name: company?.name,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error updating user: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage('User updated', 'success')
    setEditingUser(null)
    fetchUsers()
  }

  const handleFreeze = async (u: User) => {
    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: u.id,
        toggle_freeze: !u.is_frozen,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
        company_name: company?.name,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage(u.is_frozen ? 'User unfrozen' : 'User frozen', 'success')
    fetchUsers()
  }

  const handleSoftDelete = async (u: User) => {
    if (!confirm(`Remove ${u.full_name || u.email} from ${company?.name || 'this company'}?\n\nThe user can be recovered later.`)) return
    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: u.id,
        delete: true,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
        company_name: company?.name,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      showMessage('Error: ' + (data.error || 'unknown'), 'error')
      return
    }
    showMessage('User removed', 'success')
    fetchUsers()
  }

  // ─── Render helpers ─────────────────────────────────────────
  const roleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':   return 'bg-purple-100 text-purple-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'user':    return 'bg-slate-100 text-slate-700'
      default:        return 'bg-slate-100 text-slate-700'
    }
  }

  const renderFeatureSelector = (
    role: string,
    state: Record<string, boolean>,
    setState: (s: Record<string, boolean>) => void,
  ) => {
    if (companyFeatureIds.length === 0) {
      return <p className="text-sm text-slate-400 italic">No features enabled for this company.</p>
    }
    if (role === 'admin') {
      return (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-700">
          ✓ Admins automatically get access to all company features
        </div>
      )
    }
    return (
      <div className="grid grid-cols-2 gap-2">
        {companyFeatureIds.map(id => {
          const f = featureById(id)
          const enabled = !!state[id]
          return (
            <label
              key={id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                enabled ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setState({ ...state, [id]: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-slate-800">{f?.name || id}</span>
            </label>
          )
        })}
      </div>
    )
  }

  const renderManagerTitles = (selected: string[], toggle: (s: string) => void) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">
        Can manage staff with these job titles
      </label>
      {jobTitles.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No non-admin job titles exist yet. Add users with job titles first.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {jobTitles.map(title => (
            <label
              key={title}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                selected.includes(title)
                  ? 'border-blue-400 bg-blue-100'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.includes(title)}
                onChange={() => toggle(title)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-slate-800">{title}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )

  const renderWorkingDays = (state: any, setState: (d: any) => void) => (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
      <h4 className="text-sm font-semibold text-blue-800">📅 Working Days</h4>
      <p className="text-xs text-blue-700">
        Tick the days this employee normally works. Holidays will only deduct on these days.
      </p>
      <div className="flex flex-wrap gap-2">
        {DAYS_OF_WEEK.map(day => (
          <button
            key={day.key}
            type="button"
            onClick={() => setState({ ...state, [day.key]: !state[day.key] })}
            className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition ${
              state[day.key]
                ? 'bg-blue-500 border-blue-500 text-white'
                : 'bg-white border-slate-300 text-slate-600'
            }`}
          >
            {day.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-blue-700">
        Working {Object.values(state).filter(Boolean).length} days per week
      </p>
    </div>
  )

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-5xl">
      <button
        onClick={() => router.push(`/superuser/companies/edit/${companyId}`)}
        className="text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        ← Back to company
      </button>

      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        Users — {company?.name || 'Loading…'}
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{users.length}</p>
          <p className="text-xs text-slate-500 mt-1">Total Users</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-purple-600">{adminCount}</p>
          <p className="text-xs text-slate-500 mt-1">Admins</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{managerCount}</p>
          <p className="text-xs text-slate-500 mt-1">Managers</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-slate-600">{userCount}</p>
          <p className="text-xs text-slate-500 mt-1">Users</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-slate-800">
          Users
          {frozenCount > 0 && (
            <span className="text-sm font-normal text-orange-500 ml-2">({frozenCount} frozen)</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHrSettings(true)}
            title="HR Information settings — define custom fields for this company"
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg transition"
          >
            ⚙️
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg transition"
          >
            {showAddForm ? 'Cancel' : '+ Add User'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
          messageType === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {message}
        </div>
      )}

      {/* ADD FORM */}
      {showAddForm && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">New User</h3>
          <form onSubmit={handleAddUser} className="space-y-4" autoComplete="off">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Job Title</label>
                <input type="text" value={newJobTitle} onChange={e => setNewJobTitle(e.target.value)}
                  list="add-job-titles" placeholder="e.g. Driver"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {allJobTitles.length > 0 && (
                  <datalist id="add-job-titles">
                    {allJobTitles.map(t => <option key={t} value={t} />)}
                  </datalist>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Employee Number <span className="text-xs text-slate-400">(optional)</span>
                </label>
                <input type="text" value={newEmployeeNumber} onChange={e => setNewEmployeeNumber(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* HR custom fields — inline */}
            {hrFields.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-semibold text-slate-700">HR Information</h4>
                <HRFieldsPanel
                  fields={hrFields}
                  values={newExtraFields}
                  onChange={setNewExtraFields}
                  showRequiredHints
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                required minLength={6} autoComplete="new-password"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Employment Start Date</label>
              <input type="date" value={newEmploymentStart} onChange={e => setNewEmploymentStart(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select value={newRole} onChange={e => { setNewRole(e.target.value); setNewManagerTitles([]) }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
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
              <label className="block text-sm font-medium text-slate-700 mb-2">Feature Access</label>
              {renderFeatureSelector(newRole, newUserFeatures, setNewUserFeatures)}
            </div>

            {renderWorkingDays(newWorkingDays, setNewWorkingDays)}

            {showHolidayFieldsNew && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
                <h4 className="font-semibold text-yellow-800 text-sm">🏖️ Holiday Entitlement</h4>
                {!company?.holiday_year_start && (
                  <p className="text-xs text-yellow-700 italic">
                    ⚠️ Set the company holiday year start first to enable auto-calculation.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Annual Entitlement <span className="text-xs text-slate-400">(full year days)</span>
                    </label>
                    <input type="number" step="0.5" min="0" value={newFullEntitlement}
                      onChange={e => setNewFullEntitlement(e.target.value)}
                      placeholder="e.g. 25"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Pro-Rata This Year <span className="text-xs text-slate-400">(auto)</span>
                    </label>
                    <input type="text"
                      value={newCalculatedEntitlement ? `${newCalculatedEntitlement} days` : ''}
                      disabled placeholder="—"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-700 font-medium" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Override Pro-Rata <span className="text-xs text-slate-400">(optional)</span>
                  </label>
                  <input type="number" step="0.5" min="0" value={newOverrideEntitlement}
                    onChange={e => setNewOverrideEntitlement(e.target.value)}
                    placeholder="Leave blank to use calculated amount"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            )}

            <button type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition">
              Create User
            </button>
          </form>
        </div>
      )}

      {/* EDIT FORM */}
      {editingUser && (
        <div className="bg-white border-l-4 border-blue-500 border-t border-r border-b border-slate-200 rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            Edit — {editingUser.full_name || editingUser.email}
          </h3>
          <form onSubmit={handleSaveEdit} className="space-y-4" autoComplete="off">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Job Title</label>
                <input type="text" value={editJobTitle} onChange={e => setEditJobTitle(e.target.value)}
                  list="edit-job-titles"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {allJobTitles.length > 0 && (
                  <datalist id="edit-job-titles">
                    {allJobTitles.map(t => <option key={t} value={t} />)}
                  </datalist>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Employee Number <span className="text-xs text-slate-400">(optional)</span>
                </label>
                <input type="text" value={editEmployeeNumber} onChange={e => setEditEmployeeNumber(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* HR custom fields — inline */}
            {hrFields.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-semibold text-slate-700">HR Information</h4>
                <HRFieldsPanel
                  fields={hrFields}
                  values={editExtraFields}
                  onChange={setEditExtraFields}
                  showRequiredHints
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Employment Start Date</label>
              <input type="date" value={editEmploymentStart} onChange={e => setEditEmploymentStart(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select value={editRole} onChange={e => { setEditRole(e.target.value); setEditManagerTitles([]) }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
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
              <label className="block text-sm font-medium text-slate-700 mb-2">Feature Access</label>
              {renderFeatureSelector(editRole, editUserFeatures, setEditUserFeatures)}
            </div>

            {renderWorkingDays(editWorkingDays, setEditWorkingDays)}

            {showHolidayFieldsEdit && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h4 className="font-semibold text-yellow-800 text-sm mb-3">🏖️ Holiday Entitlement</h4>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Days Remaining This Year</label>
                  <input type="number" step="0.5" min="0" value={editEntitlement}
                    onChange={e => setEditEntitlement(e.target.value)}
                    placeholder="e.g. 12.5"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg">
                Save Changes
              </button>
              <button type="button" onClick={() => setEditingUser(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-lg">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* USER LIST */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">All Users ({users.length})</h3>
        {users.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No users yet. Add one above.</p>
        ) : (
          <ul className="space-y-3">
            {users.map(u => (
              <li key={u.id} className={`border rounded-xl p-4 ${
                u.is_frozen ? 'border-orange-300 bg-orange-50' : 'border-slate-200'
              }`}>
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-slate-800">{u.full_name || u.email}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadgeColor(u.role)}`}>
                        {u.role}
                      </span>
                      {u.employee_number && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                          {u.employee_number}
                        </span>
                      )}
                      {u.job_title && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {u.job_title}
                        </span>
                      )}
                      {u.holiday_entitlement !== null && u.holiday_entitlement !== undefined && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                          🏖️ {u.holiday_entitlement} days
                        </span>
                      )}
                      {u.is_frozen && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Frozen</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 mt-0.5">{u.email}</p>
                    {u.user_features && u.user_features.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {u.role === 'admin' ? (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                            All features
                          </span>
                        ) : (
                          u.user_features
                            .filter(uf => uf.is_enabled)
                            .map(uf => (
                              <span key={uf.feature_id}
                                className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                {featureById(uf.feature_id)?.name || 'feature'}
                              </span>
                            ))
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => startEdit(u)}
                      className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg">
                      Edit
                    </button>
                    <button onClick={() => handleFreeze(u)}
                      className={`text-sm px-3 py-1.5 rounded-lg ${
                        u.is_frozen
                          ? 'bg-green-100 hover:bg-green-200 text-green-700'
                          : 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                      }`}>
                      {u.is_frozen ? 'Unfreeze' : 'Freeze'}
                    </button>
                    <button onClick={() => handleSoftDelete(u)}
                      className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg">
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* HR Fields Manager modal */}
      <HRFieldsManager
        open={showHrSettings}
        companyId={companyId}
        companyName={company?.name || 'this company'}
        actorId={currentUser?.id || ''}
        actorEmail={currentUser?.email || ''}
        onClose={() => setShowHrSettings(false)}
        onChanged={fetchHrFields}
      />
    </div>
  )
}
