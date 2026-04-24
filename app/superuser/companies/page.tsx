'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

const parseSubscriptionInput = (input: string): Date | null => {
  const cleaned = input.trim().toLowerCase()
  const today = new Date()

  const match = cleaned.match(/^(\d+)\s*(day|days|week|weeks|month|months|year|years)$/)
  if (!match) return null

  const amount = parseInt(match[1])
  const unit = match[2]
  const date = new Date(today)

  if (unit.startsWith('day')) date.setDate(date.getDate() + amount)
  else if (unit.startsWith('week')) date.setDate(date.getDate() + amount * 7)
  else if (unit.startsWith('month')) date.setMonth(date.getMonth() + amount)
  else if (unit.startsWith('year')) date.setFullYear(date.getFullYear() + amount)

  return date
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [features, setFeatures] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [editingCompany, setEditingCompany] = useState<any>(null)
  const [expiringCompanies, setExpiringCompanies] = useState<any[]>([])

  const [newName, setNewName] = useState('')
  const [newSubInput, setNewSubInput] = useState('')
  const [newSubPreview, setNewSubPreview] = useState('')
  const [newSubError, setNewSubError] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [newFeatures, setNewFeatures] = useState<Record<string, boolean>>({})
  const [newHolidayYearStart, setNewHolidayYearStart] = useState('')

  const [editName, setEditName] = useState('')
  const [editSubInput, setEditSubInput] = useState('')
  const [editSubPreview, setEditSubPreview] = useState('')
  const [editSubError, setEditSubError] = useState('')
  const [editOverrideInput, setEditOverrideInput] = useState('')
  const [editOverridePreview, setEditOverridePreview] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editFeatures, setEditFeatures] = useState<Record<string, boolean>>({})
  const [editHolidayYearStart, setEditHolidayYearStart] = useState('')

  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const fetchCurrentUser = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setCurrentUser(profile)
    }
  }, [])

  const fetchFeatures = useCallback(async () => {
    const res = await fetch('/api/get-features')
    const result = await res.json()
    if (result.features) {
      setFeatures(result.features)
      const defaults: Record<string, boolean> = {}
      result.features.forEach((f: any) => { defaults[f.id] = false })
      setNewFeatures(defaults)
    }
  }, [])

  const fetchCompanies = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select(`
        *,
        company_features (
          is_enabled,
          feature_id,
          features (name)
        )
      `)
      .order('created_at', { ascending: false })
    if (data) {
      setCompanies(data)
      const today = new Date()
      const in7Days = new Date()
      in7Days.setDate(today.getDate() + 7)
      const expiring = data.filter((c: any) => {
        const effectiveEnd = c.override_end_date || c.end_date
        if (!effectiveEnd) return false
        const end = new Date(effectiveEnd)
        return end >= today && end <= in7Days
      })
      setExpiringCompanies(expiring)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchCurrentUser()
    fetchFeatures()
    fetchCompanies()
  }, [fetchCurrentUser, fetchFeatures, fetchCompanies])

  useEffect(() => {
    if (!newSubInput.trim()) {
      setNewSubPreview('')
      setNewSubError('')
      return
    }
    const date = parseSubscriptionInput(newSubInput)
    if (date) {
      setNewSubPreview('Expires: ' + date.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric'
      }))
      setNewSubError('')
    } else {
      setNewSubPreview('')
      setNewSubError('Try: "1 year", "6 months", "30 days", "2 weeks"')
    }
  }, [newSubInput])

  useEffect(() => {
    if (!editSubInput.trim()) {
      setEditSubPreview('')
      setEditSubError('')
      return
    }
    const date = parseSubscriptionInput(editSubInput)
    if (date) {
      setEditSubPreview('Expires: ' + date.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric'
      }))
      setEditSubError('')
    } else {
      setEditSubPreview('')
      setEditSubError('Try: "1 year", "6 months", "30 days", "2 weeks"')
    }
  }, [editSubInput])

  useEffect(() => {
    if (!editOverrideInput.trim()) {
      setEditOverridePreview('')
      return
    }
    const date = parseSubscriptionInput(editOverrideInput)
    if (date) {
      setEditOverridePreview('Override until: ' + date.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric'
      }))
    } else {
      setEditOverridePreview('')
    }
  }, [editOverrideInput])

  const isExpired = (company: any) => {
    const effectiveEnd = company.override_end_date || company.end_date
    if (!effectiveEnd) return false
    return new Date(effectiveEnd) < new Date()
  }

  const getDaysRemaining = (company: any) => {
    const effectiveEnd = company.override_end_date || company.end_date
    if (!effectiveEnd) return null
    const diff = new Date(effectiveEnd).getTime() - new Date().getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault()

    const endDate = parseSubscriptionInput(newSubInput)
    if (!endDate) {
      setNewSubError('Please enter a valid subscription length e.g. "1 year"')
      return
    }

    const res = await fetch('/api/create-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        start_date: new Date().toISOString().slice(0, 10),
        end_date: endDate.toISOString().slice(0, 10),
        notes: newNotes || null,
        holiday_year_start: newHolidayYearStart || null,
        features: features.map((f: any) => ({
          feature_id: f.id,
          is_enabled: newFeatures[f.id] || false,
        })),
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      showMessage('Error creating company: ' + result.error, 'error')
      return
    }

    showMessage('Company created successfully!', 'success')
    setNewName('')
    setNewSubInput('')
    setNewNotes('')
    setNewHolidayYearStart('')
    const defaults: Record<string, boolean> = {}
    features.forEach((f: any) => { defaults[f.id] = false })
    setNewFeatures(defaults)
    setShowAddForm(false)
    fetchCompanies()
  }

  const handleEditCompany = (company: any) => {
    setEditingCompany(company)
    setEditName(company.name)
    setEditSubInput('')
    setEditSubPreview(company.end_date
      ? 'Current end date: ' + new Date(company.end_date).toLocaleDateString('en-GB', {
          day: '2-digit', month: 'long', year: 'numeric'
        })
      : '')
    setEditOverrideInput('')
    setEditOverridePreview(company.override_end_date
      ? 'Current override: ' + new Date(company.override_end_date).toLocaleDateString('en-GB', {
          day: '2-digit', month: 'long', year: 'numeric'
        })
      : '')
    setEditNotes(company.notes || '')
    setEditHolidayYearStart(company.holiday_year_start || '')
    const featureState: Record<string, boolean> = {}
    company.company_features?.forEach((cf: any) => {
      featureState[cf.feature_id] = cf.is_enabled
    })
    features.forEach((f: any) => {
      if (!(f.id in featureState)) featureState[f.id] = false
    })
    setEditFeatures(featureState)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()

    let newEndDate = editingCompany.end_date
    let newOverrideDate = editingCompany.override_end_date

    if (editSubInput.trim()) {
      const parsed = parseSubscriptionInput(editSubInput)
      if (!parsed) {
        setEditSubError('Invalid format. Try "1 year", "6 months", "30 days"')
        return
      }
      newEndDate = parsed.toISOString().slice(0, 10)
    }

    if (editOverrideInput.trim()) {
      const parsed = parseSubscriptionInput(editOverrideInput)
      if (parsed) newOverrideDate = parsed.toISOString().slice(0, 10)
    }

    const res = await fetch('/api/update-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: editingCompany.id,
        name: editName,
        end_date: newEndDate || null,
        override_end_date: newOverrideDate || null,
        notes: editNotes || null,
        holiday_year_start: editHolidayYearStart || null,
        features: features.map((f: any) => ({
          feature_id: f.id,
          is_enabled: editFeatures[f.id] || false,
        })),
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      showMessage('Error updating company: ' + result.error, 'error')
      return
    }

    showMessage('Company updated successfully!', 'success')
    setEditingCompany(null)
    fetchCompanies()
  }

  const handleToggleActive = async (company: any) => {
    const res = await fetch('/api/update-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: company.id,
        is_active: !company.is_active,
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
        toggle_only: true,
      }),
    })

    if (!res.ok) {
      showMessage('Error updating company', 'error')
      return
    }

    showMessage(company.is_active ? 'Company deactivated' : 'Company activated', 'success')
    fetchCompanies()
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">South Lincs Systems</h1>
        <button
          onClick={() => router.push('/superuser')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">

        {expiringCompanies.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4">
            <h3 className="font-semibold text-yellow-800 mb-2">
              ⚠️ Subscriptions expiring within 7 days
            </h3>
            <ul className="space-y-1">
              {expiringCompanies.map((c) => (
                <li key={c.id} className="text-yellow-700 text-sm">
                  <span className="font-medium">{c.name}</span> — expires{' '}
                  {new Date(c.override_end_date || c.end_date).toLocaleDateString('en-GB')}
                  {' '}({getDaysRemaining(c)} days)
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">Company Management</h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            {showAddForm ? 'Cancel' : '+ Add Company'}
          </button>
        </div>

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {showAddForm && (
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">New Company</h3>
            <form onSubmit={handleCreateCompany} className="space-y-4" autoComplete="off">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="text"
                    value={new Date().toLocaleDateString('en-GB')}
                    disabled
                    className="w-full border border-gray-200 rounded-lg px-4 py-2 bg-gray-50 text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subscription Length</label>
                  <input
                    type="text"
                    value={newSubInput}
                    onChange={(e) => setNewSubInput(e.target.value)}
                    placeholder='e.g. "1 year", "6 months", "30 days"'
                    className={`w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      newSubError ? 'border-red-400' : 'border-gray-300'
                    }`}
                    required
                  />
                  {newSubPreview && (
                    <p className="mt-1 text-sm text-green-600 font-medium">{newSubPreview}</p>
                  )}
                  {newSubError && (
                    <p className="mt-1 text-sm text-red-500">{newSubError}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Holiday Year Start Date
                  <span className="ml-1 text-xs text-gray-400">(e.g. April 1st = 2025-04-01)</span>
                </label>
                <input
                  type="date"
                  value={newHolidayYearStart}
                  onChange={(e) => setNewHolidayYearStart(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Features</label>
                <div className="grid grid-cols-2 gap-2">
                  {features.map((feature) => (
                    <label
                      key={feature.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                        newFeatures[feature.id]
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={newFeatures[feature.id] || false}
                        onChange={(e) => setNewFeatures({
                          ...newFeatures,
                          [feature.id]: e.target.checked,
                        })}
                        className="w-4 h-4 text-blue-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{feature.name}</p>
                        <p className="text-xs text-gray-500">{feature.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-medium"
              >
                Create Company
              </button>
            </form>
          </div>
        )}

        {editingCompany && (
          <div className="bg-white rounded-xl shadow p-6 border-l-4 border-blue-500">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              Edit — {editingCompany.name}
            </h3>
            <form onSubmit={handleSaveEdit} className="space-y-4" autoComplete="off">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    New Subscription Length
                    <span className="ml-1 text-xs text-gray-400">(leave blank to keep current)</span>
                  </label>
                  <input
                    type="text"
                    value={editSubInput}
                    onChange={(e) => setEditSubInput(e.target.value)}
                    placeholder='e.g. "1 year", "6 months"'
                    className={`w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      editSubError ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {editSubPreview && (
                    <p className="mt-1 text-sm text-green-600 font-medium">{editSubPreview}</p>
                  )}
                  {editSubError && (
                    <p className="mt-1 text-sm text-red-500">{editSubError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Override Subscription
                    <span className="ml-1 text-xs text-blue-600">(superuser only)</span>
                  </label>
                  <input
                    type="text"
                    value={editOverrideInput}
                    onChange={(e) => setEditOverrideInput(e.target.value)}
                    placeholder='e.g. "3 months", "1 year"'
                    className="w-full border border-blue-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
                  />
                  {editOverridePreview && (
                    <p className="mt-1 text-sm text-blue-600 font-medium">{editOverridePreview}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Holiday Year Start Date</label>
                <input
                  type="date"
                  value={editHolidayYearStart}
                  onChange={(e) => setEditHolidayYearStart(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Features</label>
                <div className="grid grid-cols-2 gap-2">
                  {features.map((feature) => (
                    <label
                      key={feature.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                        editFeatures[feature.id]
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={editFeatures[feature.id] || false}
                        onChange={(e) => setEditFeatures({
                          ...editFeatures,
                          [feature.id]: e.target.checked,
                        })}
                        className="w-4 h-4 text-blue-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{feature.name}</p>
                        <p className="text-xs text-gray-500">{feature.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCompany(null)}
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
            Companies ({companies.length})
          </h3>
          {loading ? (
            <p className="text-gray-400">Loading companies...</p>
          ) : companies.length === 0 ? (
            <p className="text-gray-400">No companies yet. Add one above!</p>
          ) : (
            <ul className="space-y-4">
              {companies.map((company) => {
                const expired = isExpired(company)
                const daysLeft = getDaysRemaining(company)
                const effectiveEnd = company.override_end_date || company.end_date

                return (
                  <li
                    key={company.id}
                    className={`border rounded-xl p-4 ${
                      !company.is_active
                        ? 'border-gray-200 bg-gray-50 opacity-60'
                        : expired
                        ? 'border-red-300 bg-red-50'
                        : daysLeft !== null && daysLeft <= 7
                        ? 'border-yellow-300 bg-yellow-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-gray-800 text-lg">{company.name}</h4>
                          {!company.is_active && (
                            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>
                          )}
                          {expired && company.is_active && (
                            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Expired</span>
                          )}
                          {!expired && daysLeft !== null && daysLeft <= 7 && (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                              Expires in {daysLeft} days
                            </span>
                          )}
                          {company.override_end_date && (
                            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">Override Active</span>
                          )}
                        </div>

                        <div className="mt-1 text-sm text-gray-500 space-x-3">
                          <span>Start: {new Date(company.start_date).toLocaleDateString('en-GB')}</span>
                          <span>End: {effectiveEnd ? new Date(effectiveEnd).toLocaleDateString('en-GB') : '—'}</span>
                          {daysLeft !== null && !expired && (
                            <span className="text-gray-400">({daysLeft} days remaining)</span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1">
                          {company.company_features
                            ?.filter((cf: any) => cf.is_enabled)
                            .map((cf: any) => (
                              <span
                                key={cf.feature_id}
                                className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"
                              >
                                {cf.features?.name}
                              </span>
                            ))}
                          {company.company_features?.filter((cf: any) => cf.is_enabled).length === 0 && (
                            <span className="text-xs text-gray-400">No features enabled</span>
                          )}
                        </div>

                        {company.notes && (
                          <p className="mt-2 text-xs text-gray-400 italic">{company.notes}</p>
                        )}
                      </div>

                      <div className="flex gap-2 ml-4 flex-shrink-0">
                        <button
                          onClick={() => handleEditCompany(company)}
                          className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => router.push(`/superuser/companies/${company.id}/users`)}
                          className="text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg transition"
                        >
                          Users
                        </button>
                        <button
                          onClick={() => handleToggleActive(company)}
                          className={`text-sm px-3 py-1.5 rounded-lg transition ${
                            company.is_active
                              ? 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                              : 'bg-green-100 hover:bg-green-200 text-green-700'
                          }`}
                        >
                          {company.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}