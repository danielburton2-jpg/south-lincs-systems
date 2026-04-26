'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'
import { logAuditClient } from '@/lib/auditClient'

const supabase = createClient()

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛',
  class_2: '🚚',
  bus: '🚌',
  coach: '🚍',
  minibus: '🚐',
}

type StatusFilter = 'open' | 'fixed' | 'dismissed' | 'all'

const isMechanicJobTitle = (jobTitle: string | null | undefined): boolean => {
  if (!jobTitle) return false
  return jobTitle.toLowerCase().includes('mechanic')
}

export default function AdminDefectsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [defects, setDefects] = useState<any[]>([])
  const [photoMap, setPhotoMap] = useState<Record<string, any[]>>({})
  const [notesMap, setNotesMap] = useState<Record<string, any[]>>({})
  const [mechanics, setMechanics] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [resolutionAction, setResolutionAction] = useState<'fixed' | 'dismissed' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [assignSearchQ, setAssignSearchQ] = useState('')

  const [addingNoteFor, setAddingNoteFor] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const loadAll = useCallback(async (companyId: string) => {
    const [defRes, userRes] = await Promise.all([
      supabase
        .from('vehicle_defects')
        .select(`
          *,
          vehicle:vehicles (registration, fleet_number, vehicle_type, name),
          reporter:profiles!vehicle_defects_reported_by_fkey (full_name),
          resolver:profiles!vehicle_defects_resolved_by_fkey (full_name),
          assignee:profiles!vehicle_defects_assigned_to_fkey (full_name, job_title)
        `)
        .eq('company_id', companyId)
        .order('reported_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, full_name, role, job_title')
        .eq('company_id', companyId)
        .eq('is_frozen', false)
        .order('full_name', { ascending: true }),
    ])

    setDefects(defRes.data || [])

    // Mechanics — users whose job_title contains "mechanic" (case-insensitive)
    const mechs = (userRes.data || []).filter(u => isMechanicJobTitle(u.job_title))
    setMechanics(mechs)

    // Photos
    const itemIds = (defRes.data || []).map((d: any) => d.check_item_id).filter(Boolean)
    if (itemIds.length > 0) {
      const { data: photoData } = await supabase
        .from('vehicle_check_photos')
        .select('*')
        .in('check_item_id', itemIds)
      const map: Record<string, any[]> = {}
      ;(photoData || []).forEach((p: any) => {
        if (!map[p.check_item_id]) map[p.check_item_id] = []
        map[p.check_item_id].push(p)
      })
      setPhotoMap(map)
    } else {
      setPhotoMap({})
    }

    // Notes
    const defectIds = (defRes.data || []).map((d: any) => d.id)
    if (defectIds.length > 0) {
      const { data: notesData } = await supabase
        .from('vehicle_defect_notes')
        .select('*, author:profiles(full_name)')
        .in('defect_id', defectIds)
        .order('created_at', { ascending: true })
      const nmap: Record<string, any[]> = {}
      ;(notesData || []).forEach((n: any) => {
        if (!nmap[n.defect_id]) nmap[n.defect_id] = []
        nmap[n.defect_id].push(n)
      })
      setNotesMap(nmap)
    } else {
      setNotesMap({})
    }
  }, [])

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      router.push('/dashboard'); return
    }
    if (!profile.company_id) { router.push('/dashboard'); return }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id)
      .single()
    setCompany(companyData)

    const companyHasFeature = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Vehicle Checks'
    )
    if (!companyHasFeature) { router.push('/dashboard'); return }

    await loadAll(profile.company_id)
    setLoading(false)
  }, [router, loadAll])

  useEffect(() => { init() }, [init])

  // Realtime
  useEffect(() => {
    if (!currentUser?.company_id) return
    const channel = supabase
      .channel('admin-defects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defects', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.company_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defect_notes', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.company_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadAll(currentUser.company_id)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.company_id, loadAll])

  const startResolve = (defectId: string, action: 'fixed' | 'dismissed') => {
    setResolvingId(defectId)
    setResolutionAction(action)
    setResolutionNotes('')
    setAssigningId(null)
    setAddingNoteFor(null)
  }

  const cancelResolve = () => {
    setResolvingId(null)
    setResolutionAction(null)
    setResolutionNotes('')
  }

  const submitResolve = async () => {
    if (!resolvingId || !resolutionAction) return
    setSubmitting(true)

    const { error } = await supabase
      .from('vehicle_defects')
      .update({
        status: resolutionAction,
        resolved_at: new Date().toISOString(),
        resolved_by: currentUser.id,
        resolution_notes: resolutionNotes.trim() || null,
      })
      .eq('id', resolvingId)

    setSubmitting(false)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }

    await logAuditClient({
      user: currentUser,
      action: resolutionAction === 'fixed' ? 'DEFECT_RESOLVED' : 'DEFECT_DISMISSED',
      entity: 'vehicle_defect',
      entity_id: resolvingId,
      details: { resolution_notes: resolutionNotes.trim() || null },
    })

    showMessage(resolutionAction === 'fixed' ? 'Marked as fixed' : 'Defect dismissed', 'success')
    cancelResolve()
  }

  const startAssign = (defectId: string) => {
    setAssigningId(defectId)
    setAssignSearchQ('')
    setResolvingId(null)
    setAddingNoteFor(null)
  }

  const cancelAssign = () => {
    setAssigningId(null)
    setAssignSearchQ('')
  }

  const submitAssign = async (defectId: string, userId: string | null) => {
    setSubmitting(true)

    const { error } = await supabase
      .from('vehicle_defects')
      .update({
        assigned_to: userId,
        assigned_at: userId ? new Date().toISOString() : null,
        assigned_by: userId ? currentUser.id : null,
      })
      .eq('id', defectId)

    setSubmitting(false)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }

    const assignee = userId ? mechanics.find(u => u.id === userId) : null
    await logAuditClient({
      user: currentUser,
      action: userId ? 'DEFECT_ASSIGNED' : 'DEFECT_UNASSIGNED',
      entity: 'vehicle_defect',
      entity_id: defectId,
      details: { assigned_to: userId, assignee_name: assignee?.full_name },
    })

    showMessage(userId ? `Assigned to ${assignee?.full_name}` : 'Assignment cleared', 'success')
    cancelAssign()
  }

  const startAddNote = (defectId: string) => {
    setAddingNoteFor(defectId)
    setNoteText('')
    setResolvingId(null)
    setAssigningId(null)
  }

  const cancelAddNote = () => {
    setAddingNoteFor(null)
    setNoteText('')
  }

  const submitNote = async (defectId: string) => {
    if (!noteText.trim()) {
      showMessage('Note cannot be empty', 'error')
      return
    }
    setSubmitting(true)

    const { error } = await supabase
      .from('vehicle_defect_notes')
      .insert({
        defect_id: defectId,
        company_id: currentUser.company_id,
        author_id: currentUser.id,
        note: noteText.trim(),
      })

    setSubmitting(false)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }

    await logAuditClient({
      user: currentUser,
      action: 'DEFECT_NOTE_ADDED',
      entity: 'vehicle_defect',
      entity_id: defectId,
      details: { note: noteText.trim() },
    })

    cancelAddNote()
    showMessage('Note added', 'success')
  }

  const reopenDefect = async (defectId: string) => {
    if (!confirm('Re-open this defect?')) return
    const { error } = await supabase
      .from('vehicle_defects')
      .update({ status: 'open', resolved_at: null, resolved_by: null, resolution_notes: null })
      .eq('id', defectId)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }

    await logAuditClient({
      user: currentUser,
      action: 'DEFECT_REOPENED',
      entity: 'vehicle_defect',
      entity_id: defectId,
    })
    showMessage('Defect re-opened', 'success')
  }

  const openPhoto = async (photo: any) => {
    const { data, error } = await supabase.storage
      .from('vehicle-check-photos')
      .createSignedUrl(photo.storage_path, 60)
    if (error || !data?.signedUrl) { showMessage('Could not open photo', 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading defects...</p>
      </main>
    )
  }

  const filtered = defects
    .filter(d => statusFilter === 'all' ? true : d.status === statusFilter)
    .filter(d => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return d.vehicle?.registration?.toLowerCase().includes(q) ||
        d.vehicle?.fleet_number?.toLowerCase().includes(q) ||
        d.vehicle?.name?.toLowerCase().includes(q) ||
        d.item_text?.toLowerCase().includes(q) ||
        d.category?.toLowerCase().includes(q) ||
        d.defect_note?.toLowerCase().includes(q) ||
        d.assignee?.full_name?.toLowerCase().includes(q)
    })

  const counts = {
    open: defects.filter(d => d.status === 'open').length,
    fixed: defects.filter(d => d.status === 'fixed').length,
    dismissed: defects.filter(d => d.status === 'dismissed').length,
    all: defects.length,
  }

  // Assign list — only users with "mechanic" in their job title, then filter by search query
  const mechanicsForAssign = (() => {
    const q = assignSearchQ.toLowerCase().trim()
    if (!q) return mechanics
    return mechanics.filter(u =>
      u.full_name?.toLowerCase().includes(q) ||
      u.job_title?.toLowerCase().includes(q)
    )
  })()

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{company?.name}</h1>
          <p className="text-blue-200 text-sm">Vehicle Defects</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/vehicles')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back
        </button>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-4">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          {(['open', 'fixed', 'dismissed', 'all'] as const).map(s => {
            const colors: Record<string, string> = {
              open: 'border-red-300 bg-red-50',
              fixed: 'border-green-300 bg-green-50',
              dismissed: 'border-gray-300 bg-gray-50',
              all: 'border-blue-300 bg-blue-50',
            }
            const textColors: Record<string, string> = {
              open: 'text-red-700',
              fixed: 'text-green-700',
              dismissed: 'text-gray-600',
              all: 'text-blue-700',
            }
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-xl border-2 p-3 text-center transition ${
                  statusFilter === s ? colors[s] : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className={`text-2xl font-bold ${statusFilter === s ? textColors[s] : 'text-gray-700'}`}>{counts[s]}</p>
                <p className={`text-xs mt-0.5 capitalize font-medium ${statusFilter === s ? textColors[s] : 'text-gray-500'}`}>
                  {s}
                </p>
              </button>
            )
          })}
        </div>

        <div className="bg-white rounded-xl shadow p-2">
          <input
            type="text"
            placeholder="Search registration, item, category, note or assignee..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border-0 px-3 py-2 text-sm text-gray-900 focus:outline-none"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <p className="text-5xl mb-3">{statusFilter === 'open' ? '✅' : '📋'}</p>
            <p className="text-gray-700 font-medium">
              {statusFilter === 'open' && counts.open === 0 ? 'No open defects' : 'No matches'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(d => {
              const v = d.vehicle
              const photos = photoMap[d.check_item_id] || []
              const notes = notesMap[d.id] || []
              const isResolving = resolvingId === d.id
              const isAssigning = assigningId === d.id
              const isAddingNote = addingNoteFor === d.id
              const statusColors: Record<string, string> = {
                open: 'bg-red-100 text-red-700 border-red-200',
                fixed: 'bg-green-100 text-green-700 border-green-200',
                dismissed: 'bg-gray-100 text-gray-600 border-gray-200',
              }

              return (
                <div
                  key={d.id}
                  className={`bg-white rounded-xl shadow border ${
                    d.status === 'open' ? 'border-red-200' : 'border-gray-200'
                  }`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-3xl flex-shrink-0">{VEHICLE_TYPE_ICONS[v?.vehicle_type] || '🚗'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-mono font-bold text-gray-800">{v?.registration}</p>
                          {v?.fleet_number && (
                            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                              #{v.fleet_number}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border capitalize ${statusColors[d.status]}`}>
                            {d.status}
                          </span>
                          {d.assignee && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                              🔧 {d.assignee.full_name}
                            </span>
                          )}
                        </div>
                        {v?.name && <p className="text-xs text-gray-500 mt-0.5">{v.name}</p>}

                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3">{d.category}</p>
                        <p className="text-sm font-medium text-gray-800">{d.item_text}</p>
                        {d.defect_note && (
                          <div className="mt-1.5 bg-gray-50 border border-gray-200 rounded-lg p-2">
                            <p className="text-xs text-gray-700 leading-snug whitespace-pre-wrap">{d.defect_note}</p>
                          </div>
                        )}

                        {photos.length > 0 && (
                          <div className="mt-2 grid grid-cols-4 gap-2">
                            {photos.map(p => (
                              <button
                                key={p.id}
                                onClick={() => openPhoto(p)}
                                className="bg-gray-100 hover:bg-gray-200 rounded-lg p-2 text-center transition"
                              >
                                <span className="text-2xl">📷</span>
                                <p className="text-[10px] text-gray-600 truncate">{p.file_name}</p>
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
                          <span>Reported by {d.reporter?.full_name || 'Unknown'}</span>
                          <span>·</span>
                          <span>{new Date(d.reported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>

                        {notes.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">🔧 Repair Log ({notes.length})</p>
                            <div className="space-y-1.5">
                              {notes.map((n: any) => (
                                <div key={n.id} className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                                  <p className="text-xs text-gray-800 whitespace-pre-wrap leading-snug">{n.note}</p>
                                  <p className="text-[10px] text-gray-500 mt-1">
                                    {n.author?.full_name || 'Unknown'} · {new Date(n.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {d.resolved_at && (
                          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-2">
                            <p className="text-xs font-medium text-blue-800">
                              {d.status === 'fixed' ? '✓ Fixed' : '✗ Dismissed'} by {d.resolver?.full_name || 'Unknown'}
                            </p>
                            <p className="text-xs text-blue-600">
                              {new Date(d.resolved_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                            {d.resolution_notes && (
                              <p className="text-xs text-blue-700 mt-1 whitespace-pre-wrap">{d.resolution_notes}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {isResolving && (
                    <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-3">
                      <p className="text-sm font-semibold text-gray-800">
                        {resolutionAction === 'fixed' ? '✓ Mark as Fixed' : '✗ Dismiss Defect'}
                      </p>
                      <textarea
                        value={resolutionNotes}
                        onChange={(e) => setResolutionNotes(e.target.value)}
                        rows={2}
                        placeholder={resolutionAction === 'fixed' ? 'Resolution notes (e.g. parts replaced)' : 'Reason for dismissing (optional)'}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={cancelResolve} disabled={submitting} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg disabled:opacity-50">Cancel</button>
                        <button
                          onClick={submitResolve}
                          disabled={submitting}
                          className={`text-sm text-white px-4 py-2 rounded-lg disabled:opacity-50 ${
                            resolutionAction === 'fixed' ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
                          }`}
                        >
                          {submitting ? 'Saving...' : 'Confirm'}
                        </button>
                      </div>
                    </div>
                  )}

                  {isAssigning && (
                    <div className="border-t border-gray-200 p-4 bg-purple-50 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800">🔧 Assign to a Mechanic</p>
                        <p className="text-xs text-gray-500">Showing users with "Mechanic" in job title</p>
                      </div>

                      {mechanics.length === 0 ? (
                        <div className="bg-white border border-amber-200 rounded-lg p-3">
                          <p className="text-sm text-amber-800 font-medium">⚠️ No mechanics found</p>
                          <p className="text-xs text-amber-700 mt-1">
                            No users have "Mechanic" in their job title. Edit a user in <button onClick={() => router.push('/dashboard/users')} className="underline">Manage Users</button> and set their job title to include "Mechanic".
                          </p>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={assignSearchQ}
                            onChange={(e) => setAssignSearchQ(e.target.value)}
                            placeholder="Search by name..."
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white"
                          />
                          <div className="max-h-60 overflow-y-auto bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                            {mechanicsForAssign.length === 0 ? (
                              <p className="p-3 text-xs text-gray-500 text-center">No mechanics match</p>
                            ) : mechanicsForAssign.map(u => {
                              const isCurrent = d.assigned_to === u.id
                              return (
                                <button
                                  key={u.id}
                                  onClick={() => submitAssign(d.id, u.id)}
                                  disabled={submitting || isCurrent}
                                  className={`w-full text-left p-2 hover:bg-gray-50 disabled:opacity-50 ${isCurrent ? 'bg-purple-100' : ''}`}
                                >
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <p className="text-sm font-medium text-gray-800">{u.full_name}</p>
                                    {isCurrent && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Currently assigned</span>}
                                  </div>
                                  {u.job_title && <p className="text-xs text-gray-500">{u.job_title}</p>}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}

                      <div className="flex gap-2 justify-end">
                        {d.assigned_to && (
                          <button
                            onClick={() => submitAssign(d.id, null)}
                            disabled={submitting}
                            className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-lg disabled:opacity-50"
                          >
                            Clear assignment
                          </button>
                        )}
                        <button onClick={cancelAssign} disabled={submitting} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg disabled:opacity-50">Close</button>
                      </div>
                    </div>
                  )}

                  {isAddingNote && (
                    <div className="border-t border-gray-200 p-4 bg-amber-50 space-y-3">
                      <p className="text-sm font-semibold text-gray-800">🔧 Add Repair Note</p>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        rows={3}
                        placeholder="What's been done? Parts ordered, work in progress, etc."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white"
                      />
                      <div className="flex gap-2 justify-end">
                        <button onClick={cancelAddNote} disabled={submitting} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg disabled:opacity-50">Cancel</button>
                        <button
                          onClick={() => submitNote(d.id)}
                          disabled={submitting}
                          className="text-sm bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                        >
                          {submitting ? 'Adding...' : 'Add Note'}
                        </button>
                      </div>
                    </div>
                  )}

                  {!isResolving && !isAssigning && !isAddingNote && (
                    <div className="border-t border-gray-200 p-3 flex justify-end gap-2 flex-wrap">
                      {d.status === 'open' ? (
                        <>
                          <button
                            onClick={() => startAssign(d.id)}
                            className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 px-3 py-1.5 rounded-lg font-medium"
                          >
                            🔧 {d.assigned_to ? 'Reassign' : 'Assign'}
                          </button>
                          <button
                            onClick={() => startAddNote(d.id)}
                            className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-3 py-1.5 rounded-lg font-medium"
                          >
                            📝 Add Note
                          </button>
                          <button
                            onClick={() => startResolve(d.id, 'dismissed')}
                            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium"
                          >
                            ✗ Dismiss
                          </button>
                          <button
                            onClick={() => startResolve(d.id, 'fixed')}
                            className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-medium"
                          >
                            ✓ Mark Fixed
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => reopenDefect(d.id)}
                          className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-3 py-1.5 rounded-lg font-medium"
                        >
                          ↻ Re-open
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
