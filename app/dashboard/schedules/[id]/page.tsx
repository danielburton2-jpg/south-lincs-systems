'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { logAuditClient } from '@/lib/audit'

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

const MAX_FILE_SIZE = 10 * 1024 * 1024

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ScheduleDetailPage() {
  const params = useParams()
  const router = useRouter()
  const scheduleId = params?.id as string

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [schedule, setSchedule] = useState<any>(null)
  const [documents, setDocuments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scheduleType, setScheduleType] = useState<'one_off' | 'recurring'>('one_off')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [recurringDays, setRecurringDays] = useState<Record<string, boolean>>({
    mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false,
  })
  const [active, setActive] = useState(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    if (type === 'success') setTimeout(() => setMessage(''), 4000)
  }

  const loadSchedule = useCallback(async () => {
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

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id)
      .single()

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

    setCompany(companyData)

    const { data: scheduleData, error } = await supabase
      .from('schedules')
      .select(`*, creator:created_by (full_name)`)
      .eq('id', scheduleId)
      .single()

    if (error || !scheduleData) {
      showMessage('Schedule not found', 'error')
      setTimeout(() => router.push('/dashboard/schedules'), 1500)
      return
    }
    setSchedule(scheduleData)

    setName(scheduleData.name)
    setDescription(scheduleData.description || '')
    setScheduleType(scheduleData.schedule_type)
    setStartDate(scheduleData.start_date || '')
    setEndDate(scheduleData.end_date || '')
    setStartTime(scheduleData.start_time?.slice(0, 5) || '')
    setEndTime(scheduleData.end_time?.slice(0, 5) || '')
    setActive(scheduleData.active)
    if (scheduleData.recurring_days) {
      setRecurringDays({
        mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false,
        ...scheduleData.recurring_days,
      })
    }

    const { data: docs } = await supabase
      .from('schedule_documents')
      .select('*, uploader:uploaded_by (full_name)')
      .eq('schedule_id', scheduleId)
      .order('uploaded_at', { ascending: false })
    setDocuments(docs || [])

    setLoading(false)
  }, [router, scheduleId])

  useEffect(() => {
    loadSchedule()
  }, [loadSchedule])

  const isAdmin = currentUser?.role === 'admin'
  const canManage = isAdmin

  const isManuallyCompleted = !!schedule?.completed_at
  const isAutoCompleted =
    !isManuallyCompleted &&
    schedule?.schedule_type === 'one_off' &&
    schedule?.end_date &&
    (schedule.end_date < todayISO() ||
      (schedule.end_date === todayISO() && schedule.end_time && (() => {
        const now = new Date()
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
        return schedule.end_time < currentTime
      })()))
  const isCompleted = isManuallyCompleted || isAutoCompleted

  const formatTime = (t: string) => t?.slice(0, 5) || ''
  const formatDate = (d: string) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
  const formatDateTime = (d: string) =>
    d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  const formatBytes = (b: number) => {
    if (!b) return ''
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
  }

  const toggleDay = (key: string) => {
    setRecurringDays(prev => ({ ...prev, [key]: !prev[key] }))
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

  const buildChangedFields = () => {
    const changed: Record<string, { from: any; to: any }> = {}
    if (name.trim() !== schedule.name) {
      changed.name = { from: schedule.name, to: name.trim() }
    }
    if ((description.trim() || null) !== schedule.description) {
      changed.description = { from: schedule.description, to: description.trim() || null }
    }
    if (scheduleType !== schedule.schedule_type) {
      changed.schedule_type = { from: schedule.schedule_type, to: scheduleType }
    }
    if (startTime !== schedule.start_time?.slice(0, 5)) {
      changed.start_time = { from: schedule.start_time, to: startTime }
    }
    if (endTime !== schedule.end_time?.slice(0, 5)) {
      changed.end_time = { from: schedule.end_time, to: endTime }
    }
    if ((startDate || null) !== schedule.start_date) {
      changed.start_date = { from: schedule.start_date, to: startDate || null }
    }
    if ((endDate || null) !== schedule.end_date) {
      changed.end_date = { from: schedule.end_date, to: endDate || null }
    }
    if (active !== schedule.active) {
      changed.active = { from: schedule.active, to: active }
    }
    if (scheduleType === 'recurring') {
      const before = JSON.stringify(schedule.recurring_days || {})
      const after = JSON.stringify(recurringDays)
      if (before !== after) {
        changed.recurring_days = { from: schedule.recurring_days, to: recurringDays }
      }
    }
    return changed
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validate()
    if (err) {
      showMessage(err, 'error')
      return
    }

    const changedFields = buildChangedFields()

    setSubmitting(true)

    const updatePayload: any = {
      name: name.trim(),
      description: description.trim() || null,
      schedule_type: scheduleType,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate || null,
      end_date: endDate || null,
      recurring_days: scheduleType === 'recurring' ? recurringDays : null,
      active,
    }

    const { error } = await supabase
      .from('schedules')
      .update(updatePayload)
      .eq('id', scheduleId)

    setSubmitting(false)

    if (error) {
      showMessage('Error saving: ' + error.message, 'error')
      return
    }

    if (Object.keys(changedFields).length > 0) {
      await logAuditClient({
        user: currentUser,
        action: 'SCHEDULE_UPDATED',
        entity: 'schedule',
        entity_id: scheduleId,
        details: {
          name: name.trim(),
          changed: changedFields,
        },
      })
    }

    showMessage('Schedule updated', 'success')
    setEditing(false)
    loadSchedule()
  }

  const handleMarkComplete = async () => {
    if (!confirm(`Mark "${schedule.name}" as completed? It will move to the Reports page.`)) return

    const { error } = await supabase
      .from('schedules')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', scheduleId)

    if (error) {
      showMessage('Error: ' + error.message, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'SCHEDULE_COMPLETED',
      entity: 'schedule',
      entity_id: scheduleId,
      details: {
        name: schedule.name,
        schedule_type: schedule.schedule_type,
      },
    })

    showMessage('Marked as completed', 'success')
    loadSchedule()
  }

  const handleReopen = async () => {
    if (!confirm(`Reopen "${schedule.name}"? It will return to the active Schedules list.`)) return

    const { error } = await supabase
      .from('schedules')
      .update({ completed_at: null })
      .eq('id', scheduleId)

    if (error) {
      showMessage('Error: ' + error.message, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'SCHEDULE_REOPENED',
      entity: 'schedule',
      entity_id: scheduleId,
      details: {
        name: schedule.name,
      },
    })

    showMessage('Schedule reopened', 'success')
    loadSchedule()
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${schedule.name}"? This cannot be undone. All attached documents will also be deleted.`)) return

    const docCount = documents.length
    const docNames = documents.map(d => d.file_name)

    if (documents.length > 0) {
      const paths = documents.map(d => d.storage_path)
      await supabase.storage.from('schedule-documents').remove(paths)
    }

    const { error } = await supabase.from('schedules').delete().eq('id', scheduleId)
    if (error) {
      showMessage('Error deleting: ' + error.message, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'SCHEDULE_DELETED',
      entity: 'schedule',
      entity_id: scheduleId,
      details: {
        name: schedule.name,
        schedule_type: schedule.schedule_type,
        documents_deleted: docCount,
        document_names: docNames,
      },
    })

    router.push('/dashboard/schedules')
  }

  const handleFilesAdded = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (selected.length === 0) return

    setUploading(true)
    setMessage('')

    const results = await Promise.all(
      selected.map(async (file) => {
        if (file.size > MAX_FILE_SIZE) {
          return { ok: false, name: file.name, error: 'File too large (max 10 MB)' }
        }

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${currentUser.company_id}/${scheduleId}/${Date.now()}_${safeName}`

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
            schedule_id: scheduleId,
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
            schedule_id: scheduleId,
            schedule_name: schedule.name,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
          },
        })

        return { ok: true, name: file.name }
      })
    )

    setUploading(false)
    e.target.value = ''

    const failed = results.filter(r => !r.ok)
    if (failed.length > 0) {
      showMessage(`${failed.length} upload(s) failed: ${failed.map(f => f.name).join(', ')}`, 'error')
    } else {
      showMessage(`Uploaded ${results.length} file(s)`, 'success')
    }
    loadSchedule()
  }

  const handleDownload = async (doc: any) => {
    const { data, error } = await supabase.storage
      .from('schedule-documents')
      .createSignedUrl(doc.storage_path, 60)

    if (error || !data?.signedUrl) {
      showMessage('Could not generate download link', 'error')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  const handleDeleteDoc = async (doc: any) => {
    if (!confirm(`Delete "${doc.file_name}"?`)) return

    await supabase.storage.from('schedule-documents').remove([doc.storage_path])
    const { error } = await supabase.from('schedule_documents').delete().eq('id', doc.id)

    if (error) {
      showMessage('Error: ' + error.message, 'error')
      return
    }

    await logAuditClient({
      user: currentUser,
      action: 'SCHEDULE_DOC_DELETED',
      entity: 'schedule_document',
      entity_id: doc.id,
      details: {
        schedule_id: scheduleId,
        schedule_name: schedule.name,
        file_name: doc.file_name,
      },
    })

    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    showMessage('Document deleted', 'success')
  }

  const getFileIcon = (mime: string | null) => {
    if (!mime) return '📄'
    if (mime.startsWith('image/')) return '🖼️'
    if (mime === 'application/pdf') return '📕'
    if (mime.includes('word') || mime.includes('document')) return '📝'
    if (mime.includes('sheet') || mime.includes('excel')) return '📊'
    return '📄'
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  if (!schedule) return null

  const recurringPills = schedule.recurring_days
    ? Object.entries(schedule.recurring_days).filter(([_, v]) => v).map(([k]) => k.toUpperCase())
    : []

  return (
    <div className="p-8 max-w-4xl">

      <div className="mb-6">
        <button
          onClick={() => router.push('/dashboard/schedules')}
          className="text-sm text-slate-500 hover:text-slate-700 mb-3 inline-flex items-center gap-1"
        >
          ← Back to schedules
        </button>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Schedule Details</h1>
        <p className="text-sm text-slate-500">{company?.name}</p>
      </div>


        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {isCompleted && !editing && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div className="flex-1">
              <p className="font-medium text-slate-800">
                {isManuallyCompleted ? 'Marked as completed' : 'Auto-completed'}
              </p>
              <p className="text-xs text-slate-500">
                {isManuallyCompleted
                  ? `On ${formatDateTime(schedule.completed_at)}`
                  : `End date ${formatDate(schedule.end_date)} has passed`}
              </p>
            </div>
            {canManage && isManuallyCompleted && (
              <button
                onClick={handleReopen}
                className="text-sm bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg font-medium"
              >
                Reopen
              </button>
            )}
          </div>
        )}

        {!editing ? (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <div className="flex justify-between items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-2xl">
                      {schedule.schedule_type === 'recurring' ? '🔁' : '📅'}
                    </span>
                    <h2 className="text-2xl font-bold text-slate-800">{schedule.name}</h2>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      schedule.schedule_type === 'recurring' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {schedule.schedule_type === 'recurring' ? 'Recurring' : 'One-off'}
                    </span>
                    {!schedule.active && (
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-slate-100 text-slate-600">
                        Inactive
                      </span>
                    )}
                    {isCompleted && (
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-green-100 text-green-700">
                        Completed
                      </span>
                    )}
                  </div>
                  {schedule.description && (
                    <p className="text-slate-600 mt-2">{schedule.description}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-2 flex-wrap">
                    {schedule.schedule_type === 'one_off' && !isCompleted && (
                      <button
                        onClick={handleMarkComplete}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        Mark Complete
                      </button>
                    )}
                    <button
                      onClick={() => setEditing(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={handleDelete}
                      className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-slate-100">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-1">🕐 Times</p>
                  <p className="font-medium text-slate-800">
                    {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
                  </p>
                </div>

                {schedule.schedule_type === 'one_off' && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500 mb-1">📆 Dates</p>
                    <p className="font-medium text-slate-800">
                      {schedule.start_date === schedule.end_date
                        ? formatDate(schedule.start_date)
                        : `${formatDate(schedule.start_date)} → ${formatDate(schedule.end_date)}`}
                    </p>
                  </div>
                )}

                {schedule.schedule_type === 'recurring' && (
                  <>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500 mb-1">📋 Days</p>
                      <p className="font-medium text-slate-800">
                        {recurringPills.length > 0 ? recurringPills.join(', ') : '—'}
                      </p>
                    </div>
                    {(schedule.start_date || schedule.end_date) && (
                      <div className="bg-slate-50 rounded-lg p-3 md:col-span-2">
                        <p className="text-xs text-slate-500 mb-1">📆 Active Window</p>
                        <p className="font-medium text-slate-800">
                          {schedule.start_date ? formatDate(schedule.start_date) : 'Any time'}
                          {' → '}
                          {schedule.end_date ? formatDate(schedule.end_date) : 'Ongoing'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {schedule.creator?.full_name && (
                <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
                  Created by {schedule.creator.full_name} on {new Date(schedule.created_at).toLocaleDateString('en-GB')}
                </p>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Documents</h3>
                  <p className="text-sm text-slate-500">
                    {documents.length} {documents.length === 1 ? 'file' : 'files'}
                  </p>
                </div>
                {canManage && (
                  <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer">
                    {uploading ? 'Uploading…' : '+ Add Files'}
                    <input
                      type="file"
                      multiple
                      onChange={handleFilesAdded}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {documents.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No documents attached yet
                </div>
              ) : (
                <ul className="space-y-2">
                  {documents.map(doc => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 gap-3"
                    >
                      <button
                        onClick={() => handleDownload(doc)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left hover:bg-slate-100 -mx-1 px-1 py-1 rounded"
                      >
                        <span className="text-2xl">{getFileIcon(doc.mime_type)}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{doc.file_name}</p>
                          <p className="text-xs text-slate-500">
                            {formatBytes(doc.file_size)}
                            {doc.uploader?.full_name && ` · ${doc.uploader.full_name}`}
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleDownload(doc)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          View
                        </button>
                        {canManage && (
                          <button
                            onClick={() => handleDeleteDoc(doc)}
                            className="text-red-500 hover:text-red-700 text-sm font-medium"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h3 className="text-lg font-semibold text-slate-800">Schedule Information</h3>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description <span className="text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>

              <label className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium text-slate-700">Schedule is active</span>
              </label>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h3 className="text-lg font-semibold text-slate-800">Type</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setScheduleType('one_off')}
                  className={`p-4 rounded-xl border-2 text-left transition ${
                    scheduleType === 'one_off' ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-2xl mb-1">📅</div>
                  <p className="font-semibold text-slate-800">One-off</p>
                  <p className="text-xs text-slate-500 mt-0.5">Specific date(s) only</p>
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleType('recurring')}
                  className={`p-4 rounded-xl border-2 text-left transition ${
                    scheduleType === 'recurring' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-2xl mb-1">🔁</div>
                  <p className="font-semibold text-slate-800">Recurring</p>
                  <p className="text-xs text-slate-500 mt-0.5">Repeats on selected days</p>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h3 className="text-lg font-semibold text-slate-800">Times</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Time *</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Time *</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                    required
                  />
                </div>
              </div>
            </div>

            {scheduleType === 'one_off' ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
                <h3 className="text-lg font-semibold text-slate-800">Dates</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Start Date *</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">End Date *</label>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                      required
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Days of the Week</h3>
                  <p className="text-sm text-slate-500">Tap to select the days this schedule runs.</p>
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
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-sm font-medium text-slate-700 mb-2">
                    Active Window <span className="text-slate-400 font-normal">(optional)</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
                      <input
                        type="date"
                        value={endDate}
                        min={startDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  loadSchedule()
                }}
                disabled={submitting}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl font-medium transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
    </div>
  )
}