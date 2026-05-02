'use client'

/**
 * /dashboard/holidays — admin/manager review + admin tools + my holidays.
 *
 * Tabs (left to right):
 *   1. Pending           — list of requests waiting for review
 *   2. Calendar          — month grid, employees x days
 *   3. History           — non-pending requests
 *   4. Manage Employee   — admin only: book holidays for staff + adjust balance
 *   5. My Holidays       — book your own time off (admin/manager equivalent of /employee/holidays)
 *
 * Manager filtering applies to Pending / Calendar / History (only their team).
 * Manage Employee is hidden from managers entirely.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getUKBankHolidays } from '@/lib/bankHolidays'
import { holidayYearForDate, isCurrentHolidayYear } from '@/lib/holidayYear'
import { notifyEvent } from '@/lib/notifyEvent'

const supabase = createClient()

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DEFAULT_WORKING_DAYS = {
  sun: false, mon: true, tue: true, wed: true, thu: true, fri: true, sat: false,
}

const ymd = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const formatDate = (s: string) =>
  new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const typeIcon = (t: string) =>
  t === 'holiday' ? '🏖️' : t === 'early_finish' ? '🕓' : t === 'keep_day_off' ? '🚫' : '📅'
const typeLabel = (t: string) =>
  t === 'holiday' ? 'Holiday' : t === 'early_finish' ? 'Early Finish' : t === 'keep_day_off' ? 'Keep Day Off' : t

const statusBadge = (status: string) => {
  const map: Record<string, [string, string]> = {
    pending:        ['Pending',           'bg-yellow-100 text-yellow-700'],
    approved:       ['Approved',          'bg-green-100 text-green-700'],
    rejected:       ['Rejected',          'bg-red-100 text-red-700'],
    cancelled:      ['Cancelled',         'bg-slate-100 text-slate-600'],
    cancel_pending: ['Cancel pending',    'bg-orange-100 text-orange-700'],
  }
  const [label, cls] = map[status] || [status, 'bg-slate-100 text-slate-600']
  return <span className={`text-xs px-2 py-1 rounded-full font-medium ${cls}`}>{label}</span>
}

type TabKey = 'pending' | 'calendar' | 'history' | 'manage' | 'mine'

export default function DashboardHolidaysPage() {
  const router = useRouter()
  const [me, setMe] = useState<any>(null)
  const [companyName, setCompanyName] = useState('')
  const [company, setCompany] = useState<any>(null)
  const [requests, setRequests] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [managerTitles, setManagerTitles] = useState<string[]>([])
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set())
  const [bankHolidayNames, setBankHolidayNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('pending')
  const [selected, setSelected] = useState<any>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [calendarMonth, setCalendarMonth] = useState(new Date())

  // Manage Employee state
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [manageType, setManageType] = useState<'holiday'|'early_finish'|'keep_day_off'>('holiday')
  const [manageStartDate, setManageStartDate] = useState('')
  const [manageEndDate, setManageEndDate] = useState('')
  const [manageIsHalfDay, setManageIsHalfDay] = useState(false)
  const [manageHalfDayType, setManageHalfDayType] = useState<'morning'|'afternoon'>('morning')
  const [manageEarlyFinishTime, setManageEarlyFinishTime] = useState('')
  const [manageReason, setManageReason] = useState('')
  const [submittingManage, setSubmittingManage] = useState(false)
  const [adjustmentAmount, setAdjustmentAmount] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [submittingAdjust, setSubmittingAdjust] = useState(false)

  // My Holidays state
  const [showMyForm, setShowMyForm] = useState(false)
  const [submittingMy, setSubmittingMy] = useState(false)
  const [myType, setMyType] = useState<'holiday'|'early_finish'|'keep_day_off'>('holiday')
  const [myStartDate, setMyStartDate] = useState('')
  const [myEndDate, setMyEndDate] = useState('')
  const [myIsHalfDay, setMyIsHalfDay] = useState(false)
  const [myHalfDayType, setMyHalfDayType] = useState<'morning'|'afternoon'>('morning')
  const [myEarlyFinishTime, setMyEarlyFinishTime] = useState('')
  const [myReason, setMyReason] = useState('')

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg); setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  // ─── Loaders ────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, role, full_name, company_id, holiday_entitlement, working_days')
        .eq('id', user.id).single()
      if (!profile?.company_id) return
      setMe(profile)

      const { data: c } = await supabase
        .from('companies')
        .select('id, name, holiday_year_start, allow_half_days, allow_early_finish')
        .eq('id', profile.company_id).single()
      setCompany(c)
      setCompanyName(c?.name || '')

      if (profile.role === 'manager') {
        const { data: titles } = await supabase
          .from('manager_job_titles')
          .select('job_title').eq('manager_id', user.id)
        setManagerTitles((titles || []).map((t: any) => t.job_title))
      }

      // All company users (for calendar rows + Manage Employee dropdown)
      const uRes = await fetch('/api/get-company-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: profile.company_id }),
      })
      const uData = await uRes.json()
      if (Array.isArray(uData.users)) setUsers(uData.users)

      // All company requests
      const res = await fetch('/api/get-holiday-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: profile.company_id, scope: 'company' }),
      })
      const data = await res.json()
      if (Array.isArray(data.requests)) setRequests(data.requests)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
    getUKBankHolidays().then(d => {
      setBankHolidays(d.dates)
      setBankHolidayNames(d.names)
    })
  }, [load])

  // ─── Derived ────────────────────────────────────────────────
  const isAdmin = me?.role === 'admin'
  const isManager = me?.role === 'manager'

  const visibleRequests = useMemo(() => {
    if (!me) return []
    if (isAdmin) return requests
    if (isManager) {
      return requests.filter((r: any) => r.user?.job_title && managerTitles.includes(r.user.job_title))
    }
    return []
  }, [me, isAdmin, isManager, requests, managerTitles])

  const visibleUsers = useMemo(() => {
    if (!me) return []
    if (isAdmin) return users.filter(u => !u.is_frozen && !u.is_deleted)
    if (isManager) return users.filter(u =>
      !u.is_frozen && !u.is_deleted && u.job_title && managerTitles.includes(u.job_title))
    return []
  }, [me, isAdmin, isManager, users, managerTitles])

  const manageableEmployees = useMemo(
    () => visibleUsers.filter(u => u.id !== me?.id),
    [visibleUsers, me]
  )

  const pending = visibleRequests.filter(r => r.status === 'pending' || r.status === 'cancel_pending')
  const history = visibleRequests.filter(r => r.status !== 'pending' && r.status !== 'cancel_pending')

  // My Holidays — filter by current user
  const myRequests = useMemo(
    () => requests.filter(r => r.user_id === me?.id),
    [requests, me]
  )

  const selectedEmployee = users.find(u => u.id === selectedEmployeeId)

  // ─── Day calculation helper ─────────────────────────────────
  const calcDays = (
    type: string, startStr: string, endStr: string,
    workingDays: any, halfDay: boolean,
  ) => {
    if (type !== 'holiday') return 0
    if (!startStr || !endStr) return 0
    const s = new Date(startStr); const e = new Date(endStr)
    if (e < s) return 0
    let count = 0
    const cur = new Date(s)
    while (cur <= e) {
      const k = DAY_KEYS[cur.getDay()]
      if (workingDays[k] && !bankHolidays.has(ymd(cur))) count++
      cur.setDate(cur.getDate() + 1)
    }
    if (halfDay && count === 1) return 0.5
    return count
  }

  // Manage tab calc
  const manageDaysRequested = calcDays(
    manageType, manageStartDate, manageEndDate,
    selectedEmployee?.working_days || DEFAULT_WORKING_DAYS,
    manageIsHalfDay,
  )
  const employeeBalance = selectedEmployee?.holiday_entitlement || 0
  const balanceAfterManage = employeeBalance - manageDaysRequested
  const manageIsCurrent = manageStartDate && company
    ? isCurrentHolidayYear(manageStartDate, company.holiday_year_start)
    : true
  const manageYearLabel = manageStartDate && company
    ? holidayYearForDate(manageStartDate, company.holiday_year_start).label
    : null

  // My Holidays calc
  const myDaysRequested = calcDays(
    myType, myStartDate, myEndDate,
    me?.working_days || DEFAULT_WORKING_DAYS, myIsHalfDay,
  )
  const myBalance = me?.holiday_entitlement || 0
  const myBalanceAfter = myBalance - myDaysRequested
  const myIsCurrent = myStartDate && company
    ? isCurrentHolidayYear(myStartDate, company.holiday_year_start)
    : true
  const myYearLabel = myStartDate && company
    ? holidayYearForDate(myStartDate, company.holiday_year_start).label
    : null

  // ─── Action handlers ────────────────────────────────────────
  const handleApprove = async (req: any) => {
    if (req.user_id === me?.id) {
      showMessage('You cannot approve your own request', 'error'); return
    }
    setBusy(true)
    const action = req.status === 'cancel_pending' ? 'approve_cancel' : 'approve'
    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action, request_id: req.id,
        reviewer_id: me.id, reviewer_email: me.email, reviewer_role: me.role,
        review_notes: reviewNotes,
      }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { showMessage('Error: ' + (data.error || 'unknown'), 'error'); return }

    // Phone push to the requester. Only fires for approve/reject of
    // an actual holiday (not the cancellation flows).
    if (action === 'approve') {
      await notifyEvent({ kind: 'holiday_decided', request_id: req.id })
    }

    showMessage(action === 'approve_cancel' ? 'Cancellation approved' : 'Request approved', 'success')
    setSelected(null); setReviewNotes('')
    load()
  }

  const handleReject = async (req: any) => {
    if (req.user_id === me?.id) {
      showMessage('You cannot reject your own request', 'error'); return
    }
    setBusy(true)
    const action = req.status === 'cancel_pending' ? 'reject_cancel' : 'reject'
    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action, request_id: req.id,
        reviewer_id: me.id, reviewer_email: me.email, reviewer_role: me.role,
        review_notes: reviewNotes,
      }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { showMessage('Error: ' + (data.error || 'unknown'), 'error'); return }

    // Phone push to the requester. Only fires for reject of an actual
    // holiday (not the cancellation flows).
    if (action === 'reject') {
      await notifyEvent({ kind: 'holiday_decided', request_id: req.id })
    }

    showMessage(action === 'reject_cancel' ? 'Cancellation rejected' : 'Request rejected', 'success')
    setSelected(null); setReviewNotes('')
    load()
  }

  const handleAdminCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployeeId) { showMessage('Please select an employee', 'error'); return }
    if (manageType === 'holiday' && manageIsCurrent && manageDaysRequested > employeeBalance) {
      showMessage(`Employee doesn't have enough balance (${employeeBalance} available)`, 'error'); return
    }
    if (manageType === 'holiday' && manageDaysRequested === 0) {
      showMessage('Selected dates contain no working days', 'error'); return
    }
    setSubmittingManage(true)
    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'admin_create',
        target_user_id: selectedEmployeeId,
        company_id: me.company_id,
        request_type: manageType,
        start_date: manageStartDate,
        end_date: manageType === 'early_finish' || manageType === 'keep_day_off' ? manageStartDate : manageEndDate,
        half_day_type: manageIsHalfDay ? manageHalfDayType : null,
        early_finish_time: manageType === 'early_finish' ? manageEarlyFinishTime : null,
        reason: manageReason || `Created by ${me.role} ${me.full_name}`,
        days_requested: manageDaysRequested,
        reviewer_id: me.id, reviewer_email: me.email, reviewer_role: me.role,
        review_notes: `Auto-approved by ${me.role}`,
      }),
    })
    const data = await res.json()
    setSubmittingManage(false)
    if (!res.ok) { showMessage('Error: ' + (data.error || 'unknown'), 'error'); return }
    showMessage('Holiday added and auto-approved', 'success')
    setManageStartDate(''); setManageEndDate(''); setManageIsHalfDay(false); setManageReason(''); setManageEarlyFinishTime('')
    load()
  }

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployeeId) { showMessage('Please select an employee', 'error'); return }
    if (!adjustmentAmount || isNaN(parseFloat(adjustmentAmount))) {
      showMessage('Please enter a valid number', 'error'); return
    }
    if (!adjustmentReason.trim()) {
      showMessage('Please provide a reason', 'error'); return
    }
    setSubmittingAdjust(true)
    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'adjust_balance',
        target_user_id: selectedEmployeeId,
        adjustment_amount: parseFloat(adjustmentAmount),
        adjustment_reason: adjustmentReason,
        reviewer_id: me.id, reviewer_email: me.email, reviewer_role: me.role,
      }),
    })
    const data = await res.json()
    setSubmittingAdjust(false)
    if (!res.ok) { showMessage('Error: ' + (data.error || 'unknown'), 'error'); return }
    showMessage(`Balance adjusted (now ${data.balance_after})`, 'success')
    setAdjustmentAmount(''); setAdjustmentReason('')
    load()
  }

  const handleMyCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (myType === 'holiday' && myIsCurrent && myDaysRequested > myBalance) {
      showMessage(`You don't have enough balance (${myBalance} available)`, 'error'); return
    }
    if (myType === 'holiday' && myDaysRequested === 0) {
      showMessage('Selected dates contain no working days for you', 'error'); return
    }
    if (myIsHalfDay && myStartDate !== myEndDate) {
      showMessage('Half day must be a single date', 'error'); return
    }
    setSubmittingMy(true)
    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        user_id: me.id,
        company_id: me.company_id,
        request_type: myType,
        start_date: myStartDate,
        end_date: myType === 'early_finish' || myType === 'keep_day_off' ? myStartDate : myEndDate,
        half_day_type: myIsHalfDay ? myHalfDayType : null,
        early_finish_time: myType === 'early_finish' ? myEarlyFinishTime : null,
        reason: myReason || null,
        days_requested: myDaysRequested,
      }),
    })
    const data = await res.json()
    setSubmittingMy(false)
    if (!res.ok) { showMessage('Error: ' + (data.error || 'unknown'), 'error'); return }
    showMessage('Request submitted', 'success')
    setMyStartDate(''); setMyEndDate(''); setMyIsHalfDay(false); setMyReason(''); setMyEarlyFinishTime('')
    setShowMyForm(false)
    load()
  }

  const handleCancelMyRequest = async (req: any) => {
    if (req.status === 'pending') {
      if (!confirm('Cancel this pending request?')) return
      await fetch('/api/holiday-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_pending', request_id: req.id, user_id: me.id }),
      })
      showMessage('Request cancelled', 'success')
    } else if (req.status === 'approved') {
      if (!confirm('Send a cancellation request? Your days will be returned if approved.')) return
      await fetch('/api/holiday-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_cancel', request_id: req.id, user_id: me.id }),
      })
      showMessage('Cancellation requested', 'success')
    }
    setSelected(null)
    load()
  }

  // ─── Calendar helpers ───────────────────────────────────────
  const monthDates = useMemo(() => {
    const y = calendarMonth.getFullYear()
    const m = calendarMonth.getMonth()
    const lastDay = new Date(y, m + 1, 0).getDate()
    const arr: Date[] = []
    for (let d = 1; d <= lastDay; d++) arr.push(new Date(y, m, d))
    return arr
  }, [calendarMonth])

  const monthName = calendarMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6
  const isToday = (d: Date) => d.toDateString() === new Date().toDateString()
  const isBankHoliday = (d: Date) => bankHolidays.has(ymd(d))

  const getRequestForUserDate = (userId: string, date: Date) => {
    const dateStr = ymd(date)
    return visibleRequests.find((r: any) => {
      if (r.user_id !== userId) return false
      if (!['approved', 'pending', 'cancel_pending'].includes(r.status)) return false
      return dateStr >= r.start_date && dateStr <= r.end_date
    })
  }

  // ─── Render ─────────────────────────────────────────────────
  if (loading) return <div className="p-8 text-slate-400 italic">Loading…</div>

  const today = ymd(new Date())

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Holidays</h1>
      <p className="text-sm text-slate-500 mb-6">{companyName}</p>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
          messageType === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
        }`}>{message}</div>
      )}

      {isManager && managerTitles.length === 0 && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          You don&apos;t have any job titles assigned. Ask your admin.
        </div>
      )}

      {isManager && managerTitles.length > 0 && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
          Showing requests from staff with job titles: <strong>{managerTitles.join(', ')}</strong>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
        <TabButton label="Pending Approval" active={tab === 'pending'} count={pending.length} onClick={() => setTab('pending')} />
        <TabButton label="Calendar"   active={tab === 'calendar'}    onClick={() => setTab('calendar')} />
        <TabButton label="History"    active={tab === 'history'}     onClick={() => setTab('history')} />
        {isAdmin && (
          <TabButton label="Manage Employee" active={tab === 'manage'} onClick={() => setTab('manage')} />
        )}
        <TabButton label="My Holidays" active={tab === 'mine'} onClick={() => setTab('mine')} />
      </div>

      {/* PENDING TAB */}
      {tab === 'pending' && (
        <div className="space-y-3">
          {pending.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
              <p className="text-slate-400">No pending requests 🎉</p>
            </div>
          ) : (
            pending.map(req => (
              <div key={req.id}
                className={`bg-white rounded-xl shadow-sm p-4 border-l-4 border border-slate-200 ${
                  req.status === 'cancel_pending' ? 'border-l-orange-500' : 'border-l-yellow-500'
                }`}>
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-2xl">{typeIcon(req.request_type)}</span>
                      <p className="font-semibold text-slate-800">{req.user?.full_name || req.user?.email}</p>
                      {req.user?.job_title && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{req.user.job_title}</span>
                      )}
                      {statusBadge(req.status)}
                      {req.request_type === 'holiday' && !req.is_current_year && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                          Next year ({req.holiday_year_label})
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 mt-2">
                      <span className="font-medium">{typeLabel(req.request_type)}</span>{' • '}
                      {req.start_date === req.end_date ? formatDate(req.start_date) : `${formatDate(req.start_date)} → ${formatDate(req.end_date)}`}
                    </p>
                    {req.half_day_type && <p className="text-xs text-slate-500 mt-1 capitalize">Half day ({req.half_day_type})</p>}
                    {req.early_finish_time && <p className="text-xs text-slate-500 mt-1">Finish at {req.early_finish_time}</p>}
                    {req.request_type === 'holiday' && (
                      <p className="text-xs text-slate-500 mt-1">{req.days_requested} day{req.days_requested !== 1 ? 's' : ''}</p>
                    )}
                    {req.reason && <p className="text-sm text-slate-600 mt-2 italic">&ldquo;{req.reason}&rdquo;</p>}
                    {req.status === 'cancel_pending' && req.request_type === 'holiday' && req.is_current_year && (
                      <p className="text-xs text-orange-600 mt-2 font-medium">
                        ⚠️ Approving will refund {req.days_requested} day{req.days_requested !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {req.user_id === me?.id ? (
                      <p className="text-xs text-slate-400 italic">Your own request</p>
                    ) : (
                      <button onClick={() => { setSelected(req); setReviewNotes('') }}
                        className="text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-4 py-2 rounded-lg transition">
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

      {/* CALENDAR TAB */}
      {tab === 'calendar' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <button
              onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
              className="text-2xl text-slate-600 hover:text-slate-800 px-3 py-1">‹</button>
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-slate-800">{monthName}</h3>
              <button onClick={() => setCalendarMonth(new Date())}
                className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-full text-slate-700">
                Today
              </button>
            </div>
            <button
              onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
              className="text-2xl text-slate-600 hover:text-slate-800 px-3 py-1">›</button>
          </div>

          <div className="overflow-x-auto">
            {visibleUsers.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No users to display</div>
            ) : (
              <table className="border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 bg-white border-r border-b border-slate-300 px-3 py-2 text-left text-xs font-semibold text-slate-700 min-w-48">
                      Employee
                    </th>
                    {monthDates.map(date => {
                      const wknd = isWeekend(date); const tdy = isToday(date); const bh = isBankHoliday(date)
                      return (
                        <th key={date.toISOString()}
                          className={`border-r border-b border-slate-300 px-1 py-2 text-xs font-medium text-center min-w-10 ${
                            tdy ? 'bg-blue-100 text-blue-700' :
                            bh ? 'bg-red-100 text-red-700' :
                            wknd ? 'bg-yellow-100 text-yellow-700' :
                            'bg-slate-50 text-slate-600'
                          }`}
                          title={bh ? bankHolidayNames[ymd(date)] : ''}>
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
                  {visibleUsers.map(user => (
                    <tr key={user.id}>
                      <td className="sticky left-0 z-10 bg-white border-r border-b border-slate-200 px-3 py-2 text-sm">
                        <p className="font-medium text-slate-800 truncate">{user.full_name}</p>
                        {user.job_title && <p className="text-[10px] text-slate-500">{user.job_title}</p>}
                      </td>
                      {monthDates.map(date => {
                        const wknd = isWeekend(date); const tdy = isToday(date); const bh = isBankHoliday(date)
                        const req = getRequestForUserDate(user.id, date)
                        let cellBg = ''
                        if (tdy) cellBg = 'bg-blue-50'
                        else if (bh) cellBg = 'bg-red-50'
                        else if (wknd) cellBg = 'bg-yellow-50'
                        return (
                          <td key={date.toISOString()}
                            className={`border-r border-b border-slate-200 p-0.5 text-center min-w-10 h-12 ${cellBg}`}
                            title={bh ? bankHolidayNames[ymd(date)] : ''}>
                            {req && (
                              <button onClick={() => { setSelected(req); setReviewNotes('') }}
                                className={`w-full h-full rounded ${
                                  req.status === 'approved' ? 'bg-green-500 hover:bg-green-600' :
                                  req.status === 'pending' ? 'bg-yellow-300 hover:bg-yellow-400 ring-2 ring-yellow-500' :
                                  req.status === 'cancel_pending' ? 'bg-orange-300 hover:bg-orange-400 ring-2 ring-orange-500' :
                                  'bg-slate-200'
                                }`}
                                title={`${typeLabel(req.request_type)} - ${req.status}`}
                                aria-label={`${typeLabel(req.request_type)} - ${req.status}`}
                              />
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

          <div className="p-4 border-t border-slate-200 flex flex-wrap gap-3 text-xs text-slate-600">
            <Legend swatch="bg-green-500" label="Approved" />
            <Legend swatch="bg-yellow-300 ring-2 ring-yellow-500" label="Pending" />
            <Legend swatch="bg-orange-300 ring-2 ring-orange-500" label="Cancel pending" />
            <Legend swatch="bg-yellow-100" label="Weekend" />
            <Legend swatch="bg-red-100" label="Bank holiday" />
            <Legend swatch="bg-blue-100" label="Today" />
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === 'history' && (
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
              <p className="text-slate-400">No history yet</p>
            </div>
          ) : (
            history.map(req => (
              <div key={req.id} onClick={() => setSelected(req)}
                className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 cursor-pointer hover:bg-slate-50 transition">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-2xl">{typeIcon(req.request_type)}</span>
                  <p className="font-medium text-slate-800">{req.user?.full_name || req.user?.email}</p>
                  {req.user?.job_title && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{req.user.job_title}</span>
                  )}
                  {statusBadge(req.status)}
                  {req.request_type === 'holiday' && !req.is_current_year && (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Next year</span>
                  )}
                </div>
                <p className="text-sm text-slate-700 mt-1">
                  {typeLabel(req.request_type)}{' • '}
                  {req.start_date === req.end_date ? formatDate(req.start_date) : `${formatDate(req.start_date)} → ${formatDate(req.end_date)}`}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {/* MANAGE EMPLOYEE TAB (admin only) */}
      {tab === 'manage' && isAdmin && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Manage Employee Holidays</h3>
            <p className="text-sm text-slate-600 mb-4">
              Add a holiday on behalf of an employee (auto-approved) or adjust their balance directly.
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Select Employee</label>
              <select value={selectedEmployeeId}
                onChange={e => setSelectedEmployeeId(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-3 text-slate-900 bg-white">
                <option value="">— Select an employee —</option>
                {manageableEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} {emp.job_title ? `(${emp.job_title})` : ''}
                  </option>
                ))}
              </select>
              {manageableEmployees.length === 0 && (
                <p className="text-sm text-slate-500 mt-2 italic">No employees available.</p>
              )}
            </div>

            {selectedEmployee && (
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-slate-800">{selectedEmployee.full_name}</p>
                    <p className="text-sm text-slate-600">{selectedEmployee.email}</p>
                    {selectedEmployee.job_title && (
                      <p className="text-xs text-slate-500 mt-1">{selectedEmployee.job_title}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Current Balance</p>
                    <p className="text-2xl font-bold text-blue-700">
                      {selectedEmployee.holiday_entitlement ?? '—'}
                      {selectedEmployee.holiday_entitlement !== null && selectedEmployee.holiday_entitlement !== undefined && (
                        <span className="text-sm font-normal"> days</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {selectedEmployee && (
            <>
              {/* Add Holiday */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h4 className="text-md font-semibold text-slate-800 mb-4">
                  Add Holiday for {selectedEmployee.full_name}
                </h4>
                <form onSubmit={handleAdminCreate} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                    <select value={manageType} onChange={e => setManageType(e.target.value as any)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-3 text-slate-900 bg-white">
                      <option value="holiday">🏖️ Holiday — Take time off (deducts from balance)</option>
                      {company?.allow_early_finish && (
                        <option value="early_finish">🕓 Early Finish</option>
                      )}
                      <option value="keep_day_off">🚫 Keep Day Off</option>
                    </select>
                  </div>

                  {manageType === 'holiday' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                        <input type="date" value={manageStartDate} onChange={e => setManageStartDate(e.target.value)} required
                          className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                        <input type="date" value={manageEndDate} min={manageStartDate} onChange={e => setManageEndDate(e.target.value)} required
                          className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                      <input type="date" value={manageStartDate} onChange={e => setManageStartDate(e.target.value)} required
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                    </div>
                  )}

                  {manageType === 'holiday' && company?.allow_half_days && manageStartDate === manageEndDate && manageStartDate && manageDaysRequested > 0 && (
                    <div>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={manageIsHalfDay} onChange={e => setManageIsHalfDay(e.target.checked)} className="w-4 h-4" />
                        <span className="text-sm font-medium text-slate-700">Half day only</span>
                      </label>
                      {manageIsHalfDay && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setManageHalfDayType('morning')}
                            className={`p-2 rounded-xl border-2 text-sm font-medium ${manageHalfDayType === 'morning' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                            🌅 Morning
                          </button>
                          <button type="button" onClick={() => setManageHalfDayType('afternoon')}
                            className={`p-2 rounded-xl border-2 text-sm font-medium ${manageHalfDayType === 'afternoon' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                            🌇 Afternoon
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {manageType === 'early_finish' && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Finish Time</label>
                      <input type="time" value={manageEarlyFinishTime} onChange={e => setManageEarlyFinishTime(e.target.value)} required
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Reason / Notes <span className="text-slate-400">(optional)</span>
                    </label>
                    <textarea value={manageReason} onChange={e => setManageReason(e.target.value)} rows={2}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                      placeholder="Why are you adding this?" />
                  </div>

                  {manageType === 'holiday' && manageStartDate && !manageIsCurrent && (
                    <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm">
                      <p className="text-blue-800 font-medium">📅 This is for next holiday year ({manageYearLabel})</p>
                      <p className="text-xs text-blue-700 mt-1">
                        Balance won&apos;t be deducted now — it only counts when next year starts.
                      </p>
                    </div>
                  )}

                  {manageType === 'holiday' && manageStartDate && manageEndDate && (
                    <div className={`p-4 rounded-xl border ${
                      manageIsCurrent && balanceAfterManage < 0 ? 'bg-red-50 border-red-200' :
                      manageDaysRequested === 0 ? 'bg-yellow-50 border-yellow-200' :
                      'bg-blue-50 border-blue-200'
                    }`}>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-700">Working days</span>
                        <span className="font-bold text-slate-900">{manageDaysRequested}</span>
                      </div>
                      {manageIsCurrent && (
                        <>
                          <div className="flex justify-between text-sm mt-1">
                            <span className="text-slate-700">Current balance</span>
                            <span className="font-bold text-slate-900">{employeeBalance}</span>
                          </div>
                          <div className="flex justify-between text-sm mt-1 pt-1 border-t border-blue-200">
                            <span className="text-slate-700">Balance after</span>
                            <span className={`font-bold ${balanceAfterManage < 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {balanceAfterManage}
                            </span>
                          </div>
                        </>
                      )}
                      {manageDaysRequested === 0 && (
                        <p className="text-xs text-yellow-700 mt-2">⚠️ No working days for this employee in those dates</p>
                      )}
                      {manageIsCurrent && balanceAfterManage < 0 && (
                        <p className="text-xs text-red-600 mt-2">⚠️ Not enough balance</p>
                      )}
                    </div>
                  )}

                  <button type="submit"
                    disabled={submittingManage || (manageType === 'holiday' && (manageDaysRequested === 0 || (manageIsCurrent && balanceAfterManage < 0)))}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition disabled:opacity-50">
                    {submittingManage ? 'Adding…' : 'Add Holiday (Auto-Approved)'}
                  </button>
                </form>
              </div>

              {/* Adjust Balance */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h4 className="text-md font-semibold text-slate-800 mb-2">Adjust Balance</h4>
                <p className="text-sm text-slate-600 mb-4">
                  Add or remove days. Use a negative number to deduct.
                </p>
                <form onSubmit={handleAdjustBalance} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Adjustment <span className="text-slate-400">(e.g. 2 to add, -1 to deduct)</span>
                    </label>
                    <input type="number" step="0.5" value={adjustmentAmount} onChange={e => setAdjustmentAmount(e.target.value)} required
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" placeholder="e.g. 2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
                    <textarea value={adjustmentReason} onChange={e => setAdjustmentReason(e.target.value)} rows={2} required
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                      placeholder="e.g. Long service bonus, Manual correction" />
                  </div>
                  {adjustmentAmount && !isNaN(parseFloat(adjustmentAmount)) && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-700">Current balance</span>
                        <span className="font-bold">{employeeBalance}</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-slate-700">Adjustment</span>
                        <span className="font-bold">
                          {parseFloat(adjustmentAmount) > 0 ? '+' : ''}{adjustmentAmount}
                        </span>
                      </div>
                      <div className="flex justify-between mt-1 pt-1 border-t border-blue-200">
                        <span className="text-slate-700">New balance</span>
                        <span className="font-bold text-blue-700">
                          {(employeeBalance + parseFloat(adjustmentAmount)).toFixed(1)}
                        </span>
                      </div>
                    </div>
                  )}
                  <button type="submit" disabled={submittingAdjust}
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white py-3 rounded-xl font-medium transition disabled:opacity-50">
                    {submittingAdjust ? 'Adjusting…' : 'Adjust Balance'}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      )}

      {/* MY HOLIDAYS TAB */}
      {tab === 'mine' && (
        <div className="space-y-4">
          {/* Balance card */}
          <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl shadow-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-90">Your Holiday Balance</p>
                <p className="text-4xl font-bold mt-1">
                  {myBalance} <span className="text-lg font-normal">days</span>
                </p>
                <p className="text-xs opacity-80 mt-1">
                  Working {Object.values(me?.working_days || DEFAULT_WORKING_DAYS).filter(Boolean).length} days per week
                </p>
              </div>
              <div className="text-6xl opacity-80">🏖️</div>
            </div>
          </div>

          {!showMyForm && (
            <button onClick={() => setShowMyForm(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium shadow-md transition">
              + New Request
            </button>
          )}

          {showMyForm && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800">New Request</h2>
                <button onClick={() => setShowMyForm(false)} className="text-slate-400 text-xl leading-none">✕</button>
              </div>

              <form onSubmit={handleMyCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                  <select value={myType} onChange={e => setMyType(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-3 text-slate-900 bg-white">
                    <option value="holiday">🏖️ Holiday</option>
                    {company?.allow_early_finish && <option value="early_finish">🕓 Early Finish</option>}
                    <option value="keep_day_off">🚫 Keep Day Off</option>
                  </select>
                </div>

                {myType === 'holiday' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Start</label>
                      <input type="date" value={myStartDate} min={today} onChange={e => setMyStartDate(e.target.value)} required
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">End</label>
                      <input type="date" value={myEndDate} min={myStartDate || today} onChange={e => setMyEndDate(e.target.value)} required
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                    <input type="date" value={myStartDate} min={today} onChange={e => setMyStartDate(e.target.value)} required
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                  </div>
                )}

                {myType === 'holiday' && company?.allow_half_days && myStartDate === myEndDate && myStartDate && myDaysRequested > 0 && (
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={myIsHalfDay} onChange={e => setMyIsHalfDay(e.target.checked)} className="w-4 h-4" />
                      <span className="text-sm font-medium text-slate-700">Half day only</span>
                    </label>
                    {myIsHalfDay && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setMyHalfDayType('morning')}
                          className={`p-2 rounded-xl border-2 text-sm font-medium ${myHalfDayType === 'morning' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                          🌅 Morning
                        </button>
                        <button type="button" onClick={() => setMyHalfDayType('afternoon')}
                          className={`p-2 rounded-xl border-2 text-sm font-medium ${myHalfDayType === 'afternoon' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                          🌇 Afternoon
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {myType === 'early_finish' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Finish time</label>
                    <input type="time" value={myEarlyFinishTime} onChange={e => setMyEarlyFinishTime(e.target.value)} required
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Reason <span className="text-slate-400">(optional)</span>
                  </label>
                  <textarea value={myReason} onChange={e => setMyReason(e.target.value)} rows={2}
                    placeholder="e.g. Family wedding"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                </div>

                {myType === 'holiday' && myStartDate && !myIsCurrent && (
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm">
                    <p className="text-blue-800 font-medium">📅 This is for next holiday year ({myYearLabel})</p>
                    <p className="text-xs text-blue-700 mt-1">
                      Your current balance won&apos;t change when this gets approved.
                    </p>
                  </div>
                )}

                {myType === 'holiday' && myStartDate && myEndDate && (
                  <div className={`p-4 rounded-xl border ${
                    myIsCurrent && myBalanceAfter < 0 ? 'bg-red-50 border-red-200' :
                    myDaysRequested === 0 ? 'bg-yellow-50 border-yellow-200' :
                    'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700">Working days requested</span>
                      <span className="font-bold text-slate-900">{myDaysRequested}</span>
                    </div>
                    {myIsCurrent && (
                      <>
                        <div className="flex justify-between text-sm mt-1">
                          <span className="text-slate-700">Current balance</span>
                          <span className="font-bold text-slate-900">{myBalance}</span>
                        </div>
                        <div className="flex justify-between text-sm mt-1 pt-1 border-t border-slate-200">
                          <span className="text-slate-700">Balance after approval</span>
                          <span className={`font-bold ${myBalanceAfter < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {myBalanceAfter}
                          </span>
                        </div>
                      </>
                    )}
                    {myDaysRequested === 0 && (
                      <p className="text-xs text-yellow-700 mt-2">⚠️ No working days in those dates</p>
                    )}
                    {myIsCurrent && myBalanceAfter < 0 && (
                      <p className="text-xs text-red-600 mt-2">⚠️ Not enough balance</p>
                    )}
                  </div>
                )}

                <button type="submit"
                  disabled={submittingMy || (myType === 'holiday' && (myDaysRequested === 0 || (myIsCurrent && myBalanceAfter < 0)))}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition disabled:opacity-50">
                  {submittingMy ? 'Submitting…' : 'Submit Request'}
                </button>
              </form>
            </div>
          )}

          {/* My request list */}
          {!showMyForm && (
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">Your Requests</h2>
              {myRequests.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
                  <p className="text-slate-400 text-sm">No requests yet.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {myRequests.map(req => (
                    <li key={req.id} onClick={() => setSelected(req)}
                      className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 cursor-pointer hover:bg-slate-50 transition">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="text-2xl">{typeIcon(req.request_type)}</div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-800 truncate">
                              {req.start_date === req.end_date ? formatDate(req.start_date) : `${formatDate(req.start_date)} → ${formatDate(req.end_date)}`}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <p className="text-xs text-slate-500">{typeLabel(req.request_type)}</p>
                              {req.request_type === 'holiday' && (
                                <p className="text-xs text-slate-500">• {req.days_requested} days</p>
                              )}
                              {req.request_type === 'holiday' && !req.is_current_year && (
                                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Next year</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="ml-2">{statusBadge(req.status)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* REVIEW MODAL */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-start">
                <h2 className="text-xl font-bold text-slate-800">
                  {selected.user_id === me?.id ? 'Request Details' : 'Review Request'}
                </h2>
                <button onClick={() => { setSelected(null); setReviewNotes('') }}
                  className="text-slate-400 text-2xl leading-none">×</button>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                <Row label="Employee" value={selected.user?.full_name || selected.user?.email} />
                <Row label="Type" value={`${typeIcon(selected.request_type)} ${typeLabel(selected.request_type)}`} />
                <Row label="Date" value={selected.start_date === selected.end_date
                  ? formatDate(selected.start_date)
                  : `${formatDate(selected.start_date)} → ${formatDate(selected.end_date)}`} />
                {selected.half_day_type && <Row label="Half Day" value={selected.half_day_type} capitalize />}
                {selected.early_finish_time && <Row label="Finish Time" value={selected.early_finish_time} />}
                {selected.request_type === 'holiday' && (
                  <Row label="Days" value={String(selected.days_requested)} />
                )}
                {selected.request_type === 'holiday' && (
                  <Row label="Year" value={`${selected.holiday_year_label} ${selected.is_current_year ? '(current)' : '(next)'}`} />
                )}
                <div className="flex justify-between">
                  <span className="text-slate-600">Status</span>
                  {statusBadge(selected.status)}
                </div>
                {selected.reason && (
                  <div className="pt-2 border-t border-slate-200">
                    <p className="text-slate-600">Reason</p>
                    <p className="text-slate-800 italic">&ldquo;{selected.reason}&rdquo;</p>
                  </div>
                )}
                {selected.review_notes && (
                  <div className="pt-2 border-t border-slate-200">
                    <p className="text-slate-600">Review Notes</p>
                    <p className="text-slate-800 italic">{selected.review_notes}</p>
                  </div>
                )}
              </div>

              {selected.status === 'cancel_pending' && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm">
                  <p className="text-orange-700 font-medium">⚠️ Cancellation request for an approved holiday.</p>
                  {selected.request_type === 'holiday' && selected.is_current_year && (
                    <p className="text-xs text-orange-600 mt-1">
                      Approving will refund {selected.days_requested} days to their balance.
                    </p>
                  )}
                </div>
              )}

              {selected.request_type === 'holiday' && !selected.is_current_year && selected.status === 'pending' && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                  📅 This is a <strong>next-year</strong> request. Approving won&apos;t deduct from current balance.
                </div>
              )}

              {/* Approve/Reject (when reviewing someone else's pending) */}
              {(selected.status === 'pending' || selected.status === 'cancel_pending') && selected.user_id !== me?.id && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Notes <span className="text-slate-400">(optional)</span>
                    </label>
                    <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2}
                      placeholder="Add a note for the employee…"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => handleReject(selected)} disabled={busy}
                      className="bg-red-100 hover:bg-red-200 text-red-700 py-3 rounded-xl font-medium transition disabled:opacity-50">
                      {selected.status === 'cancel_pending' ? 'Reject Cancel' : 'Reject'}
                    </button>
                    <button onClick={() => handleApprove(selected)} disabled={busy}
                      className="bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-medium transition disabled:opacity-50">
                      {busy ? 'Saving…' : (selected.status === 'cancel_pending' ? 'Approve Cancel' : 'Approve')}
                    </button>
                  </div>
                </>
              )}

              {/* Cancel actions for own request */}
              {selected.user_id === me?.id && selected.status === 'pending' && (
                <button onClick={() => handleCancelMyRequest(selected)}
                  className="w-full bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 py-3 rounded-xl font-medium transition">
                  Cancel Request
                </button>
              )}
              {selected.user_id === me?.id && selected.status === 'approved' && (
                <button onClick={() => handleCancelMyRequest(selected)}
                  className="w-full bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 py-3 rounded-xl font-medium transition">
                  Request Cancellation
                </button>
              )}
              {selected.user_id === me?.id && selected.status === 'cancel_pending' && (
                <div className="bg-orange-50 border border-orange-200 text-orange-700 p-3 rounded-xl text-sm text-center">
                  Your cancellation is awaiting approval
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── small reusable bits ──────────────────────────────────────────

function TabButton({
  label, active, count, onClick,
}: {
  label: string
  active: boolean
  count?: number
  onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 font-medium text-sm border-b-2 transition whitespace-nowrap ${
        active ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}>
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-2 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-bold">
          {count}
        </span>
      )}
    </button>
  )
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-3 h-3 rounded ${swatch}`}></span>
      <span>{label}</span>
    </div>
  )
}

function Row({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={`font-medium text-slate-800 ${capitalize ? 'capitalize' : ''}`}>{value}</span>
    </div>
  )
}
