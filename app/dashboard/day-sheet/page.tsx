'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh'

const supabase = createClient()

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
}

const WEEKDAY_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
  fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isoPlusDays = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const formatDate = (iso: string) => {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch { return iso }
}

const formatTime = (t: string | null) => (t ? (t.length >= 5 ? t.slice(0, 5) : t) : '')

const describeRecurrence = (s: DaySheet) => {
  if (s.sheet_type === 'one_off') {
    if (s.end_date && s.end_date !== s.start_date) {
      return `${formatDate(s.start_date)} – ${formatDate(s.end_date)}`
    }
    return formatDate(s.start_date)
  }
  const days = (s.recurring_days || [])
    .map(slug => WEEKDAY_LABEL[slug] || slug)
    .join(' ')
  const range = s.end_date
    ? `${formatDate(s.start_date)} – ${formatDate(s.end_date)}`
    : `from ${formatDate(s.start_date)} (open-ended)`
  return `${days} · ${range}`
}

export default function DaySheetListPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [sheets, setSheets] = useState<DaySheet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(isoPlusDays(30))
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!profile?.company_id) { router.push('/dashboard'); return }
      setCompanyId(profile.company_id)
    }
    init()
    return () => { cancelled = true }
  }, [router])

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        company_id: companyId, from, to,
        active: showInactive ? 'false' : 'true',
      })
      const res = await fetch(`/api/list-day-sheets?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setSheets(data.day_sheets || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [companyId, from, to, showInactive])

  useEffect(() => { load() }, [load])

  useRealtimeRefresh(
    'day-sheets-list',
    [{ table: 'day_sheets', companyId }],
    load,
    !!companyId,
  )

  const visible = sheets.filter(s => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      s.customer_name.toLowerCase().includes(q) ||
      (s.job_description || '').toLowerCase().includes(q) ||
      (s.job_notes || '').toLowerCase().includes(q)
    )
  })

  // Sort by start_date asc, but show recurring sheets first if same start
  const sorted = visible.slice().sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1
    if (a.sheet_type !== b.sheet_type) return a.sheet_type === 'recurring' ? -1 : 1
    const aT = a.start_time || ''
    const bT = b.start_time || ''
    return aT < bT ? -1 : aT > bT ? 1 : 0
  })

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-baseline justify-between mb-6 gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Day Sheet</h1>
        <Link
          href="/dashboard/day-sheet/new"
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm"
        >
          + New Day Sheet
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Search</label>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Customer, description, notes…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="w-4 h-4"
            />
            Show deleted
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-8 text-slate-400 italic text-center">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="p-8 text-slate-400 italic text-center">
            {sheets.length === 0
              ? 'No day sheets in this date range. Create one above.'
              : 'No day sheets match your search.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {sorted.map(s => (
              <li key={s.id}>
                <button
                  onClick={() => router.push(`/dashboard/day-sheet/${s.id}`)}
                  className="w-full text-left p-4 hover:bg-slate-50 transition flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-slate-800">{s.customer_name}</p>
                      {s.sheet_type === 'recurring' && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                          ↻ recurring
                        </span>
                      )}
                      {s.sheet_type === 'one_off' && s.end_date && s.end_date !== s.start_date && (
                        <span className="text-[10px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">
                          🗓 multi-day
                        </span>
                      )}
                      {s.linked_group_id && (
                        <span
                          title="Linked to other day sheets"
                          className="text-[10px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium"
                        >
                          🔗 linked
                        </span>
                      )}
                      {!s.active && (
                        <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">deleted</span>
                      )}
                    </div>
                    {s.job_description && (
                      <p className="text-sm text-slate-600 mt-0.5">{s.job_description}</p>
                    )}
                    <p className="text-xs text-slate-500 mt-1">{describeRecurrence(s)}</p>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                      {s.start_time && <span>🕒 {formatTime(s.start_time)}{s.end_time ? ` – ${formatTime(s.end_time)}` : ''}</span>}
                      {s.passenger_count != null && <span>👥 {s.passenger_count} pax</span>}
                    </div>
                    {s.job_notes && (
                      <p className="text-xs text-slate-500 mt-1 italic">{s.job_notes}</p>
                    )}
                  </div>
                  <span className="text-slate-400 self-center">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && sorted.length > 0 && (
        <p className="text-xs text-slate-500 mt-3">
          {sorted.length} day sheet{sorted.length === 1 ? '' : 's'} shown
        </p>
      )}
    </div>
  )
}
