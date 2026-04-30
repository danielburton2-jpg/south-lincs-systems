'use client'

/**
 * UserForm — shared form for /dashboard/users/add and /dashboard/users/edit/[id].
 *
 * Used by admins to create/edit users in their company.
 *
 * CHANGES from previous version:
 *   • The inline "Feature Access" checkbox grid is gone.
 *   • Replaced with a single "Configure Feature Access" button that
 *     opens FeatureAccessModal. The modal lets you set Holidays to
 *     Off/Read/Edit and toggle other features on/off (with future
 *     hooks for granular settings on those too).
 *   • Form still owns the user_features state and submits it to the
 *     API as before.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import HRFieldsPanel, { validateHRFields } from '@/components/HRFieldsPanel'
import type { HRFieldDef } from '@/components/HRFieldsManager'
import FeatureAccessModal, {
  type Feature, type UserFeatureRow,
} from '@/components/FeatureAccessModal'

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

const HOLIDAYS_SLUG = 'holidays'

export type UserFormUser = {
  id?: string
  full_name: string
  email: string
  role: string
  job_title: string
  employee_number: string
  employment_start_date: string
  password?: string
  holiday_entitlement: number | null
  full_year_entitlement: number | null
  working_days: any
  user_features: UserFeatureRow[]
  manager_titles: string[]
  extra_fields: Record<string, any>
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

type Props = {
  mode: 'add' | 'edit'
  initial?: Partial<UserFormUser>
  userId?: string
}

export default function UserForm({ mode, initial, userId }: Props) {
  const router = useRouter()

  // Loaded context
  const [company, setCompany] = useState<any>(null)
  const [companyId, setCompanyId] = useState<string>('')
  const [companyFeatureIds, setCompanyFeatureIds] = useState<string[]>([])
  const [features, setFeatures] = useState<Feature[]>([])
  const [hrFields, setHrFields] = useState<HRFieldDef[]>([])
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [bootError, setBootError] = useState('')
  const [bootLoading, setBootLoading] = useState(true)

  // Form state
  const [name, setName] = useState(initial?.full_name || '')
  const [email, setEmail] = useState(initial?.email || '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(initial?.role || 'user')
  const [jobTitle, setJobTitle] = useState(initial?.job_title || '')
  const [employeeNumber, setEmployeeNumber] = useState(initial?.employee_number || '')
  const [employmentStart, setEmploymentStart] = useState(initial?.employment_start_date || '')
  const [fullEntitlement, setFullEntitlement] = useState(
    initial?.full_year_entitlement?.toString() || ''
  )
  const [calculatedEntitlement, setCalculatedEntitlement] = useState('')
  const [overrideEntitlement, setOverrideEntitlement] = useState('')
  const [editEntitlement, setEditEntitlement] = useState(
    initial?.holiday_entitlement?.toString() || ''
  )
  const [workingDays, setWorkingDays] = useState<any>(
    initial?.working_days || DEFAULT_WORKING_DAYS
  )
  const [userFeatures, setUserFeatures] = useState<UserFeatureRow[]>(initial?.user_features || [])
  const [showFeatureModal, setShowFeatureModal] = useState(false)
  const [managerTitles, setManagerTitlesState] = useState<string[]>(initial?.manager_titles || [])
  const [extraFields, setExtraFields] = useState<Record<string, any>>(initial?.extra_fields || {})

  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg); setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  // Load context
  const loadContext = useCallback(async () => {
    setBootLoading(true)
    setBootError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, role, full_name, company_id')
        .eq('id', user.id)
        .single()
      if (!profile?.company_id) throw new Error('No company assigned')
      setCurrentUser(profile)
      setCompanyId(profile.company_id)

      const cRes = await fetch(`/api/get-company?id=${encodeURIComponent(profile.company_id)}`)
      const cData = await cRes.json()
      if (!cRes.ok) throw new Error(cData.error || 'Failed to load company')
      setCompany(cData.company)
      setCompanyFeatureIds(cData.enabled_feature_ids || [])

      const fRes = await fetch('/api/list-features')
      const fData = await fRes.json()
      if (Array.isArray(fData.features)) setFeatures(fData.features)

      const hRes = await fetch(`/api/company-user-fields?company_id=${profile.company_id}`)
      const hData = await hRes.json()
      if (Array.isArray(hData.fields)) setHrFields(hData.fields)

      const uRes = await fetch('/api/get-company-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: profile.company_id }),
      })
      const uData = await uRes.json()
      if (Array.isArray(uData.users)) setAllUsers(uData.users)
    } catch (e: any) {
      setBootError(e?.message || 'Failed to load context')
    } finally {
      setBootLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadContext() }, [loadContext])

  // Live pro-rata calc (add mode)
  useEffect(() => {
    if (mode !== 'add') return
    if (fullEntitlement && employmentStart && company?.holiday_year_start) {
      const calc = calculateProRata(
        parseFloat(fullEntitlement),
        employmentStart,
        company.holiday_year_start,
      )
      setCalculatedEntitlement(calc.toString())
    } else {
      setCalculatedEntitlement('')
    }
  }, [mode, fullEntitlement, employmentStart, company])

  // Derived: features the company actually has enabled (subset of catalogue)
  const enabledFeatures = useMemo(
    () => features.filter(f => companyFeatureIds.includes(f.id)),
    [features, companyFeatureIds]
  )

  // Holidays handling — pulled out so we can show holiday entitlement fields
  const holidaysFeature = enabledFeatures.find(f => f.slug === HOLIDAYS_SLUG)
  const holidayUF = holidaysFeature ? userFeatures.find(uf => uf.feature_id === holidaysFeature.id) : undefined
  const userHasAnyHolidayAccess = role === 'admin' || !!(holidayUF && (holidayUF.can_view || holidayUF.can_edit))
  const showHolidayFields = userHasAnyHolidayAccess

  // Summary line for the Feature Access button
  const featureSummary = useMemo(() => {
    if (role === 'admin') return 'Admin — full access to all features'
    if (enabledFeatures.length === 0) return 'No features enabled for this company'
    const parts: string[] = []
    for (const f of enabledFeatures) {
      const uf = userFeatures.find(r => r.feature_id === f.id)
      if (!uf || !uf.is_enabled) continue
      if (f.slug === HOLIDAYS_SLUG) {
        parts.push(`${f.name} (${uf.can_edit ? 'Edit' : 'Read'})`)
      } else {
        parts.push(f.name)
      }
    }
    return parts.length === 0 ? 'No access set yet' : parts.join(' • ')
  }, [role, enabledFeatures, userFeatures])

  const jobTitles = useMemo(
    () => Array.from(new Set(
      allUsers.filter(u => u.role !== 'admin').map(u => u.job_title).filter(Boolean) as string[]
    )),
    [allUsers]
  )
  const allJobTitles = useMemo(
    () => Array.from(new Set(allUsers.map(u => u.job_title).filter(Boolean) as string[])),
    [allUsers]
  )

  const toggleManagerTitle = (title: string) => {
    setManagerTitlesState(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title])
  }

  const buildFeatures = (): UserFeatureRow[] => {
    if (role === 'admin') {
      // Admins always get full access
      return enabledFeatures.map(f => ({
        feature_id: f.id, is_enabled: true,
        can_view: true, can_edit: true, can_view_reports: true,
      }))
    }
    return enabledFeatures.map(f => {
      const existing = userFeatures.find(r => r.feature_id === f.id)
      if (existing) return existing
      return { feature_id: f.id, is_enabled: false, can_view: false, can_edit: false, can_view_reports: false }
    })
  }

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const hrErr = validateHRFields(hrFields, extraFields)
    if (hrErr) { showMessage(hrErr, 'error'); return }

    setSubmitting(true)
    setMessage('')

    try {
      if (mode === 'add') {
        const finalEntitlement = overrideEntitlement
          ? parseFloat(overrideEntitlement)
          : (calculatedEntitlement ? parseFloat(calculatedEntitlement) : null)

        const res = await fetch('/api/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email, password,
            full_name: name, role,
            company_id: companyId,
            job_title: jobTitle || null,
            employee_number: employeeNumber || null,
            employment_start_date: employmentStart || null,
            holiday_entitlement: finalEntitlement,
            full_year_entitlement: fullEntitlement ? parseFloat(fullEntitlement) : null,
            working_days: workingDays,
            user_features: buildFeatures(),
            manager_titles: role === 'manager' ? managerTitles : [],
            extra_fields: extraFields,
            actor_id: currentUser?.id,
            actor_email: currentUser?.email,
            actor_role: currentUser?.role,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          showMessage('Error creating user: ' + (data.error || 'unknown'), 'error')
          setSubmitting(false); return
        }
        router.push('/dashboard/users')
      } else {
        const res = await fetch('/api/update-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            full_name: name, email, role,
            job_title: jobTitle || null,
            employee_number: employeeNumber || null,
            employment_start_date: employmentStart || null,
            holiday_entitlement: editEntitlement ? parseFloat(editEntitlement) : null,
            working_days: workingDays,
            user_features: buildFeatures(),
            manager_titles: role === 'manager' ? managerTitles : [],
            extra_fields: extraFields,
            actor_id: currentUser?.id,
            actor_email: currentUser?.email,
            actor_role: currentUser?.role,
            company_name: company?.name,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          showMessage('Error updating user: ' + (data.error || 'unknown'), 'error')
          setSubmitting(false); return
        }
        router.push('/dashboard/users')
      }
    } catch (err: any) {
      showMessage(err?.message || 'Server error', 'error')
      setSubmitting(false)
    }
  }

  if (bootLoading) {
    return <div className="p-8 text-slate-400 italic">Loading…</div>
  }
  if (bootError) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          {bootError}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <button
        onClick={() => router.push('/dashboard/users')}
        className="text-sm text-slate-500 hover:text-slate-700 mb-4">
        ← Back to users
      </button>

      <h1 className="text-2xl font-bold text-slate-900 mb-1">
        {mode === 'add' ? 'Add User' : 'Edit User'}
      </h1>
      <p className="text-sm text-slate-500 mb-6">{company?.name}</p>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
          messageType === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>{message}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-slate-200 rounded-xl shadow-sm p-6" autoComplete="off">

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Job Title</label>
            <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)}
              list="job-titles" placeholder="e.g. Driver"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {allJobTitles.length > 0 && (
              <datalist id="job-titles">
                {allJobTitles.map(t => <option key={t} value={t} />)}
              </datalist>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Employee Number <span className="text-xs text-slate-400">(optional)</span>
            </label>
            <input type="text" value={employeeNumber} onChange={e => setEmployeeNumber(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {hrFields.length > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-semibold text-slate-700">HR Information</h4>
            <HRFieldsPanel
              fields={hrFields}
              values={extraFields}
              onChange={setExtraFields}
              showRequiredHints
            />
          </div>
        )}

        {mode === 'add' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              required minLength={6} autoComplete="new-password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Employment Start Date</label>
          <input type="date" value={employmentStart} onChange={e => setEmploymentStart(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
          <select value={role} onChange={e => { setRole(e.target.value); setManagerTitlesState([]) }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="user">User</option>
          </select>
        </div>

        {role === 'manager' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
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
                  <label key={title} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                    managerTitles.includes(title)
                      ? 'border-blue-400 bg-blue-100'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                    <input type="checkbox" checked={managerTitles.includes(title)}
                      onChange={() => toggleManagerTitle(title)} className="w-4 h-4" />
                    <span className="text-sm font-medium text-slate-800">{title}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feature Access — opens modal */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Feature Access</label>
          <button type="button" onClick={() => setShowFeatureModal(true)}
            className="w-full border border-slate-300 hover:border-slate-400 bg-white rounded-lg px-4 py-3 text-left transition">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">Configure Feature Access</p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{featureSummary}</p>
              </div>
              <span className="text-slate-400">⚙</span>
            </div>
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
          <h4 className="text-sm font-semibold text-blue-800">📅 Working Days</h4>
          <p className="text-xs text-blue-700">Tick the days this employee normally works.</p>
          <div className="flex flex-wrap gap-2">
            {DAYS_OF_WEEK.map(day => (
              <button key={day.key} type="button"
                onClick={() => setWorkingDays({ ...workingDays, [day.key]: !workingDays[day.key] })}
                className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition ${
                  workingDays[day.key]
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'bg-white border-slate-300 text-slate-600'
                }`}>
                {day.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-blue-700">
            Working {Object.values(workingDays).filter(Boolean).length} days per week
          </p>
        </div>

        {showHolidayFields && mode === 'add' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
            <h4 className="font-semibold text-yellow-800 text-sm">🏖️ Holiday Entitlement</h4>
            {!company?.holiday_year_start && (
              <p className="text-xs text-yellow-700 italic">
                ⚠️ Holiday year start not set on this company. Auto-calculation disabled.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Annual Entitlement <span className="text-xs text-slate-400">(full year days)</span>
                </label>
                <input type="number" step="0.5" min="0" value={fullEntitlement}
                  onChange={e => setFullEntitlement(e.target.value)}
                  placeholder="e.g. 25"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Pro-Rata This Year <span className="text-xs text-slate-400">(auto)</span>
                </label>
                <input type="text"
                  value={calculatedEntitlement ? `${calculatedEntitlement} days` : ''}
                  disabled placeholder="—"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-700 font-medium" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Override Pro-Rata <span className="text-xs text-slate-400">(optional)</span>
              </label>
              <input type="number" step="0.5" min="0" value={overrideEntitlement}
                onChange={e => setOverrideEntitlement(e.target.value)}
                placeholder="Leave blank to use calculated amount"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        )}

        {showHolidayFields && mode === 'edit' && (
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
          <button type="submit" disabled={submitting}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg disabled:opacity-50">
            {submitting
              ? (mode === 'add' ? 'Creating…' : 'Saving…')
              : (mode === 'add' ? 'Create User' : 'Save Changes')}
          </button>
          <button type="button" onClick={() => router.push('/dashboard/users')}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-lg">
            Cancel
          </button>
        </div>
      </form>

      {/* Feature Access modal */}
      <FeatureAccessModal
        open={showFeatureModal}
        features={enabledFeatures}
        initial={userFeatures}
        isAdmin={role === 'admin'}
        onClose={() => setShowFeatureModal(false)}
        onSave={(rows) => {
          setUserFeatures(rows)
          setShowFeatureModal(false)
        }}
      />
    </div>
  )
}
