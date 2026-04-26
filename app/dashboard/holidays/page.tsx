'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'

const supabase = createClient()

const formatDateLocal = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function DashboardHolidays() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [requests, setRequests] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set())
  const [bankHolidayNames, setBankHolidayNames] = useState<Record<string, string>>({})
  const [managerTitles, setManagerTitles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [selectedRequest, setSelectedRequest] = useState<any>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const [view, setView] = useState<'pending' | 'all' | 'calendar'>('pending')

  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const fetchBankHolidaysWithNames = async () => {
    try {
      const res = await fetch('https://www.gov.uk/bank-holidays.json')
      if (!res.ok) return

      const data = await res.json()
      const events = data['england-and-wales']?.events || []
      const names: Record<string, string> = {}
      const dates = new Set<string>()
      events.forEach((event: any) => {
        names[event.date] = event.title
        dates.add(event.date)
      })
      setBankHolidays(dates)
      setBankHolidayNames(names)
    } catch (err) {
      console.error('Failed to fetch bank holidays:', err)
    }
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

    const res = await fetch('/api/get-holiday-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: profile.company_id, scope: 'company' }),
    })
    const result = await res.json()
    if (result.requests) setRequests(result.requests)

    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
    fetchBankHolidaysWithNames()
  }, [fetchData])

  // Realtime subscriptions
  useEffect(() => {
    if (!currentUser?.company_id) return

    const requestsChannel = supabase
      .channel('dashboard-holidays-requests')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'holiday_requests',
          filter: `company_id=eq.${currentUser.company_id}`,
        },
        () => {
          fetchData()
        }
      )
      .subscribe()

    const profilesChannel = supabase
      .channel('dashboard-holidays-profiles')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `company_id=eq.${currentUser.company_id}`,
        },
        () => {
          fetchData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(requestsChannel)
      supabase.removeChannel(profilesChannel)
    }
  }, [currentUser?.company_id, fetchData])

  const getVisibleRequests = () => {
    if (!currentUser) return []
    if (currentUser.role === 'admin') return requests
    if (currentUser.role === 'manager') {
      return requests.filter(r => r.user?.job_title && managerTitles.includes(r.user.job_title))
    }
    return []
  }

  const getVisibleUsers = () => {
    if (!currentUser) return []
    if (currentUser.role === 'admin') {
      return users.filter(u => !u.is_frozen && !u.is_deleted)
    }
    if (currentUser.role === 'manager') {
      return users.filter(u =>
        !u.is_frozen &&
        !u.is_deleted &&
        u.job_title &&
        managerTitles.includes(u.job_title)
      )
    }
    return []
  }

  const visibleRequests = getVisibleRequests()
  const visibleUsers = getVisibleUsers()
  const pendingRequests = visibleRequests.filter(r => r.status === 'pending' || r.status === 'cancel_pending')
  const allOtherRequests = visibleRequests.filter(r => r.status !== 'pending' && r.status !== 'cancel_pending')

  const handleApprove = async (req: any) => {
    if (req.user_id === currentUser.id) {
      showMessage('You cannot approve your own request', 'error')
      return
    }

    const action = req.status === 'cancel_pending' ? 'approve_cancel' : 'approve'

    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        request_id: req.id,
        reviewer_id: currentUser.id,
        reviewer_email: currentUser.email,
        reviewer_role: currentUser.role,
        review_notes: reviewNotes,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      showMessage('Error: ' + result.error, 'error')
      return
    }

    showMessage(action === 'approve_cancel' ? 'Cancellation approved' : 'Request approved', 'success')
    setSelectedRequest(null)
    setReviewNotes('')
  }

  const handleReject = async (req: any) => {
    if (req.user_id === currentUser.id) {
      showMessage('You cannot reject your own request', 'error')
      return
    }

    const action = req.status === 'cancel_pending' ? 'reject_cancel' : 'reject'

    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        request_id: req.id,
        reviewer_id: currentUser.id,
        reviewer_email: currentUser.email,
        reviewer_role: currentUser.role,
        review_notes: reviewNotes,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      showMessage('Error: ' + result.error, 'error')
      return
    }

    showMessage(action === 'reject_cancel' ? 'Cancellation rejected' : 'Request rejected', 'success')
    setSelectedRequest(null)
    setReviewNotes('')
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
    }
    const labels: Record<string, string> = {
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
      cancel_pending: 'Cancellation Pending',
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

  const getMonthDates = () => {
    const year = calendarMonth.getFullYear()
    const month = calendarMonth.getMonth()
    const lastDay = new Date(year, month + 1, 0).getDate()
    const dates: Date[] = []
    for (let day = 1; day <= lastDay; day++) {
      dates.push(new Date(year, month, day))
    }
    return dates
  }

  const isWeekend = (date: Date) => {
    const day = date.getDay()
    return day === 0 || day === 6
  }

  const isToday = (date: Date) => {
    const today = new Date()
    return date.toDateString() === today.toDateString()
  }

  const isBankHoliday = (date: Date) => {
    const dateStr = formatDateLocal(date)
    return bankHolidays.has(dateStr)
  }

  const goToPreviousMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))
  }

  const goToToday = () => {
    setCalendarMonth(new Date())
  }

  const getRequestForUserDate = (userId: string, date: Date) => {
    const dateStr = formatDateLocal(date)
    return visibleRequests.find(r => {
      if (r.user_id !== userId) return false
      if (r.status !== 'approved' && r.status !== 'pending' && r.status !== 'cancel_pending') return false
      return dateStr >= r.start_date && dateStr <= r.end_date
    })
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'manager'

  if (!isAdmin && !isManager) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">You don&apos;t have access to this page.</p>
      </main>
    )
  }

  const monthDates = getMonthDates()
  const monthName = calendarMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Holiday Management</p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-6">

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
              Showing requests from staff with these job titles:{' '}
              <span className="font-medium">{managerTitles.join(', ')}</span>
            </p>
          </div>
        )}

        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setView('pending')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
              view === 'pending'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Pending Approval
            {pendingRequests.length > 0 && (
              <span className="ml-2 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-bold">
                {pendingRequests.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
              view === 'calendar'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Calendar
          </button>
          <button
            onClick={() => setView('all')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
              view === 'all'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All Requests
          </button>
        </div>

        {view === 'pending' && (
          <div className="space-y-3">
            {pendingRequests.length === 0 ? (
              <div className="bg-white rounded-xl shadow p-8 text-center">
                <p className="text-gray-400">No pending requests 🎉</p>
              </div>
            ) : (
              pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className={`bg-white rounded-xl shadow p-4 border-l-4 ${
                    req.status === 'cancel_pending' ? 'border-orange-500' : 'border-yellow-500'
                  }`}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-2xl">{getTypeIcon(req.request_type)}</span>
                        <p className="font-semibold text-gray-800">{req.user?.full_name}</p>
                        {req.user?.job_title && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {req.user.job_title}
                          </span>
                        )}
                        {getStatusBadge(req.status)}
                      </div>

                      <p className="text-sm text-gray-700 mt-2">
                        <span className="font-medium">{getTypeLabel(req.request_type)}</span>
                        {' • '}
                        {req.start_date === req.end_date
                          ? formatDate(req.start_date)
                          : `${formatDate(req.start_date)} → ${formatDate(req.end_date)}`}
                      </p>

                      {req.half_day_type && (
                        <p className="text-xs text-gray-500 mt-1 capitalize">Half day ({req.half_day_type})</p>
                      )}

                      {req.early_finish_time && (
                        <p className="text-xs text-gray-500 mt-1">Finish at {req.early_finish_time}</p>
                      )}

                      {req.request_type === 'holiday' && (
                        <p className="text-xs text-gray-500 mt-1">
                          {req.days_requested} day{req.days_requested !== 1 ? 's' : ''}
                        </p>
                      )}

                      {req.reason && (
                        <p className="text-sm text-gray-600 mt-2 italic">&ldquo;{req.reason}&rdquo;</p>
                      )}

                      {req.status === 'cancel_pending' && (
                        <p className="text-xs text-orange-600 mt-2 font-medium">
                          ⚠️ Cancellation requested — will refund {req.days_requested} days if approved
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {req.user_id === currentUser.id ? (
                        <p className="text-xs text-gray-400 italic">Your own request</p>
                      ) : (
                        <button
                          onClick={() => {
                            setSelectedRequest(req)
                            setReviewNotes('')
                          }}
                          className="text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-4 py-2 rounded-lg transition"
                        >
                          Review
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {view === 'calendar' && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <button onClick={goToPreviousMonth} className="text-2xl text-gray-600 hover:text-gray-800 px-3 py-1">‹</button>
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-gray-800">{monthName}</h3>
                <button
                  onClick={goToToday}
                  className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-full text-gray-700"
                >
                  Today
                </button>
              </div>
              <button onClick={goToNextMonth} className="text-2xl text-gray-600 hover:text-gray-800 px-3 py-1">›</button>
            </div>

            <div className="overflow-x-auto">
              {visibleUsers.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No users to display</div>
              ) : (
                <table className="border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 bg-white border-r border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-48">
                        Employee
                      </th>
                      {monthDates.map((date) => {
                        const weekend = isWeekend(date)
                        const today = isToday(date)
                        const holiday = isBankHoliday(date)
                        return (
                          <th
                            key={date.toISOString()}
                            className={`border-r border-b border-gray-300 px-1 py-2 text-xs font-medium text-center min-w-10 ${
                              today ? 'bg-blue-100 text-blue-700' :
                              holiday ? 'bg-red-100 text-red-700' :
                              weekend ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-50 text-gray-600'
                            }`}
                            title={holiday ? bankHolidayNames[formatDateLocal(date)] : ''}
                          >
                            <div>{date.getDate()}</div>
                            <div className="text-[9px] opacity-70">
                              {date.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 1)}
                            </div>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((user) => (
                      <tr key={user.id}>
                        <td className="sticky left-0 z-10 bg-white border-r border-b border-gray-200 px-3 py-2 text-sm">
                          <p className="font-medium text-gray-800 truncate">{user.full_name}</p>
                          {user.job_title && (
                            <p className="text-[10px] text-gray-500">{user.job_title}</p>
                          )}
                        </td>
                        {monthDates.map((date) => {
                          const weekend = isWeekend(date)
                          const today = isToday(date)
                          const holiday = isBankHoliday(date)
                          const req = getRequestForUserDate(user.id, date)

                          let cellBg = ''
                          if (today) cellBg = 'bg-blue-50'
                          else if (holiday) cellBg = 'bg-red-50'
                          else if (weekend) cellBg = 'bg-yellow-50'

                          return (
                            <td
                              key={date.toISOString()}
                              className={`border-r border-b border-gray-200 p-0.5 text-center min-w-10 h-12 ${cellBg}`}
                              title={holiday ? bankHolidayNames[formatDateLocal(date)] : ''}
                            >
                              {req && (
                                <button
                                  onClick={() => {
                                    setSelectedRequest(req)
                                    setReviewNotes('')
                                  }}
                                  className={`w-full h-full text-xs font-medium rounded ${
                                    req.status === 'approved' ? 'bg-green-500 text-white hover:bg-green-600' :
                                    req.status === 'pending' ? 'bg-yellow-300 text-yellow-900 hover:bg-yellow-400 ring-2 ring-yellow-500' :
                                    req.status === 'cancel_pending' ? 'bg-orange-300 text-orange-900 hover:bg-orange-400 ring-2 ring-orange-500' :
                                    'bg-gray-200 text-gray-700'
                                  }`}
                                  title={`${getTypeLabel(req.request_type)} - ${req.status}`}
                                >
                                  {req.request_type === 'holiday' ? '🏖️' :
                                   req.request_type === 'early_finish' ? '🕓' : '🚫'}
                                </button>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 flex flex-wrap gap-3 text-xs text-gray-600">
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 bg-green-500 rounded"></span>
                <span>Approved</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 bg-yellow-300 ring-2 ring-yellow-500 rounded"></span>
                <span>Pending</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 bg-orange-300 ring-2 ring-orange-500 rounded"></span>
                <span>Cancel Pending</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 bg-yellow-100 rounded"></span>
                <span>Weekend</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 bg-red-100 rounded"></span>
                <span>Bank Holiday</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 bg-blue-100 rounded"></span>
                <span>Today</span>
              </div>
            </div>
          </div>
        )}

        {view === 'all' && (
          <div className="space-y-3">
            {allOtherRequests.length === 0 ? (
              <div className="bg-white rounded-xl shadow p-8 text-center">
                <p className="text-gray-400">No other requests yet</p>
              </div>
            ) : (
              allOtherRequests.map((req) => (
                <div
                  key={req.id}
                  className="bg-white rounded-xl shadow p-4 cursor-pointer hover:bg-gray-50 transition"
                  onClick={() => setSelectedRequest(req)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-2xl">{getTypeIcon(req.request_type)}</span>
                        <p className="font-medium text-gray-800">{req.user?.full_name}</p>
                        {req.user?.job_title && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {req.user.job_title}
                          </span>
                        )}
                        {getStatusBadge(req.status)}
                      </div>
                      <p className="text-sm text-gray-700 mt-1">
                        {getTypeLabel(req.request_type)}
                        {' • '}
                        {req.start_date === req.end_date
                          ? formatDate(req.start_date)
                          : `${formatDate(req.start_date)} → ${formatDate(req.end_date)}`}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {selectedRequest && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <h2 className="text-xl font-bold text-gray-800">Review Request</h2>
                  <button onClick={() => setSelectedRequest(null)} className="text-gray-400 text-2xl leading-none">×</button>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Employee</span>
                    <span className="font-medium text-gray-800">{selectedRequest.user?.full_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Job Title</span>
                    <span className="font-medium text-gray-800">{selectedRequest.user?.job_title || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Type</span>
                    <span className="font-medium text-gray-800">
                      {getTypeIcon(selectedRequest.request_type)} {getTypeLabel(selectedRequest.request_type)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Date</span>
                    <span className="font-medium text-gray-800">
                      {selectedRequest.start_date === selectedRequest.end_date
                        ? formatDate(selectedRequest.start_date)
                        : `${formatDate(selectedRequest.start_date)} → ${formatDate(selectedRequest.end_date)}`}
                    </span>
                  </div>
                  {selectedRequest.half_day_type && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Half Day</span>
                      <span className="font-medium capitalize">{selectedRequest.half_day_type}</span>
                    </div>
                  )}
                  {selectedRequest.early_finish_time && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Finish Time</span>
                      <span className="font-medium">{selectedRequest.early_finish_time}</span>
                    </div>
                  )}
                  {selectedRequest.request_type === 'holiday' && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Days</span>
                      <span className="font-medium">{selectedRequest.days_requested}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Status</span>
                    {getStatusBadge(selectedRequest.status)}
                  </div>
                  {selectedRequest.reason && (
                    <div className="pt-2 border-t border-gray-200">
                      <p className="text-sm text-gray-600">Reason</p>
                      <p className="text-gray-800 italic">&ldquo;{selectedRequest.reason}&rdquo;</p>
                    </div>
                  )}
                  {selectedRequest.review_notes && (
                    <div className="pt-2 border-t border-gray-200">
                      <p className="text-sm text-gray-600">Review Notes</p>
                      <p className="text-gray-800 italic">{selectedRequest.review_notes}</p>
                    </div>
                  )}
                </div>

                {selectedRequest.status === 'cancel_pending' && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                    <p className="text-sm text-orange-700 font-medium">
                      ⚠️ This is a cancellation request for an approved holiday.
                    </p>
                    {selectedRequest.request_type === 'holiday' && (
                      <p className="text-xs text-orange-600 mt-1">
                        Approving will refund {selectedRequest.days_requested} days to their balance.
                      </p>
                    )}
                  </div>
                )}

                {(selectedRequest.status === 'pending' || selectedRequest.status === 'cancel_pending') &&
                 selectedRequest.user_id !== currentUser.id && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Notes <span className="text-gray-400">(optional)</span>
                      </label>
                      <textarea
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        rows={2}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                        placeholder="Add a note for the employee..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => handleReject(selectedRequest)}
                        className="bg-red-100 hover:bg-red-200 text-red-700 py-3 rounded-xl font-medium transition"
                      >
                        {selectedRequest.status === 'cancel_pending' ? 'Reject Cancel' : 'Reject'}
                      </button>
                      <button
                        onClick={() => handleApprove(selectedRequest)}
                        className="bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-medium transition"
                      >
                        {selectedRequest.status === 'cancel_pending' ? 'Approve Cancel' : 'Approve'}
                      </button>
                    </div>
                  </>
                )}

                {selectedRequest.user_id === currentUser.id && (
                  <div className="bg-gray-100 text-gray-600 p-3 rounded-xl text-sm text-center">
                    You cannot review your own request
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
