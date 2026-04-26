'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'
import { logAuditClient } from '@/lib/auditClient'

const supabase = createClient()

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

type ScheduleType = 'one_off' | 'recurring'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export default function CreateSchedulePage() {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Form
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scheduleType, setScheduleType] = useState<ScheduleType>('one_off')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [recurringDays, setRecurringDays] = useState<Record<string, boolean>>({
    mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false,
  })
  const [files, setFiles] = useState<File[]>([])

  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    if (type === 'success') {
      setTimeout(() => setMessage(''), 4000)
    }
  }

  const init = useCallback(async () => {
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

    if (profile.role !== 'admin') {
      router.push('/dashboard/schedules')
      return
    }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, feature_id, features (id, name))`)
      .eq('id', profile.company_id)
      .single()

    const companyHasSchedules = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Schedules'
    )
    if (!companyHasSchedules) {
      router.push('/dashboard')
      return
    }

    setCurrentUser(profile)
    setCompany(companyData)
    setLoading(false)
  }, [router])

  useEffect(() => {
    init()
  }, [init])

  const toggleDay = (key: string) => {
    setRecurringDays(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    const tooBig = selected.find(f => f.size > MAX_FILE_SIZE)
    if (tooBig) {
      showMessage(`"${tooBig.name}" is larger than 10 MB and won't be uploaded.`, 'error')
      const ok = selected.filter(f => f.size <= MAX_FILE_SIZE)
      setFiles(prev => [...prev, ...ok])
    } else {
      setFiles(prev => [...prev, ...selected])
    }
    e.target.value = ''
  }

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Please enter a schedule name'
    if (!startTime || !endTime) return 'Please set a start and end time'
    if (startTime >= endTime) return 'End time must be after start time'

    if (scheduleType === 'one_off') {
      if (!startDate) return 'Please choose a start date'
      if (!endDate) return 'Please choose an end date'
      if (endDate < startDate) return 'End date must be on or after start date'
    } else {
      const anyDay = Object.values(recurringDays).some(Boolean)
      if (!anyDay) return 'Please select at least one day of the week'
      if (startDate && endDate && endDate < startDate) {
        return 'End date must be on or after start date'
      }
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const err = validate()
    if (err) {
      showMessage(err, 'error')
      return
    }

    setSubmitting(true)
    setMessage('')

    const insertPayload: any = {
      company_id: currentUser.company_id,
      name: name.trim(),
      description: description.trim() || null,
      schedule_type: scheduleType,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate || null,
      end_date: endDate || null,
      recurring_days: scheduleType === 'recurring' ? recurringDays : null,
      created_by: currentUser.id,
      // Created as draft. Admin must Publish before employees can see it.
      is_published: false,
      has_unpublished_changes: true,
    }

    const { data: schedule, error: insertErr } = await supabase
      .from('schedules')
      .insert(insertPayload)
      .select()
      .single()

    if (insertErr || !schedule) {
      setSubmitting(false)
      showMessage('Error creating schedule: ' + (insertErr?.message || 'unknown'), 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'SCHEDULE_CREATED',
      entity: 'schedule',
      entity_id: schedule.id,
      details: {
        name: schedule.name,
        schedule_type: schedule.schedule_type,
        start_date: schedule.start_date,
        end_date: schedule.end_date,
        start_time: schedule.start_time,
        end_time: schedule.end_time,
        recurring_days: schedule.recurring_days,
        company_id: currentUser.company_id,
      },
    })

    if (files.length > 0) {
      const uploadResults = await Promise.all(
        files.map(async (file) => {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const path = `${currentUser.company_id}/${schedule.id}/${Date.now()}_${safeName}`

          const { error: upErr } = await supabase.storage
            .from('schedule-documents')
            .upload(path, file, {
              cacheControl: '3600',
              upsert: false,
              contentType: file.type || 'application/octet-stream',
            })

          if (upErr) return { ok: false, name: file.name, error: upErr.message }

          const { data: docRow, error: docErr } = await supabase
            .from('schedule_documents')
            .insert({
              schedule_id: schedule.id,
              company_id: currentUser.company_id,
              file_name: file.name,
              storage_path: path,
              file_size: file.size,
              mime_type: file.type || null,
              uploaded_by: currentUser.id,
            })
            .select()
            .single()

          if (docErr) return { ok: false, name: file.name, error: docErr.message }

          await logAuditClient({
            user: currentUser,
            action: 'SCHEDULE_DOC_UPLOADED',
            entity: 'schedule_document',
            entity_id: docRow?.id,
            details: {
              schedule_id: schedule.id,
              schedule_name: schedule.name,
              file_name: file.name,
              file_size: file.size,
              mime_type: file.type,
            },
          })

          return { ok: true, name: file.name }
        })
      )

      const failed = uploadResults.filter(r => !r.ok)
      if (failed.length > 0) {
        setSubmitting(false)
        showMessage(
          `Schedule saved as draft, but ${failed.length} file(s) failed: ${failed.map(f => f.name).join(', ')}`,
          'error'
        )
        setTimeout(() => router.push(`/dashboard/schedules/${schedule.id}`), 2000)
        return
      }
    }

    setSubmitting(false)
    showMessage('Draft saved! Open the schedule to publish it.', 'success')
    setTimeout(() => router.push(`/dashboard/schedules/${schedule.id}`), 800)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Create Schedule</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/schedules')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-6">

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">📝</span>
          <div>
            <p className="font-medium text-amber-800">New schedules start as Draft</p>
            <p className="text-xs text-amber-700 mt-0.5">
              You can review and Publish from the schedule page after saving.
            </p>
          </div>
        </div>

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Schedule Information</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                placeholder="e.g. Monday–Friday Office, Night Driver Rota"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                placeholder="Notes, route details, what this schedule is for..."
              />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Type</h3>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setScheduleType('one_off')}
                className={`p-4 rounded-xl border-2 text-left transition ${
                  scheduleType === 'one_off'
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-1">📅</div>
                <p className="font-semibold text-gray-800">One-off</p>
                <p className="text-xs text-gray-500 mt-0.5">Specific date(s) only</p>
              </button>

              <button
                type="button"
                onClick={() => setScheduleType('recurring')}
                className={`p-4 rounded-xl border-2 text-left transition ${
                  scheduleType === 'recurring'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-1">🔁</div>
                <p className="font-semibold text-gray-800">Recurring</p>
                <p className="text-xs text-gray-500 mt-0.5">Repeats on selected days</p>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Times</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                  required
                />
              </div>
            </div>
          </div>

          {scheduleType === 'one_off' ? (
            <div className="bg-white rounded-xl shadow p-6 space-y-4">
              <h3 className="text-lg font-semibold text-gray-800">Dates</h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">Tip: set the same start and end date for a single-day schedule.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow p-6 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Days of the Week</h3>
                <p className="text-sm text-gray-500">Tap to select the days this schedule runs.</p>
              </div>

              <div className="grid grid-cols-7 gap-2">
                {DAYS.map(d => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleDay(d.key)}
                    className={`py-2 rounded-xl text-sm font-medium transition border-2 ${
                      recurringDays[d.key]
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              <div className="pt-3 border-t border-gray-100">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Active Window <span className="text-gray-400 font-normal">(optional)</span>
                </p>
                <p className="text-xs text-gray-500 mb-3">
                  Limit when this rota applies. Leave blank to run indefinitely.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-900"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">Documents</h3>
              <p className="text-sm text-gray-500">
                Attach files anyone in the company can view (PDFs, images, etc). Max 10 MB each.
              </p>
            </div>

            <label className="flex flex-col items-center justify-center w-full py-8 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition">
              <div className="text-3xl mb-2">📎</div>
              <p className="text-sm font-medium text-gray-700">Click to choose files</p>
              <p className="text-xs text-gray-500 mt-1">You can select multiple files</p>
              <input
                type="file"
                multiple
                onChange={handleFilesSelected}
                className="hidden"
              />
            </label>

            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg">📄</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                        <p className="text-xs text-gray-500">{formatBytes(f.size)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-red-500 hover:text-red-700 text-sm font-medium ml-2"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.push('/dashboard/schedules')}
              disabled={submitting}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-xl font-medium transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition disabled:opacity-50"
            >
              {submitting ? 'Saving Draft...' : 'Save as Draft'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}