'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const supabase = createClient()

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isCompleted = (s: any) => {
  if (s.completed_at) return true
  if (s.schedule_type === 'one_off' && s.end_date) {
    const today = todayISO()
    if (s.end_date < today) return true
    if (s.end_date === today && s.end_time) {
      const now = new Date()
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
      if (s.end_time < currentTime) return true
    }
  }
  return false
}

const getCompletionDate = (s: any): string => {
  if (s.completed_at) return s.completed_at.slice(0, 10)
  if (s.schedule_type === 'one_off' && s.end_date) return s.end_date
  return ''
}

const QUICK_RANGES = [
  { key: 'all', label: 'All time' },
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'thismonth', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
] as const

type QuickRangeKey = typeof QUICK_RANGES[number]['key']

export default function SchedulesReportsPage() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [allSchedules, setAllSchedules] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  // Filters
  const [search, setSearch] = useState('')
  const [quickRange, setQuickRange] = useState<QuickRangeKey>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [createdBy, setCreatedBy] = useState<string>('all')
  const [completionType, setCompletionType] = useState<'all' | 'manual' | 'auto'>('all')
  const [withDocsOnly, setWithDocsOnly] = useState(false)

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) {
      router.push('/login')
      return
    }
    setCurrentUser(profile)

    if (!profile.company_id) {
      router.push('/dashboard')
      return
    }

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      router.push('/dashboard/schedules')
      return
    }

    // Feature gate
    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id)
      .single()
    setCompany(companyData)

    const companyHasSchedules = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Schedules'
    )
    if (!companyHasSchedules) {
      router.push('/dashboard')
      return
    }

    if (profile.role !== 'admin') {
      const { data: userFeats } = await supabase
        .from('user_features')
        .select('is_enabled, features (name)')
        .eq('user_id', user.id)
        .eq('is_enabled', true)
      const userHasSchedules = (userFeats as any[])?.some(
        (uf: any) => uf.features?.name === 'Schedules'
      )
      if (!userHasSchedules) {
        router.push('/dashboard')
        return
      }
    }

    const { data: schedulesData } = await supabase
      .from('schedules')
      .select(`*, schedule_documents (id), creator:created_by (id, full_name, email)`)
      .eq('company_id', profile.company_id)
      .order('completed_at', { ascending: false, nullsFirst: false })

    setAllSchedules(schedulesData || [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime
  useEffect(() => {
    if (!currentUser?.company_id) return
    const channel = supabase
      .channel('schedule-reports-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schedules',
          filter: `company_id=eq.${currentUser.company_id}`,
        },
        () => fetchData()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser?.company_id, fetchData])

  // Tick every minute so isCompleted() catches up
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [])

  const completed = (() => {
    void tick
    return allSchedules.filter(isCompleted)
  })()

  useEffect(() => {
    const creatorMap = new Map<string, any>()
    completed.forEach((s: any) => {
      if (s.creator?.id) creatorMap.set(s.creator.id, s.creator)
    })
    setUsers(Array.from(creatorMap.values()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSchedules, tick])

  const applyQuickRange = (key: QuickRangeKey) => {
    setQuickRange(key)
    const today = new Date()
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    if (key === 'all') { setFromDate(''); setToDate(''); return }
    if (key === '7' || key === '30' || key === '90') {
      const days = parseInt(key, 10)
      const from = new Date(today)
      from.setDate(today.getDate() - days)
      setFromDate(fmt(from)); setToDate(fmt(today)); return
    }
    if (key === 'thismonth') {
      const from = new Date(today.getFullYear(), today.getMonth(), 1)
      setFromDate(fmt(from)); setToDate(fmt(today)); return
    }
    if (key === 'lastmonth') {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const to = new Date(today.getFullYear(), today.getMonth(), 0)
      setFromDate(fmt(from)); setToDate(fmt(to)); return
    }
  }

  const filtered = completed.filter(s => {
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!s.name.toLowerCase().includes(q) && !(s.description || '').toLowerCase().includes(q)) return false
    }
    if (fromDate || toDate) {
      const cd = getCompletionDate(s)
      if (!cd) return false
      if (fromDate && cd < fromDate) return false
      if (toDate && cd > toDate) return false
    }
    if (createdBy !== 'all' && s.creator?.id !== createdBy) return false
    if (completionType === 'manual' && !s.completed_at) return false
    if (completionType === 'auto' && s.completed_at) return false
    if (withDocsOnly && (!s.schedule_documents || s.schedule_documents.length === 0)) return false
    return true
  })

  const formatTime = (t: string) => t?.slice(0, 5) || ''
  const formatDate = (d: string) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

  const getRecurringDayPills = (days: any) => {
    if (!days) return []
    return Object.entries(days).filter(([_, v]) => v).map(([k]) => DAY_LABELS[k] || k)
  }

  // Build a description of the active filters for the report header
  const buildFilterSummary = () => {
    const parts: string[] = []
    if (search.trim()) parts.push(`Search: "${search.trim()}"`)
    if (fromDate || toDate) {
      parts.push(`Dates: ${fromDate ? formatDate(fromDate) : 'Any'} – ${toDate ? formatDate(toDate) : 'Today'}`)
    }
    if (createdBy !== 'all') {
      const u = users.find(x => x.id === createdBy)
      if (u) parts.push(`Created by: ${u.full_name || u.email}`)
    }
    if (completionType !== 'all') {
      parts.push(`Type: ${completionType === 'manual' ? 'Manual only' : 'Auto only'}`)
    }
    if (withDocsOnly) parts.push('With documents only')
    return parts.length > 0 ? parts.join(' · ') : 'No filters applied'
  }

  // ---- CSV ----
  const exportCSV = () => {
    if (filtered.length === 0) return

    const headers = [
      'Name', 'Description', 'Type', 'Start Date', 'End Date', 'Recurring Days',
      'Start Time', 'End Time', 'Status', 'Completion Date', 'Completion Type',
      'Created By', 'Created At', 'Documents',
    ]

    const escapeCSV = (val: any) => {
      if (val == null) return ''
      const str = String(val)
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const rows = filtered.map(s => [
      s.name,
      s.description || '',
      s.schedule_type === 'recurring' ? 'Recurring' : 'One-off',
      s.start_date || '',
      s.end_date || '',
      s.schedule_type === 'recurring' ? getRecurringDayPills(s.recurring_days).join(' ') : '',
      formatTime(s.start_time),
      formatTime(s.end_time),
      s.active ? 'Active' : 'Inactive',
      getCompletionDate(s),
      s.completed_at ? 'Manual' : 'Auto',
      s.creator?.full_name || s.creator?.email || '',
      s.created_at?.slice(0, 10) || '',
      s.schedule_documents?.length || 0,
    ].map(escapeCSV).join(','))

    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `schedule-report-${todayISO()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // ---- PDF ----
  const exportPDF = () => {
    if (filtered.length === 0) return

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const generatedOn = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })

    // Header
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text(company?.name || 'Company', 14, 16)

    doc.setFontSize(13)
    doc.setFont('helvetica', 'normal')
    doc.text('Schedule Report', 14, 23)

    doc.setFontSize(9)
    doc.setTextColor(110)
    doc.text(`Generated: ${generatedOn}`, pageWidth - 14, 16, { align: 'right' })
    doc.text(`Records: ${filtered.length} of ${completed.length}`, pageWidth - 14, 21, { align: 'right' })

    doc.setFontSize(8)
    doc.text(buildFilterSummary(), 14, 30)
    doc.setTextColor(0)

    // Table
    const head = [[
      'Name', 'Type', 'Times', 'When', 'Completed', 'Mode', 'Created By', 'Docs',
    ]]

    const body = filtered.map(s => {
      const when = s.schedule_type === 'one_off' && s.start_date
        ? (s.start_date === s.end_date
            ? formatDate(s.start_date)
            : `${formatDate(s.start_date)} – ${formatDate(s.end_date)}`)
        : (s.schedule_type === 'recurring'
            ? getRecurringDayPills(s.recurring_days).join(' ')
            : '')
      return [
        s.name + (s.description ? `\n${s.description}` : ''),
        s.schedule_type === 'recurring' ? 'Recurring' : 'One-off',
        `${formatTime(s.start_time)} – ${formatTime(s.end_time)}`,
        when,
        formatDate(getCompletionDate(s)),
        s.completed_at ? 'Manual' : 'Auto',
        s.creator?.full_name || s.creator?.email || '—',
        s.schedule_documents?.length || 0,
      ]
    })

    autoTable(doc, {
      startY: 35,
      head,
      body,
      headStyles: { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { cellWidth: 22 },
        2: { cellWidth: 28 },
        3: { cellWidth: 50 },
        4: { cellWidth: 24 },
        5: { cellWidth: 18 },
        6: { cellWidth: 40 },
        7: { cellWidth: 14, halign: 'center' },
      },
      didDrawPage: () => {
        const pageCount = doc.getNumberOfPages()
        const pageNum = doc.getCurrentPageInfo().pageNumber
        const pageHeight = doc.internal.pageSize.getHeight()
        doc.setFontSize(8)
        doc.setTextColor(150)
        doc.text(
          `Page ${pageNum} of ${pageCount}`,
          pageWidth - 14,
          pageHeight - 8,
          { align: 'right' }
        )
        doc.setTextColor(0)
      },
    })

    doc.save(`schedule-report-${todayISO()}.pdf`)
  }

  // ---- Print ----
  const handlePrint = () => {
    window.print()
  }

  const resetFilters = () => {
    setSearch(''); setQuickRange('all'); setFromDate(''); setToDate('')
    setCreatedBy('all'); setCompletionType('all'); setWithDocsOnly(false)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading reports...</p>
      </main>
    )
  }

  const totalDocs = filtered.reduce((sum, s) => sum + (s.schedule_documents?.length || 0), 0)
  const printDate = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      {/* Print-only styles */}
      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          main { background: white !important; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center no-print">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Schedule Reports</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/schedules')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      {/* Print-only header */}
      <div className="print-only px-6 py-4 border-b border-gray-300">
        <h1 className="text-2xl font-bold text-gray-900">{company?.name}</h1>
        <p className="text-sm text-gray-700">Schedule Report</p>
        <div className="flex justify-between text-xs text-gray-600 mt-2">
          <span>Generated: {printDate}</span>
          <span>{filtered.length} of {completed.length} records · {buildFilterSummary()}</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-4">

        {/* HEADER */}
        <div className="flex justify-between items-center flex-wrap gap-3 no-print">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Completed Schedules</h2>
            <p className="text-sm text-gray-500">
              {filtered.length} of {completed.length} {completed.length === 1 ? 'job' : 'jobs'}
              {totalDocs > 0 && ` · ${totalDocs} ${totalDocs === 1 ? 'document' : 'documents'}`}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={exportCSV}
              disabled={filtered.length === 0}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              ⬇ CSV
            </button>
            <button
              onClick={exportPDF}
              disabled={filtered.length === 0}
              className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              ⬇ PDF
            </button>
            <button
              onClick={handlePrint}
              disabled={filtered.length === 0}
              className="bg-gray-700 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              🖨 Print
            </button>
          </div>
        </div>

        {/* FILTERS */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3 no-print">

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search by name or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            />
            <button
              onClick={resetFilters}
              className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-100"
            >
              Reset
            </button>
          </div>

          <div className="flex gap-1 flex-wrap">
            {QUICK_RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => applyQuickRange(r.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition border ${
                  quickRange === r.key
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setQuickRange('all' as any) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => { setToDate(e.target.value); setQuickRange('all' as any) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Created By</label>
              <select
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white"
              >
                <option value="all">Anyone</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Completion Type</label>
              <select
                value={completionType}
                onChange={(e) => setCompletionType(e.target.value as any)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white"
              >
                <option value="all">All</option>
                <option value="manual">Manually marked</option>
                <option value="auto">Auto (date passed)</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={withDocsOnly}
              onChange={(e) => setWithDocsOnly(e.target.checked)}
              className="w-4 h-4"
            />
            Only show jobs with documents attached
          </label>
        </div>

        {/* RESULTS */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center no-print">
            <div className="text-5xl mb-3">📊</div>
            <p className="text-gray-500">
              {completed.length === 0
                ? 'No completed jobs yet. Complete a one-off schedule and it will appear here.'
                : 'No jobs match your filters'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            {/* Desktop table — also used for printing */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Times</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">When</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Completed</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Created By</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Docs</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => (
                    <tr
                      key={s.id}
                      onClick={() => router.push(`/dashboard/schedules/${s.id}`)}
                      className="border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50 transition"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="text-lg flex-shrink-0">
                            {s.schedule_type === 'recurring' ? '🔁' : '📅'}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-800 truncate">{s.name}</p>
                            {s.description && (
                              <p className="text-xs text-gray-500 truncate max-w-xs">{s.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                          s.schedule_type === 'recurring'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {s.schedule_type === 'recurring' ? 'Recurring' : 'One-off'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {formatTime(s.start_time)} – {formatTime(s.end_time)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {s.schedule_type === 'one_off' && s.start_date && (
                          <span className="whitespace-nowrap">
                            {s.start_date === s.end_date
                              ? formatDate(s.start_date)
                              : `${formatDate(s.start_date)} → ${formatDate(s.end_date)}`}
                          </span>
                        )}
                        {s.schedule_type === 'recurring' && (
                          <div className="flex gap-1 flex-wrap">
                            {getRecurringDayPills(s.recurring_days).map(d => (
                              <span key={d} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                {d}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        <div>{formatDate(getCompletionDate(s))}</div>
                        <div className="text-xs text-gray-500">
                          {s.completed_at ? 'Manual' : 'Auto'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-[150px]">
                        {s.creator?.full_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {s.schedule_documents?.length > 0 ? (
                          <span className="flex items-center gap-1">
                            📎 {s.schedule_documents.length}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list (hidden when printing — desktop table prints instead) */}
            <div className="md:hidden divide-y divide-gray-100 no-print">
              {filtered.map(s => (
                <div
                  key={s.id}
                  onClick={() => router.push(`/dashboard/schedules/${s.id}`)}
                  className="p-4 cursor-pointer hover:bg-gray-50 transition"
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <span className="text-xl flex-shrink-0">
                        {s.schedule_type === 'recurring' ? '🔁' : '📅'}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{s.name}</p>
                        {s.description && (
                          <p className="text-xs text-gray-500 line-clamp-1">{s.description}</p>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap flex-shrink-0 ${
                      s.schedule_type === 'recurring'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}>
                      {s.schedule_type === 'recurring' ? 'Recurring' : 'One-off'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 ml-7">
                    <span>🕐 {formatTime(s.start_time)} – {formatTime(s.end_time)}</span>
                    <span>✅ {formatDate(getCompletionDate(s))}</span>
                    {s.schedule_documents?.length > 0 && (
                      <span>📎 {s.schedule_documents.length}</span>
                    )}
                  </div>

                  {s.creator?.full_name && (
                    <p className="text-xs text-gray-500 mt-1 ml-7">
                      Created by {s.creator.full_name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}