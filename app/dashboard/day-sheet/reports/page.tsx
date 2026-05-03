'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const supabase = createClient()

/**
 * Day Sheet Reports — historical view of day sheets in a date range,
 * with filters and CSV/PDF export. Mirrors the shift-patterns
 * Reports page closely so planners get a familiar interface.
 *
 * Design notes:
 *   - One row per day_sheet (the planning artefact). Recurring sheets
 *     and multi-day one-offs roll up into one row each. We don't
 *     unroll into per-occurrence rows here — that'd be a different
 *     report.
 *   - "Completion" filter doesn't apply to day sheets; dropped.
 *   - "Drivers covered" column shows per-row how many of the sheet's
 *     occurrences in the report's date range have a driver assigned.
 *     A green tick when fully covered, otherwise X / Y.
 *   - Linked-group siblings are surfaced by a small chip on the row
 *     showing how many other sheets are linked to it.
 */

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const formatTime = (t: string | null | undefined) => {
  if (!t) return ''
  return t.length >= 5 ? t.slice(0, 5) : t
}

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_FROM_INDEX: Record<number, string> = {
  0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
}

type DaySheet = {
  id: string
  customer_name: string
  job_description: string | null
  sheet_type: 'one_off' | 'recurring'
  start_date: string
  end_date: string | null
  recurring_days: string[] | null
  start_time: string | null
  end_time: string | null
  passenger_count: number | null
  job_notes: string | null
  linked_group_id: string | null
  active: boolean
  created_at: string
  created_by: string | null
}

type Profile = {
  id: string
  full_name: string | null
  email: string | null
}

// Quick-range buttons — mirror shift-patterns reports
type QuickRangeKey = 'all' | '7d' | '30d' | '90d' | 'thisYear' | 'lastYear'
const QUICK_RANGES: { key: QuickRangeKey; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'thisYear', label: 'This year' },
  { key: 'lastYear', label: 'Last year' },
  { key: 'all', label: 'All time' },
]

// Compute (fromDate, toDate) for a quick range. Defaults to last 30
// days. "all" returns nulls so the date filter is skipped.
const rangeForKey = (key: QuickRangeKey): { from: string | null; to: string | null } => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const toIso = isoDate(today)
  if (key === 'all') return { from: null, to: null }
  if (key === '7d') {
    const d = new Date(today); d.setDate(d.getDate() - 6)
    return { from: isoDate(d), to: toIso }
  }
  if (key === '30d') {
    const d = new Date(today); d.setDate(d.getDate() - 29)
    return { from: isoDate(d), to: toIso }
  }
  if (key === '90d') {
    const d = new Date(today); d.setDate(d.getDate() - 89)
    return { from: isoDate(d), to: toIso }
  }
  if (key === 'thisYear') {
    return { from: `${today.getFullYear()}-01-01`, to: toIso }
  }
  if (key === 'lastYear') {
    const y = today.getFullYear() - 1
    return { from: `${y}-01-01`, to: `${y}-12-31` }
  }
  return { from: null, to: null }
}

// Does this sheet have any occurrence intersecting [from, to]?
// Used for the date-range filter.
const sheetIntersectsRange = (s: DaySheet, from: string | null, to: string | null): boolean => {
  if (!from && !to) return true
  const sFrom = s.start_date
  const sTo = s.end_date || s.start_date  // recurring sheets: bounded only by start/end if set
  if (s.sheet_type === 'one_off') {
    if (to && sFrom > to) return false
    if (from && sTo < from) return false
    return true
  }
  // Recurring — has start_date, optionally end_date. If sheet's
  // potential range overlaps the filter, include.
  const sheetEnd = s.end_date || '9999-12-31'
  if (to && sFrom > to) return false
  if (from && sheetEnd < from) return false
  return true
}

// Count occurrences of a sheet within [from, to]. Used to compute
// driver-coverage ratios.
const countOccurrencesInRange = (s: DaySheet, from: string, to: string): number => {
  if (s.sheet_type === 'one_off') {
    const sFrom = s.start_date
    const sTo = s.end_date || s.start_date
    if (sFrom > to) return 0
    if (sTo < from) return 0
    const start = sFrom < from ? from : sFrom
    const end = sTo > to ? to : sTo
    const startD = new Date(start + 'T00:00:00')
    const endD = new Date(end + 'T00:00:00')
    return Math.max(0, Math.round((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1)
  }
  // Recurring: walk each day in [max(start, from), min(end||to, to)]
  // and count those matching recurring_days.
  const sStart = s.start_date > from ? s.start_date : from
  const sEnd = s.end_date && s.end_date < to ? s.end_date : to
  if (sStart > sEnd) return 0
  const days = s.recurring_days || []
  let count = 0
  const cur = new Date(sStart + 'T00:00:00')
  const last = new Date(sEnd + 'T00:00:00')
  while (cur <= last) {
    const slug = DAY_FROM_INDEX[cur.getDay()]
    if (days.includes(slug)) count += 1
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

// CSV cell escaping — wrap in quotes if needed; double-up internal
// quotes; replace newlines with spaces.
const csvCell = (val: any): string => {
  if (val == null) return ''
  const s = String(val).replace(/\r?\n/g, ' ')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export default function DaySheetReportsPage() {
  const router = useRouter()

  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState<string>('')
  const [allSheets, setAllSheets] = useState<DaySheet[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const [coverageByRange, setCoverageByRange] = useState<Record<string, { covered: number; total: number }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const initialRange = rangeForKey('30d')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState<string>(initialRange.from || '')
  const [toDate, setToDate] = useState<string>(initialRange.to || todayISO())
  const [quickRange, setQuickRange] = useState<QuickRangeKey>('30d')
  const [createdBy, setCreatedBy] = useState<string>('all')
  const [sheetTypeFilter, setSheetTypeFilter] = useState<'all' | 'one_off' | 'recurring'>('all')
  const [withDocsOnly, setWithDocsOnly] = useState(false)

  // ── Init: who am I and which company? ─────────────────────────────
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id, role')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!profile?.company_id) { router.push('/dashboard'); return }
      if (profile.role !== 'admin') { router.push('/dashboard'); return }
      setCompanyId(profile.company_id)
      const { data: company } = await supabase
        .from('companies').select('name').eq('id', profile.company_id).single()
      if (!cancelled && company?.name) setCompanyName(company.name)
    }
    init()
    return () => { cancelled = true }
  }, [router])

  // ── Load: sheets + users + doc counts ─────────────────────────────
  const loadData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError('')
    try {
      const [sheetsRes, usersRes] = await Promise.all([
        supabase
          .from('day_sheets')
          .select('id, customer_name, job_description, sheet_type, start_date, end_date, recurring_days, start_time, end_time, passenger_count, job_notes, linked_group_id, active, created_at, created_by')
          .eq('company_id', companyId)
          .eq('active', true)
          .order('start_date', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('company_id', companyId)
          .order('full_name', { ascending: true }),
      ])
      if (sheetsRes.error) throw sheetsRes.error
      if (usersRes.error) throw usersRes.error

      const sheets = (sheetsRes.data || []) as DaySheet[]
      setAllSheets(sheets)
      setUsers((usersRes.data || []) as Profile[])

      // Doc counts in one query
      const sheetIds = sheets.map(s => s.id)
      if (sheetIds.length > 0) {
        const { data: links } = await supabase
          .from('day_sheet_documents')
          .select('day_sheet_id')
          .in('day_sheet_id', sheetIds)
        const counts: Record<string, number> = {}
        ;(links || []).forEach((l: any) => {
          counts[l.day_sheet_id] = (counts[l.day_sheet_id] || 0) + 1
        })
        setDocCounts(counts)
      } else {
        setDocCounts({})
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { loadData() }, [loadData])

  // ── Driver coverage per sheet for the current date range ─────────
  // Re-fetched whenever the date range changes so the coverage column
  // reflects the active filter.
  useEffect(() => {
    let cancelled = false
    const fetchCoverage = async () => {
      if (!companyId || allSheets.length === 0) {
        setCoverageByRange({})
        return
      }
      const sheetIds = allSheets.map(s => s.id)
      // Decide date bounds. If "all time" we need an upper bound for
      // the totals math — use today.
      const fromIso = fromDate || '1900-01-01'
      const toIso = toDate || todayISO()
      const { data } = await supabase
        .from('day_sheet_assignments')
        .select('day_sheet_id, assignment_date, user_id')
        .in('day_sheet_id', sheetIds)
        .gte('assignment_date', fromIso)
        .lte('assignment_date', toIso)

      if (cancelled) return

      // Count "covered" = rows with user_id NOT NULL
      const covered: Record<string, number> = {}
      ;(data || []).forEach((a: any) => {
        if (a.user_id) covered[a.day_sheet_id] = (covered[a.day_sheet_id] || 0) + 1
      })

      // Compute totals = expected occurrences in range
      const totals: Record<string, number> = {}
      for (const s of allSheets) {
        totals[s.id] = countOccurrencesInRange(s, fromIso, toIso)
      }

      const out: Record<string, { covered: number; total: number }> = {}
      for (const s of allSheets) {
        out[s.id] = { covered: covered[s.id] || 0, total: totals[s.id] || 0 }
      }
      setCoverageByRange(out)
    }
    fetchCoverage()
    return () => { cancelled = true }
  }, [companyId, allSheets, fromDate, toDate])

  // ── Apply quick range ─────────────────────────────────────────────
  const applyQuickRange = (key: QuickRangeKey) => {
    const r = rangeForKey(key)
    setFromDate(r.from || '')
    setToDate(r.to || (key === 'all' ? '' : todayISO()))
    setQuickRange(key)
  }

  const resetFilters = () => {
    applyQuickRange('30d')
    setSearch('')
    setCreatedBy('all')
    setSheetTypeFilter('all')
    setWithDocsOnly(false)
  }

  // ── Filtered list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return allSheets.filter(s => {
      // Search
      if (term) {
        const hay = [s.customer_name, s.job_description].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      // Date range
      if (!sheetIntersectsRange(s, fromDate || null, toDate || null)) return false
      // Created by
      if (createdBy !== 'all' && s.created_by !== createdBy) return false
      // Sheet type
      if (sheetTypeFilter !== 'all' && s.sheet_type !== sheetTypeFilter) return false
      // With docs only
      if (withDocsOnly && (docCounts[s.id] || 0) === 0) return false
      return true
    })
  }, [allSheets, search, fromDate, toDate, createdBy, sheetTypeFilter, withDocsOnly, docCounts])

  const userMap = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach(u => m.set(u.id, u.full_name || u.email || ''))
    return m
  }, [users])

  // ── Summary line ─────────────────────────────────────────────────
  const buildFilterSummary = () => {
    const parts: string[] = []
    if (search) parts.push(`"${search}"`)
    if (fromDate || toDate) {
      if (fromDate && toDate) parts.push(`${formatDate(fromDate)} – ${formatDate(toDate)}`)
      else if (fromDate) parts.push(`from ${formatDate(fromDate)}`)
      else if (toDate) parts.push(`to ${formatDate(toDate)}`)
    } else {
      parts.push('all time')
    }
    if (createdBy !== 'all') {
      const u = userMap.get(createdBy)
      if (u) parts.push(`by ${u}`)
    }
    if (sheetTypeFilter !== 'all') {
      parts.push(sheetTypeFilter === 'one_off' ? 'one-off only' : 'recurring only')
    }
    if (withDocsOnly) parts.push('with documents')
    return parts.join(' · ')
  }

  const formatRecurringDays = (days: string[] | null): string => {
    if (!days || days.length === 0) return ''
    return days
      .filter(d => DAY_LABELS[d])
      .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
      .map(d => DAY_LABELS[d])
      .join(' ')
  }

  const formatWhen = (s: DaySheet): string => {
    if (s.sheet_type === 'one_off') {
      if (!s.end_date || s.end_date === s.start_date) return formatDate(s.start_date)
      return `${formatDate(s.start_date)} → ${formatDate(s.end_date)}`
    }
    const days = formatRecurringDays(s.recurring_days)
    if (s.end_date) return `${days} (${formatDate(s.start_date)} – ${formatDate(s.end_date)})`
    return `${days} (from ${formatDate(s.start_date)})`
  }

  // ── CSV export ───────────────────────────────────────────────────
  const exportCSV = () => {
    if (filtered.length === 0) return
    const headers = [
      'Customer', 'Description', 'Type', 'When', 'Start time', 'End time',
      'Pax', 'Created by', 'Created at',
      'Drivers covered', 'Total occurrences in range',
      'Documents attached',
    ]
    const rows = filtered.map(s => {
      const cov = coverageByRange[s.id] || { covered: 0, total: 0 }
      return [
        s.customer_name,
        s.job_description || '',
        s.sheet_type === 'recurring' ? 'Recurring' : 'One-off',
        formatWhen(s),
        formatTime(s.start_time),
        formatTime(s.end_time),
        s.passenger_count != null ? String(s.passenger_count) : '',
        s.created_by ? userMap.get(s.created_by) || '' : '',
        formatDateTime(s.created_at),
        String(cov.covered),
        String(cov.total),
        String(docCounts[s.id] || 0),
      ].map(csvCell).join(',')
    })
    const csv = [headers.map(csvCell).join(','), ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `day-sheet-report-${todayISO()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // ── PDF export ───────────────────────────────────────────────────
  const exportPDF = () => {
    if (filtered.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()

    // Title
    doc.setFontSize(14)
    doc.text(companyName || 'Day Sheet Report', 14, 14)
    doc.setFontSize(9)
    doc.text(`Day Sheet Report — ${todayISO()}`, pageWidth - 14, 14, { align: 'right' })
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(buildFilterSummary(), 14, 20, { maxWidth: pageWidth - 28 })
    doc.text(`${filtered.length} record${filtered.length === 1 ? '' : 's'}`, pageWidth - 14, 20, { align: 'right' })
    doc.setTextColor(0)

    const head = [[
      'Customer / Description', 'Type', 'When', 'Times', 'Pax',
      'Drivers covered', 'Docs', 'Created by',
    ]]
    const body = filtered.map(s => {
      const cov = coverageByRange[s.id] || { covered: 0, total: 0 }
      const desc = s.job_description ? `\n${s.job_description}` : ''
      return [
        `${s.customer_name}${desc}`,
        s.sheet_type === 'recurring' ? 'Recurring' : 'One-off',
        formatWhen(s),
        s.start_time ? `${formatTime(s.start_time)}${s.end_time ? '–' + formatTime(s.end_time) : ''}` : '',
        s.passenger_count != null ? String(s.passenger_count) : '',
        cov.total > 0 ? `${cov.covered} / ${cov.total}` : '—',
        String(docCounts[s.id] || 0),
        s.created_by ? userMap.get(s.created_by) || '' : '',
      ]
    })

    autoTable(doc, {
      startY: 26,
      head,
      body,
      styles: { fontSize: 8, cellPadding: 1.5, valign: 'top' },
      headStyles: { fillColor: [240, 240, 240], textColor: 30, fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 18 },
        2: { cellWidth: 50 },
        3: { cellWidth: 22 },
        4: { cellWidth: 12 },
        5: { cellWidth: 22 },
        6: { cellWidth: 14 },
        7: { cellWidth: 32 },
      },
      didDrawPage: () => {
        const pageCount = (doc as any).internal.getNumberOfPages()
        const pageNumber = (doc as any).internal.getCurrentPageInfo().pageNumber
        doc.setFontSize(8)
        doc.setTextColor(120)
        doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' })
        doc.setTextColor(0)
      },
    })

    doc.save(`day-sheet-report-${todayISO()}.pdf`)
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1400px]">
      <div className="mb-4">
        <Link href="/dashboard/day-sheet" className="text-sm text-blue-600 hover:underline">
          ← Back to Day Sheet
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Day Sheet Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Historical day sheets with filters and CSV / PDF export.
        </p>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Header strip with summary */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-slate-800">
            {companyName || ''}
          </h2>
          <div className="text-xs text-slate-500">
            {filtered.length} of {allSheets.length} record{allSheets.length === 1 ? '' : 's'} · {buildFilterSummary()}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3 mb-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search by customer name or job description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900"
          />
          <button
            onClick={resetFilters}
            className="text-sm text-slate-500 hover:text-slate-800 px-3 py-2 rounded-lg hover:bg-slate-100"
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
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setQuickRange('all') }}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={e => { setToDate(e.target.value); setQuickRange('all') }}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Created by</label>
            <select
              value={createdBy}
              onChange={e => setCreatedBy(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="all">Anyone</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Sheet type</label>
            <select
              value={sheetTypeFilter}
              onChange={e => setSheetTypeFilter(e.target.value as any)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="all">All types</option>
              <option value="one_off">One-off</option>
              <option value="recurring">Recurring</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={withDocsOnly}
            onChange={e => setWithDocsOnly(e.target.checked)}
            className="w-4 h-4"
          />
          Only show day sheets with documents attached
        </label>

        <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className={`px-4 py-2 text-sm font-medium rounded-lg ${
              filtered.length === 0
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-white border border-slate-300 hover:bg-slate-50 text-slate-700'
            }`}
          >
            ⬇ Export CSV
          </button>
          <button
            onClick={exportPDF}
            disabled={filtered.length === 0}
            className={`px-4 py-2 text-sm font-medium rounded-lg ${
              filtered.length === 0
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-white border border-slate-300 hover:bg-slate-50 text-slate-700'
            }`}
          >
            ⬇ Export PDF
          </button>
        </div>
      </div>

      {/* Results table */}
      {loading ? (
        <p className="text-sm text-slate-400 italic">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-slate-500">
            {allSheets.length === 0
              ? 'No day sheets yet. Create one and it will appear here.'
              : 'No day sheets match your filters.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Customer / job</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">When</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Times</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Pax</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Drivers covered</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Docs</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Created by</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const cov = coverageByRange[s.id] || { covered: 0, total: 0 }
                  const fullyCovered = cov.total > 0 && cov.covered >= cov.total
                  const docCount = docCounts[s.id] || 0
                  return (
                    <tr
                      key={s.id}
                      onClick={() => router.push(`/dashboard/day-sheet/${s.id}`)}
                      className="border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50 transition"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="text-lg flex-shrink-0">
                            {s.sheet_type === 'recurring' ? '🔁' : '📅'}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{s.customer_name}</p>
                            {s.job_description && (
                              <p className="text-xs text-slate-500 truncate max-w-xs">{s.job_description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                          s.sheet_type === 'recurring'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {s.sheet_type === 'recurring' ? 'Recurring' : 'One-off'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                        {formatWhen(s)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                        {s.start_time
                          ? `${formatTime(s.start_time)}${s.end_time ? '–' + formatTime(s.end_time) : ''}`
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {s.passenger_count != null
                          ? s.passenger_count
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        {cov.total === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span className={`font-medium ${fullyCovered ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {fullyCovered && '✓ '}
                            {cov.covered} / {cov.total}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {docCount > 0 ? (
                          <span className="flex items-center gap-1">📎 {docCount}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 truncate max-w-[150px]">
                        {s.created_by ? userMap.get(s.created_by) || '—' : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-slate-500 flex flex-wrap gap-4">
        <span>📅 one-off · 🔁 recurring</span>
        <span>📎 documents attached</span>
        <span>Drivers covered = how many of this sheet&apos;s occurrences in your filter range have a driver assigned</span>
      </div>
    </div>
  )
}
