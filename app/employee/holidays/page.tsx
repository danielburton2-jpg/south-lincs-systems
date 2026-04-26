'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { getUKBankHolidays } from '@/lib/bankHolidays'

const supabase = createClient()

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const DEFAULT_WORKING_DAYS = {
  sun: false, mon: true, tue: true, wed: true, thu: true, fri: true, sat: false
}

const formatDateLocal = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function EmployeeHolidays() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [requests, setRequests] = useState<any[]>([])
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [selectedRequest, setSelectedRequest] = useState<any>(null)

  const [requestType, setRequestType] = useState<'holiday' | 'early_finish' | 'keep_day_off'>('holiday')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [isHalfDay, setIsHalfDay] = useState(false)
  const [halfDayType, setHalfDayType] = useState<'morning' | 'afternoon'>('morning')
  const [earlyFinishTime, setEarlyFinishTime] = useState('')
  const [reason, setReason] = useState('')

  const router = useRouter()

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
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

    setCurrentUser(profile)

    if (profile.company_id) {
      const { data: companyData } = await supabase
        .from('companies')
        .select('*')
        .eq('id', profile.company_id)
        .single()
      setCompany(companyData)
    }

    const res = await fetch('/api/get-holiday-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, scope: 'mine' }),
    })
    const result = await res.json()
    if (result.requests) setRequests(result.requests)

    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
    getUKBankHolidays().then(setBankHolidays)
  }, [fetchData])

  // Realtime subscriptions
  useEffect(() => {
    if (!currentUser?.id) return

    const requestsChannel = supabase
      .channel('employee-holidays-requests')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'holiday_requests',
          filter: `user_id=eq.${currentUser.id}`,
        },
        () => {
          fetchData()
        }
      )
      .subscribe()

    const profileChannel = supabase
      .channel('employee-holidays-profile')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${currentUser.id}`,
        },
        () => {
          fetchData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(requestsChannel)
      supabase.removeChannel(profileChannel)
    }
  }, [currentUser?.id, fetchData])

  const calculateDays = () => {
    if (requestType !== 'holiday') return 0
    if (!startDate || !endDate) return 0

    const workingDays = currentUser?.working_days || DEFAULT_WORKING_DAYS

    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) return 0

    let count = 0
    const current = new Date(start)
    while (current <= end) {
      const dayKey = DAY_KEYS[current.getDay()]
      const dateStr = formatDateLocal(current)
      const isHoliday = bankHolidays.has(dateStr)
      if (workingDays[dayKey] && !isHoliday) count++
      current.setDate(current.getDate() + 1)
    }

    if (isHalfDay && count === 1) return 0.5
    return count
  }

  const daysRequested = calculateDays()
  const balance = currentUser?.holiday_entitlement || 0
  const balanceAfter = balance - daysRequested

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (requestType === 'holiday' && daysRequested > balance) {
      showMessage(`You don't have enough holiday days remaining (${balance} days available)`, 'error')
      return
    }

    if (requestType === 'holiday' && daysRequested === 0) {
      showMessage('Selected dates contain no working days for you', 'error')
      return
    }

    if (isHalfDay && startDate !== endDate) {
      showMessage('Half day requests must be on a single date', 'error')
      return
    }

    setSubmitting(true)

    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        user_id: currentUser.id,
        company_id: currentUser.company_id,
        request_type: requestType,
        start_date: startDate,
        end_date: requestType === 'early_finish' || requestType === 'keep_day_off' ? startDate : endDate,
        half_day_type: isHalfDay ? halfDayType : null,
        early_finish_time: requestType === 'early_finish' ? earlyFinishTime : null,
        reason,
        days_requested: daysRequested,
      }),
    })

    const result = await res.json()
    setSubmitting(false)

    if (!res.ok) {
      showMessage('Error: ' + result.error, 'error')
      return
    }

    showMessage('Request submitted! Awaiting approval.', 'success')
    setStartDate('')
    setEndDate('')
    setIsHalfDay(false)
    setReason('')
    setEarlyFinishTime('')
    setShowRequestForm(false)
  }

  const handleCancelRequest = async (req: any) => {
    if (req.status === 'pending') {
      const confirmed = confirm('Cancel this pending request?')
      if (!confirmed) return

      const res = await fetch('/api/holiday-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel_pending',
          request_id: req.id,
          user_id: currentUser.id,
        }),
      })

      if (!res.ok) {
        showMessage('Error cancelling request', 'error')
        return
      }
      showMessage('Request cancelled', 'success')
      setSelectedRequest(null)
    } else if (req.status === 'approved') {
      const confirmed = confirm('Send a cancellation request to your manager? Your days will be returned if approved.')
      if (!confirmed) return

      const res = await fetch('/api/holiday-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_cancel',
          request_id: req.id,
          user_id: currentUser.id,
        }),
      })

      if (!res.ok) {
        showMessage('Error requesting cancellation', 'error')
        return
      }
      showMessage('Cancellation request sent for approval', 'success')
      setSelectedRequest(null)
    }
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-700',
      approved: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-600',
      cancel_pending: 'bg-orange-100 text-orange-700',
      cancel_rejected: 'bg-green-100 text-green-700',
    }
    const labels: Record<string, string> = {
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
      cancel_pending: 'Cancel Pending',
      cancel_rejected: 'Approved',
    }
    return (
      <span className={`text-xs px-2 py-1 rounded-full font-medium ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    )
  }

  const getTypeIcon = (type: string) => {
    if (type === 'holiday') return '🏖️'
    if (type === 'early_finish') return '🕓'
    if (type === 'keep_day_off') return '🚫'
    return '📅'
  }

  const getTypeLabel = (type: string) => {
    if (type === 'holiday') return 'Holiday'
    if (type === 'early_finish') return 'Early Finish'
    if (type === 'keep_day_off') return 'Keep Day Off'
    return type
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  const today = formatDateLocal(new Date())
  const workingDays = currentUser?.working_days || DEFAULT_WORKING_DAYS
  const workingDaysCount = Object.values(workingDays).filter(Boolean).length

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-gradient-to-br from-yellow-400 to-orange-500 text-white px-6 pt-10 pb-8 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => router.push('/employee')} className="text-white text-sm">← Back</button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Holidays</h1>
            <p className="text-orange-100 text-sm mt-1">Manage your time off</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold">{balance}</p>
            <p className="text-xs text-orange-100">days left</p>
          </div>
        </div>
      </div>

      <div className="px-6 pt-6 space-y-4">

        {message && (
          <div className={`p-4 rounded-xl text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {!showRequestForm && !selectedRequest && (
          <button
            onClick={() => setShowRequestForm(true)}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-medium shadow-md hover:bg-blue-700 active:bg-blue-800 transition"
          >
            + New Request
          </button>
        )}

        {showRequestForm && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">New Request</h2>
              <button onClick={() => setShowRequestForm(false)} className="text-gray-400">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value as any)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-3 text-gray-900 bg-white"
                >
                  <option value="holiday">🏖️ Holiday — Take time off (deducts from balance)</option>
                  {company?.allow_early_finish && (
                    <option value="early_finish">🕓 Early Finish — Leave before normal end time</option>
                  )}
                  <option value="keep_day_off">🚫 Keep Day Off — Refuse a shift on your normal day off</option>
                </select>
              </div>

              {requestType === 'holiday' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      min={today}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate || today}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                      required
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={startDate}
                    min={today}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                    required
                  />
                </div>
              )}

              {requestType === 'holiday' && company?.allow_half_days && startDate === endDate && startDate && daysRequested > 0 && (
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isHalfDay}
                      onChange={(e) => setIsHalfDay(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium text-gray-700">Half day only</span>
                  </label>
                  {isHalfDay && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setHalfDayType('morning')}
                        className={`p-2 rounded-xl border-2 text-sm font-medium ${
                          halfDayType === 'morning' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        }`}
                      >
                        🌅 Morning
                      </button>
                      <button
                        type="button"
                        onClick={() => setHalfDayType('afternoon')}
                        className={`p-2 rounded-xl border-2 text-sm font-medium ${
                          halfDayType === 'afternoon' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        }`}
                      >
                        🌇 Afternoon
                      </button>
                    </div>
                  )}
                </div>
              )}

              {requestType === 'early_finish' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Finish Time</label>
                  <input
                    type="time"
                    value={earlyFinishTime}
                    onChange={(e) => setEarlyFinishTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                  placeholder="e.g. Family wedding"
                />
              </div>

              {requestType === 'holiday' && startDate && endDate && (
                <div className={`p-4 rounded-xl border ${
                  balanceAfter < 0 ? 'bg-red-50 border-red-200' :
                  daysRequested === 0 ? 'bg-yellow-50 border-yellow-200' :
                  'bg-blue-50 border-blue-200'
                }`}>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-700">Working days requested</span>
                    <span className="font-bold text-gray-900">{daysRequested}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-700">Current balance</span>
                    <span className="font-bold text-gray-900">{balance}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1 pt-1 border-t border-blue-200">
                    <span className="text-gray-700">Balance after approval</span>
                    <span className={`font-bold ${balanceAfter < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {balanceAfter}
                    </span>
                  </div>
                  {daysRequested === 0 && (
                    <p className="text-xs text-yellow-700 mt-2">
                      ⚠️ The selected dates don&apos;t include any of your working days
                    </p>
                  )}
                  {balanceAfter < 0 && (
                    <p className="text-xs text-red-600 mt-2">⚠️ You don&apos;t have enough days available</p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    You work {workingDaysCount} days per week. Bank holidays are excluded automatically.
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || (requestType === 'holiday' && (balanceAfter < 0 || daysRequested === 0))}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>
          </div>
        )}

        {selectedRequest && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">Request Details</h2>
              <button onClick={() => setSelectedRequest(null)} className="text-gray-400">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 uppercase">Type</p>
                <p className="text-gray-800 font-medium">
                  {getTypeIcon(selectedRequest.request_type)} {getTypeLabel(selectedRequest.request_type)}
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase">Date</p>
                <p className="text-gray-800 font-medium">
                  {selectedRequest.start_date === selectedRequest.end_date
                    ? formatDate(selectedRequest.start_date)
                    : `${formatDate(selectedRequest.start_date)} → ${formatDate(selectedRequest.end_date)}`}
                </p>
              </div>

              {selectedRequest.half_day_type && (
                <div>
                  <p className="text-xs text-gray-500 uppercase">Half Day</p>
                  <p className="text-gray-800 capitalize">{selectedRequest.half_day_type}</p>
                </div>
              )}

              {selectedRequest.early_finish_time && (
                <div>
                  <p className="text-xs text-gray-500 uppercase">Finish Time</p>
                  <p className="text-gray-800">{selectedRequest.early_finish_time}</p>
                </div>
              )}

              {selectedRequest.request_type === 'holiday' && (
                <div>
                  <p className="text-xs text-gray-500 uppercase">Days</p>
                  <p className="text-gray-800 font-medium">{selectedRequest.days_requested}</p>
                </div>
              )}

              <div>
                <p className="text-xs text-gray-500 uppercase">Status</p>
                <div className="mt-1">{getStatusBadge(selectedRequest.status)}</div>
              </div>

              {selectedRequest.reason && (
                <div>
                  <p className="text-xs text-gray-500 uppercase">Reason</p>
                  <p className="text-gray-800">{selectedRequest.reason}</p>
                </div>
              )}

              {selectedRequest.review_notes && (
                <div>
                  <p className="text-xs text-gray-500 uppercase">Reviewer Notes</p>
                  <p className="text-gray-800 italic">{selectedRequest.review_notes}</p>
                </div>
              )}

              {selectedRequest.status === 'pending' && (
                <button
                  onClick={() => handleCancelRequest(selectedRequest)}
                  className="w-full bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 py-3 rounded-xl font-medium transition"
                >
                  Cancel Request
                </button>
              )}

              {selectedRequest.status === 'approved' && (
                <button
                  onClick={() => handleCancelRequest(selectedRequest)}
                  className="w-full bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 py-3 rounded-xl font-medium transition"
                >
                  Request Cancellation
                </button>
              )}

              {selectedRequest.status === 'cancel_pending' && (
                <div className="bg-orange-50 border border-orange-200 text-orange-700 p-3 rounded-xl text-sm text-center">
                  Cancellation pending approval
                </div>
              )}
            </div>
          </div>
        )}

        {!showRequestForm && !selectedRequest && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Your Requests
            </h2>
            {requests.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm p-8 border border-gray-100 text-center">
                <p className="text-gray-400 text-sm">No requests yet. Tap &quot;New Request&quot; to get started.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {requests.map((req) => (
                  <li
                    key={req.id}
                    onClick={() => setSelectedRequest(req)}
                    className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="text-2xl">{getTypeIcon(req.request_type)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-800 truncate">
                            {req.start_date === req.end_date
                              ? formatDate(req.start_date)
                              : `${formatDate(req.start_date)} → ${formatDate(req.end_date)}`}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-gray-500">{getTypeLabel(req.request_type)}</p>
                            {req.request_type === 'holiday' && (
                              <p className="text-xs text-gray-500">• {req.days_requested} days</p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="ml-2">{getStatusBadge(req.status)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
            className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600"
          >
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}
