'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import DaySheetDocumentsPanel from '@/components/DaySheetDocumentsPanel'

const supabase = createClient()

type DaySheet = {
  id: string
  company_id: string
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

type Sibling = Pick<
  DaySheet,
  'id' | 'customer_name' | 'job_description' | 'start_date' | 'end_date'
  | 'sheet_type' | 'recurring_days' | 'start_time' | 'end_time' | 'passenger_count'
>

const WEEKDAYS: { slug: string; label: string }[] = [
  { slug: 'mon', label: 'Mon' }, { slug: 'tue', label: 'Tue' }, { slug: 'wed', label: 'Wed' },
  { slug: 'thu', label: 'Thu' }, { slug: 'fri', label: 'Fri' }, { slug: 'sat', label: 'Sat' },
  { slug: 'sun', label: 'Sun' },
]

const formatTime = (t: string | null) => (t ? (t.length >= 5 ? t.slice(0, 5) : t) : '')

const formatDate = (iso: string) => {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch { return iso }
}

const describeRecurrence = (s: { sheet_type: string; start_date: string; end_date: string | null; recurring_days: string[] | null }) => {
  if (s.sheet_type === 'one_off') return formatDate(s.start_date)
  const days = (s.recurring_days || []).map(slug => {
    const d = WEEKDAYS.find(w => w.slug === slug)
    return d?.label || slug
  }).join(', ')
  const range = s.end_date
    ? `${formatDate(s.start_date)} – ${formatDate(s.end_date)}`
    : `from ${formatDate(s.start_date)} (open-ended)`
  return `${days} · ${range}`
}

export default function EditDaySheetPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string | undefined

  const [sheet, setSheet] = useState<DaySheet | null>(null)
  const [siblings, setSiblings] = useState<Sibling[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)

  // Form fields
  const [customerName, setCustomerName] = useState('')
  const [sheetType, setSheetType] = useState<'one_off' | 'recurring'>('one_off')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [recurringDays, setRecurringDays] = useState<string[]>([])
  const [jobDescription, setJobDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [passengerCount, setPassengerCount] = useState('')
  const [jobNotes, setJobNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Link picker
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [linkCandidates, setLinkCandidates] = useState<DaySheet[]>([])
  const [linkLoading, setLinkLoading] = useState(false)

  // Whether the current user is admin — controls visibility of upload
  // and remove buttons in the documents panel.
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchRole = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      setIsAdmin(data?.role === 'admin')
    }
    fetchRole()
    return () => { cancelled = true }
  }, [])

  const loadSheet = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/get-day-sheet?id=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')

      const ds: DaySheet = data.day_sheet
      setSheet(ds)
      setSiblings(data.linked_siblings || [])

      setCustomerName(ds.customer_name || '')
      setSheetType(ds.sheet_type || 'one_off')
      setStartDate(ds.start_date || '')
      setEndDate(ds.end_date || '')
      setRecurringDays(ds.recurring_days || [])
      setJobDescription(ds.job_description || '')
      setStartTime(ds.start_time ? ds.start_time.slice(0, 5) : '')
      setEndTime(ds.end_time ? ds.end_time.slice(0, 5) : '')
      setPassengerCount(ds.passenger_count != null ? String(ds.passenger_count) : '')
      setJobNotes(ds.job_notes || '')
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadSheet() }, [loadSheet])

  const toggleDay = (slug: string) => {
    setRecurringDays(prev =>
      prev.includes(slug) ? prev.filter(d => d !== slug) : [...prev, slug]
    )
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sheet) return
    if (!customerName.trim()) { setError('Customer name is required'); return }
    if (sheetType === 'recurring' && recurringDays.length === 0) {
      setError('Pick at least one weekday for a recurring sheet'); return
    }
    if (endDate && endDate < startDate) {
      setError('End date must be on or after start date'); return
    }

    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/update-day-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sheet.id,
          customer_name: customerName,
          sheet_type: sheetType,
          start_date: startDate,
          end_date: endDate || null,
          recurring_days: sheetType === 'recurring' ? recurringDays : null,
          job_description: jobDescription,
          start_time: startTime,
          end_time: endTime,
          passenger_count: passengerCount,
          job_notes: jobNotes,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save'); return }
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
      if (data.cascade_assignments_removed > 0) {
        setError(`Saved. ${data.cascade_assignments_removed} assignment(s) removed because their date no longer matches the recurrence pattern.`)
      }
      await loadSheet()
    } catch (err: any) {
      setError(err?.message || 'Server error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!sheet) return
    if (!confirm(`Delete day sheet for ${sheet.customer_name}? It will be hidden from the list but kept in the audit log.`)) return
    try {
      const res = await fetch('/api/delete-day-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sheet.id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to delete'); return }
      router.push('/dashboard/day-sheet')
    } catch (err: any) {
      setError(err?.message || 'Server error')
    }
  }

  const openLinkPicker = async () => {
    if (!sheet) return
    setLinkPickerOpen(true)
    setLinkLoading(true)
    try {
      // Pull all sheets in/around this sheet's date range, then filter
      // client-side to those with matching recurrence shape.
      const params = new URLSearchParams({
        company_id: sheet.company_id,
        from: sheet.start_date,
        to: sheet.end_date || sheet.start_date,
        active: 'true',
      })
      const res = await fetch(`/api/list-day-sheets?${params.toString()}`)
      const data = await res.json()
      const all: DaySheet[] = data.day_sheets || []
      const siblingIds = new Set(siblings.map(s => s.id))
      const sameShape = (a: DaySheet, b: DaySheet) => {
        if (a.sheet_type !== b.sheet_type) return false
        if (a.start_date !== b.start_date) return false
        if ((a.end_date || null) !== (b.end_date || null)) return false
        const dA = (a.recurring_days || []).slice().sort()
        const dB = (b.recurring_days || []).slice().sort()
        if (dA.length !== dB.length) return false
        return dA.every((x, i) => x === dB[i])
      }
      setLinkCandidates(all.filter(d =>
        d.id !== sheet.id && !siblingIds.has(d.id) && sameShape(d, sheet)
      ))
    } catch (e: any) {
      setError(e?.message || 'Failed to load link candidates')
    } finally {
      setLinkLoading(false)
    }
  }

  const handleLink = async (targetId: string) => {
    if (!sheet) return
    try {
      const res = await fetch('/api/link-day-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link', source_id: sheet.id, target_id: targetId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to link'); return }
      setLinkPickerOpen(false)
      await loadSheet()
    } catch (err: any) {
      setError(err?.message || 'Server error')
    }
  }

  const handleUnlink = async () => {
    if (!sheet) return
    if (!confirm('Unlink this day sheet from its group? Other linked sheets stay linked to each other.')) return
    try {
      const res = await fetch('/api/link-day-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink', id: sheet.id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to unlink'); return }
      await loadSheet()
    } catch (err: any) {
      setError(err?.message || 'Server error')
    }
  }

  if (loading) return <div className="p-8 text-slate-400 italic">Loading day sheet…</div>
  if (!sheet) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          <p className="font-medium mb-1">Couldn&apos;t load day sheet</p>
          <p className="text-sm">{error || 'Not found.'}</p>
          <Link href="/dashboard/day-sheet" className="mt-3 inline-block text-sm underline">
            Back to list
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <Link href="/dashboard/day-sheet" className="text-sm text-blue-600 hover:underline">
          ← Back to Day Sheet list
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">
          {sheet.customer_name}
          <span className="ml-3 text-sm text-slate-500 font-normal">
            {describeRecurrence(sheet)}
          </span>
        </h1>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}
      {savedFlash && !error && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg">
          Saved.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer name *</label>
            <input
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Type *</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className={`p-3 rounded-lg border cursor-pointer transition ${
                sheetType === 'one_off'
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="sheet_type"
                  value="one_off"
                  checked={sheetType === 'one_off'}
                  onChange={() => setSheetType('one_off')}
                  className="mr-2"
                />
                <span className="text-sm font-medium text-slate-800">One-off</span>
                <p className="text-xs text-slate-500 mt-1">A single job on one date.</p>
              </label>
              <label className={`p-3 rounded-lg border cursor-pointer transition ${
                sheetType === 'recurring'
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="sheet_type"
                  value="recurring"
                  checked={sheetType === 'recurring'}
                  onChange={() => setSheetType('recurring')}
                  className="mr-2"
                />
                <span className="text-sm font-medium text-slate-800">Recurring</span>
                <p className="text-xs text-slate-500 mt-1">Same job repeating on chosen weekdays.</p>
              </label>
            </div>
            {sheet.linked_group_id && (
              <p className="text-xs text-amber-700 mt-2">
                ⚠️ Changing recurrence on a linked sheet may unlink it implicitly — linked sheets must share the same shape.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start date *</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                End date {' '}
                <span className="text-slate-400">
                  {sheetType === 'one_off' ? '(blank = single day)' : '(blank = open-ended)'}
                </span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                min={startDate || undefined}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
          </div>

          <p className="text-xs text-slate-500 -mt-2">
            {sheetType === 'one_off'
              ? 'Leave blank for a single-day job. Set an end date for a continuous multi-day job — driver picked on day 1 will auto-fill across all days, even across weeks.'
              : 'Blank = open-ended. Set an end date to stop the recurrence.'}
          </p>

          {sheetType === 'recurring' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Repeats on *</label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map(d => {
                  const on = recurringDays.includes(d.slug)
                  return (
                    <button
                      key={d.slug}
                      type="button"
                      onClick={() => toggleDay(d.slug)}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                        on
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {d.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Driver is picked per day on the assign page (no auto-fill across weekdays). Removing a day will delete any existing assignments on that weekday.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Job description <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              value={jobDescription}
              onChange={e => setJobDescription(e.target.value)}
              placeholder="e.g. Boston St Marys → Peterborough Museum"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start time</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">End time</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Passenger count <span className="text-slate-400">(used to suggest vehicles by seats)</span>
            </label>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={passengerCount}
              onChange={e => setPassengerCount(e.target.value)}
              className="w-full max-w-[12rem] border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Job notes</label>
            <textarea
              value={jobNotes}
              onChange={e => setJobNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Clock on 3:15pm, depart depot 3:30pm"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-slate-800">Linked day sheets</h2>
            <button
              type="button"
              onClick={openLinkPicker}
              className="text-sm bg-violet-600 hover:bg-violet-700 text-white font-medium px-3 py-1.5 rounded-lg"
            >
              + Link to another day sheet with the same recurrence
            </button>
          </div>

          {sheet.linked_group_id ? (
            siblings.length > 0 ? (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {siblings.map(s => (
                  <li key={s.id} className="p-3 flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{s.customer_name}</p>
                      {s.job_description && (
                        <p className="text-xs text-slate-500">{s.job_description}</p>
                      )}
                      <div className="text-xs text-slate-500 mt-0.5 flex gap-3 flex-wrap">
                        {s.start_time && <span>🕒 {formatTime(s.start_time)}{s.end_time ? ` – ${formatTime(s.end_time)}` : ''}</span>}
                        {s.passenger_count != null && <span>👥 {s.passenger_count} pax</span>}
                      </div>
                    </div>
                    <Link
                      href={`/dashboard/day-sheet/${s.id}`}
                      className="text-sm text-blue-600 hover:underline whitespace-nowrap"
                    >
                      Open →
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 italic">
                In a link group but no siblings visible (may have been deleted).
              </p>
            )
          ) : (
            <p className="text-xs text-slate-500 italic">
              Not linked. Link to another sheet with the SAME date(s) and weekday pattern to share driver assignments.
            </p>
          )}

          {sheet.linked_group_id && (
            <button
              type="button"
              onClick={handleUnlink}
              className="text-xs text-red-600 hover:underline"
            >
              Unlink this day sheet from its group
            </button>
          )}
        </section>

        <div className="flex gap-3 items-center">
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
          <Link
            href="/dashboard/day-sheet"
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-6 py-2.5 rounded-lg transition"
          >
            Back
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            className="ml-auto text-red-600 hover:underline text-sm"
          >
            Delete day sheet
          </button>
        </div>
      </form>

      {/* Documents panel — attached files for this day sheet */}
      {sheet?.id && (
        <div className="mt-6">
          <DaySheetDocumentsPanel daySheetId={sheet.id} isAdmin={isAdmin} />
        </div>
      )}

      {linkPickerOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">
                Link to another day sheet with the same recurrence
              </h3>
              <button
                onClick={() => setLinkPickerOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xl leading-none"
              >×</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {linkLoading ? (
                <p className="p-6 text-center text-slate-400 italic">Loading…</p>
              ) : linkCandidates.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-slate-500 italic mb-3">
                    No other day sheets with the same dates and weekday pattern.
                  </p>
                  <Link
                    href="/dashboard/day-sheet/new"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Create another day sheet →
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {linkCandidates.map(c => (
                    <li key={c.id}>
                      <button
                        onClick={() => handleLink(c.id)}
                        className="w-full text-left p-4 hover:bg-slate-50 flex justify-between items-center gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">{c.customer_name}</p>
                          {c.job_description && (
                            <p className="text-xs text-slate-500">{c.job_description}</p>
                          )}
                          <div className="text-xs text-slate-500 mt-0.5 flex gap-3 flex-wrap">
                            {c.start_time && <span>🕒 {formatTime(c.start_time)}{c.end_time ? ` – ${formatTime(c.end_time)}` : ''}</span>}
                            {c.passenger_count != null && <span>👥 {c.passenger_count} pax</span>}
                          </div>
                        </div>
                        <span className="text-violet-600 text-sm font-medium whitespace-nowrap">Link →</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-3 border-t border-slate-200 text-right">
              <button
                onClick={() => setLinkPickerOpen(false)}
                className="text-sm bg-slate-100 hover:bg-slate-200 px-4 py-1.5 rounded-lg"
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
