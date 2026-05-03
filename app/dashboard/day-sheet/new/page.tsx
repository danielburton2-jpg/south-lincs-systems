'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import DaySheetDocumentsBuffer from '@/components/DaySheetDocumentsBuffer'

const supabase = createClient()

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WEEKDAYS: { slug: string; label: string }[] = [
  { slug: 'mon', label: 'Mon' }, { slug: 'tue', label: 'Tue' }, { slug: 'wed', label: 'Wed' },
  { slug: 'thu', label: 'Thu' }, { slug: 'fri', label: 'Fri' }, { slug: 'sat', label: 'Sat' },
  { slug: 'sun', label: 'Sun' },
]

export default function NewDaySheetPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [createdById, setCreatedById] = useState<string | null>(null)

  // Form fields
  const [customerName, setCustomerName] = useState('')
  const [sheetType, setSheetType] = useState<'one_off' | 'recurring'>('one_off')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState('')
  const [recurringDays, setRecurringDays] = useState<string[]>(['mon','tue','wed','thu','fri'])
  const [jobDescription, setJobDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [passengerCount, setPassengerCount] = useState('')
  const [jobNotes, setJobNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Staged document files. Picked by the buffer panel below the
  // form. Uploaded and attached AFTER /api/create-day-sheet returns
  // a real day_sheet_id.
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, company_id, role')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!profile?.company_id) { router.push('/dashboard'); return }
      setCompanyId(profile.company_id)
      setCreatedById(profile.id)
      setIsAdmin(profile.role === 'admin')
    }
    init()
    return () => { cancelled = true }
  }, [router])

  const toggleDay = (slug: string) => {
    setRecurringDays(prev =>
      prev.includes(slug) ? prev.filter(d => d !== slug) : [...prev, slug]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return
    if (!customerName.trim()) { setError('Customer name is required'); return }
    if (!startDate) { setError('Start date is required'); return }
    if (sheetType === 'recurring' && recurringDays.length === 0) {
      setError('Pick at least one weekday for a recurring sheet'); return
    }
    if (endDate && endDate < startDate) {
      setError('End date must be on or after start date'); return
    }

    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/create-day-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
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
          created_by: createdById,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save'); return }

      const newId = data.day_sheet.id

      // Upload + attach any staged files. Each file: get signed URL,
      // PUT to storage, finalize, then attach to this day sheet.
      // Failures on individual files don't abort — the day sheet is
      // already created and the user is told which ones didn't take.
      // Non-admins can't upload (the panel hides itself for them);
      // we double-check here as a belt-and-braces guard.
      if (isAdmin && stagedFiles.length > 0) {
        const failures: string[] = []
        for (let i = 0; i < stagedFiles.length; i++) {
          const file = stagedFiles[i]
          setUploadProgress(`Uploading ${i + 1} of ${stagedFiles.length}: ${file.name}…`)
          try {
            const documentId = crypto.randomUUID()
            const signRes = await fetch('/api/documents/upload-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                document_id: documentId,
                folder_id: null,
                filename: file.name,
                mime_type: file.type,
                size_bytes: file.size,
              }),
            })
            const signData = await signRes.json()
            if (!signRes.ok) {
              failures.push(`${file.name}: ${signData.error || 'upload-url failed'}`)
              continue
            }
            const putRes = await fetch(signData.signed_url, {
              method: 'PUT',
              headers: { 'Content-Type': file.type },
              body: file,
            })
            if (!putRes.ok) {
              failures.push(`${file.name}: storage PUT failed (${putRes.status})`)
              continue
            }
            const finRes = await fetch('/api/documents/finalize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                document_id: documentId,
                folder_id: null,
                storage_path: signData.storage_path,
                filename: file.name,
                mime_type: file.type,
                size_bytes: file.size,
              }),
            })
            const finData = await finRes.json()
            if (!finRes.ok) {
              failures.push(`${file.name}: ${finData.error || 'finalize failed'}`)
              continue
            }
            const attRes = await fetch('/api/attach-day-sheet-document', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                day_sheet_id: newId,
                document_id: documentId,
              }),
            })
            const attData = await attRes.json()
            if (!attRes.ok) {
              failures.push(`${file.name}: ${attData.error || 'attach failed'}`)
              continue
            }
          } catch (uploadErr: any) {
            failures.push(`${file.name}: ${uploadErr?.message || 'unknown error'}`)
          }
        }
        setUploadProgress('')
        if (failures.length > 0) {
          // Day sheet was created OK. Warn the user via alert (the
          // form will redirect after this), then continue. They can
          // re-upload from the edit page.
          alert(
            `Day sheet created, but some documents failed to upload:\n\n` +
            failures.join('\n') +
            `\n\nYou can retry on the edit page.`
          )
        }
      }

      router.push(`/dashboard/day-sheet/${newId}`)
    } catch (err: any) {
      setError(err?.message || 'Server error')
    } finally {
      setSubmitting(false)
      setUploadProgress('')
    }
  }

  // Helper: explain what end_date means for the chosen type
  const endDateHint = sheetType === 'one_off'
    ? 'Leave blank for a single-day job. Set an end date for a continuous multi-day job (e.g. a week-long contract) — driver picked on day 1 will auto-fill across all days, even across weeks.'
    : 'Blank = open-ended (no end date). Set an end date to stop the recurrence.'

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <Link href="/dashboard/day-sheet" className="text-sm text-blue-600 hover:underline">
          ← Back to Day Sheet list
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">New Day Sheet</h1>
        <p className="text-sm text-slate-500 mt-1">
          Fill in the details, attach any documents, and click Create.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer name *</label>
            <input
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              required
              placeholder="e.g. Boston St Marys"
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
                <p className="text-xs text-slate-500 mt-1">A single date, or a continuous date range.</p>
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
                <p className="text-xs text-slate-500 mt-1">Repeats on chosen weekdays.</p>
              </label>
            </div>
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

          <p className="text-xs text-slate-500 -mt-2">{endDateHint}</p>

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
                The job appears on the assign page for every selected weekday in the date range. Driver is picked per day (no auto-fill across weekdays).
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
              placeholder="e.g. 53"
              className="w-full max-w-[12rem] border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Job notes <span className="text-slate-400">(shown on the day view)</span>
            </label>
            <textarea
              value={jobNotes}
              onChange={e => setJobNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Clock on 3:15pm, depart depot 3:30pm"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
        </section>

        {/* Documents — staged here, uploaded after Create */}
        <DaySheetDocumentsBuffer
          files={stagedFiles}
          onChange={setStagedFiles}
          isAdmin={isAdmin}
          disabled={submitting}
        />

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          You&apos;ll be able to <strong>link this to another day sheet with the same recurrence pattern</strong> (e.g. its
          return leg) on the next page after saving.
        </div>

        {uploadProgress && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
            {uploadProgress}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {submitting
              ? (uploadProgress ? 'Uploading…' : 'Creating…')
              : 'Create Day Sheet'}
          </button>
          <Link
            href="/dashboard/day-sheet"
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-6 py-2.5 rounded-lg transition"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
