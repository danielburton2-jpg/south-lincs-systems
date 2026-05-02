'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { logAuditClient } from '@/lib/auditClient'

const supabase = createClient()

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛',
  class_2: '🚚',
  bus: '🚌',
  coach: '🚍',
  minibus: '🚐',
}

type FilterTab = 'all' | 'reported'

// Wrapper component that uses useSearchParams (must be inside Suspense)
function DefectsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Old links may still have ?filter=mine in them — fall back to 'all'
  // since the "Assigned to me" tab has been removed (mechanics see
  // their assignments on /employee/services Defects tab instead).
  const rawFilter = searchParams?.get('filter')
  const initialFilter: FilterTab =
    rawFilter === 'all' || rawFilter === 'reported' ? rawFilter : 'all'

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [hasDefectManagement, setHasDefectManagement] = useState(false)
  const [defects, setDefects] = useState<any[]>([])
  const [photoMap, setPhotoMap] = useState<Record<string, any[]>>({})
  const [notesMap, setNotesMap] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>(initialFilter)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [resolutionAction, setResolutionAction] = useState<'fixed' | 'dismissed' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [addingNoteFor, setAddingNoteFor] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const loadDefects = useCallback(async (companyId: string) => {
    const { data } = await supabase
      .from('vehicle_defects')
      .select(`
        *,
        vehicle:vehicles (registration, fleet_number, vehicle_type, name),
        reporter:profiles!vehicle_defects_reported_by_fkey (full_name),
        resolver:profiles!vehicle_defects_resolved_by_fkey (full_name),
        assignee:profiles!vehicle_defects_assigned_to_fkey (full_name, job_title)
      `)
      .eq('company_id', companyId)
      .eq('status', 'open')
      .order('reported_at', { ascending: false })

    setDefects(data || [])

    const itemIds = (data || []).map((d: any) => d.check_item_id).filter(Boolean)
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

    const defectIds = (data || []).map((d: any) => d.id)
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

    if (!profile.company_id) { router.push('/employee'); return }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id)
      .single()
    setCompany(companyData)

    const companyHasFeature = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Vehicle Checks'
    )
    if (!companyHasFeature) { router.push('/employee'); return }

    const { data: userFeats } = await supabase
      .from('user_features')
      .select('is_enabled, features (name)')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
    const userHasFeature = (userFeats as any[])?.some(
      (uf: any) => uf.features?.name === 'Vehicle Checks'
    )
    if (!userHasFeature) { router.push('/employee'); return }

    const userHasDefectMgmt = (userFeats as any[])?.some(
      (uf: any) => uf.features?.name === 'Defect Management'
    )
    setHasDefectManagement(userHasDefectMgmt)

    await loadDefects(profile.company_id)
    setLoading(false)
  }, [router, loadDefects])

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!currentUser?.id || !currentUser?.company_id) return
    const channel = supabase
      .channel('employee-vc-defects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defects', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadDefects(currentUser.company_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_defect_notes', filter: `company_id=eq.${currentUser.company_id}` }, () => {
        loadDefects(currentUser.company_id)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, currentUser?.company_id, loadDefects])

  const startResolve = (defectId: string, action: 'fixed' | 'dismissed') => {
    setResolvingId(defectId)
    setResolutionAction(action)
    setResolutionNotes('')
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

  const startAddNote = (defectId: string) => {
    setAddingNoteFor(defectId)
    setNoteText('')
    setResolvingId(null)
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

  const openPhoto = async (photo: any) => {
    const { data, error } = await supabase.storage
      .from('vehicle-check-photos')
      .createSignedUrl(photo.storage_path, 60)
    if (error || !data?.signedUrl) { showMessage('Could not open photo', 'error'); return }
    window.location.href = data.signedUrl
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading defects...</p>
      </main>
    )
  }

  const filtered = defects
    .filter(d => {
      if (filterTab === 'reported') return d.reported_by === currentUser?.id
      return true
    })
    .filter(d => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return d.vehicle?.registration?.toLowerCase().includes(q) ||
        d.vehicle?.fleet_number?.toLowerCase().includes(q) ||
        d.vehicle?.name?.toLowerCase().includes(q) ||
        d.item_text?.toLowerCase().includes(q) ||
        d.category?.toLowerCase().includes(q) ||
        d.defect_note?.toLowerCase().includes(q)
    })

  const counts = {
    all: defects.length,
    reported: defects.filter(d => d.reported_by === currentUser?.id).length,
  }

  const grouped: Record<string, any[]> = {}
  filtered.forEach(d => {
    const key = d.vehicle_id
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(d)
  })

  return (
    <main className="min-h-screen bg-slate-50 pb-32">
      <div className="bg-gradient-to-br from-red-600 to-red-800 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-lg">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/employee/vehicle-checks')} className="text-red-100 text-sm hover:text-white">
            ← Back
          </button>
          <p className="text-red-100 text-sm">{company?.name}</p>
        </div>
        <h1 className="text-2xl font-bold mt-2">⚠️ Defects</h1>
        <p className="text-red-100 text-sm mt-1">
          {defects.length} total open
        </p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {message && (
          <div className={`p-3 rounded-xl text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-1.5 flex gap-1">
          <button
            onClick={() => setFilterTab('all')}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${
              filterTab === 'all'
                ? 'bg-red-600 text-white'
                : 'bg-transparent text-slate-700 hover:bg-slate-50'
            }`}
          >
            All ({counts.all})
          </button>
          <button
            onClick={() => setFilterTab('reported')}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${
              filterTab === 'reported'
                ? 'bg-red-600 text-white'
                : 'bg-transparent text-slate-700 hover:bg-slate-50'
            }`}
          >
            By me ({counts.reported})
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-2">
          <input
            type="text"
            placeholder="Search registration, item or note..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border-0 px-3 py-3 text-base text-slate-900 focus:outline-none"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 border border-slate-100 text-center">
            <p className="text-5xl mb-3">✅</p>
            <p className="text-slate-700 font-medium">
              {filterTab === 'reported' ? 'You haven\'t reported anything' : 'No open defects'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {defects.length === 0 ? 'All vehicles are good to go' : 'No matches'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([vehicleId, list]) => {
              const v = list[0]?.vehicle
              return (
                <div key={vehicleId} className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden">
                  <div className="bg-red-50 px-4 py-3 border-b border-red-200">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-2xl">{VEHICLE_TYPE_ICONS[v?.vehicle_type] || '🚗'}</span>
                      <p className="font-mono font-bold text-slate-800">{v?.registration}</p>
                      {v?.fleet_number && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                          #{v.fleet_number}
                        </span>
                      )}
                      <span className="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded-full font-medium">
                        {list.length} defect{list.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    {v?.name && (
                      <p className="text-xs text-slate-600 mt-0.5">{v.name}</p>
                    )}
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {list.map(d => {
                      const isResolving = resolvingId === d.id
                      const isAddingNote = addingNoteFor === d.id
                      const photos = photoMap[d.check_item_id] || []
                      const notes = notesMap[d.id] || []
                      const isAssignedToMe = d.assigned_to === currentUser?.id
                      const canAddNote = isAssignedToMe || hasDefectManagement
                      const canResolve = isAssignedToMe || hasDefectManagement

                      return (
                        <li key={d.id} className={`p-3 ${isAssignedToMe ? 'bg-purple-50/40' : ''}`}>

                          {isAssignedToMe && (
                            <div className="bg-purple-100 border border-purple-300 rounded-lg px-2 py-1 mb-2 inline-block">
                              <p className="text-[10px] font-bold text-purple-800 uppercase tracking-wide">
                                🔧 Assigned to you
                              </p>
                            </div>
                          )}

                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{d.category}</p>
                          <p className="text-sm font-medium text-slate-800">{d.item_text}</p>
                          {d.defect_note && (
                            <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2">
                              <p className="text-xs text-red-800 leading-snug whitespace-pre-wrap">{d.defect_note}</p>
                            </div>
                          )}

                          {photos.length > 0 && (
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {photos.map(p => (
                                <button
                                  key={p.id}
                                  onClick={() => openPhoto(p)}
                                  className="bg-slate-100 hover:bg-slate-200 rounded-lg p-2 text-center transition"
                                >
                                  <span className="text-2xl">📷</span>
                                  <p className="text-[10px] text-slate-600 truncate">{p.file_name}</p>
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-2 mt-2 text-xs text-slate-500 flex-wrap">
                            <span>By {d.reporter?.full_name || 'Unknown'}</span>
                            <span>·</span>
                            <span>{new Date(d.reported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            {d.assignee && !isAssignedToMe && (
                              <>
                                <span>·</span>
                                <span className="text-purple-700 font-medium">🔧 {d.assignee.full_name}</span>
                              </>
                            )}
                          </div>

                          {notes.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">🔧 Repair Log ({notes.length})</p>
                              {notes.map((n: any) => (
                                <div key={n.id} className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                                  <p className="text-xs text-slate-800 whitespace-pre-wrap leading-snug">{n.note}</p>
                                  <p className="text-[10px] text-slate-500 mt-1">
                                    {n.author?.full_name || 'Unknown'} · {new Date(n.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}

                          {isAddingNote && (
                            <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
                              <p className="text-sm font-semibold text-slate-800">🔧 Add Repair Note</p>
                              <textarea
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                rows={3}
                                placeholder="What's been done? Parts ordered, work in progress..."
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
                              />
                              <div className="flex gap-2 justify-end">
                                <button onClick={cancelAddNote} disabled={submitting} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg disabled:opacity-50">Cancel</button>
                                <button
                                  onClick={() => submitNote(d.id)}
                                  disabled={submitting}
                                  className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                                >
                                  {submitting ? 'Adding...' : 'Add Note'}
                                </button>
                              </div>
                            </div>
                          )}

                          {isResolving && (
                            <div className="mt-3 bg-slate-50 border border-slate-300 rounded-lg p-3 space-y-2">
                              <p className="text-sm font-semibold text-slate-800">
                                {resolutionAction === 'fixed' ? '✓ Mark as Fixed' : '✗ Dismiss Defect'}
                              </p>
                              <textarea
                                value={resolutionNotes}
                                onChange={(e) => setResolutionNotes(e.target.value)}
                                rows={2}
                                placeholder={resolutionAction === 'fixed' ? 'Final resolution notes' : 'Reason for dismissing'}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900"
                              />
                              <div className="flex gap-2 justify-end">
                                <button onClick={cancelResolve} disabled={submitting} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg disabled:opacity-50">Cancel</button>
                                <button
                                  onClick={submitResolve}
                                  disabled={submitting}
                                  className={`text-xs text-white px-3 py-1.5 rounded-lg disabled:opacity-50 ${
                                    resolutionAction === 'fixed' ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-600 hover:bg-slate-700'
                                  }`}
                                >
                                  {submitting ? 'Saving...' : 'Confirm'}
                                </button>
                              </div>
                            </div>
                          )}

                          {!isResolving && !isAddingNote && (canAddNote || canResolve) && (
                            <div className="mt-3 flex gap-2 justify-end flex-wrap">
                              {canAddNote && (
                                <button
                                  onClick={() => startAddNote(d.id)}
                                  className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-3 py-1.5 rounded-lg font-medium"
                                >
                                  📝 Add Note
                                </button>
                              )}
                              {canResolve && (
                                <>
                                  <button
                                    onClick={() => startResolve(d.id, 'dismissed')}
                                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium"
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
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        )}

      </div>

      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
        <button
          onClick={() => router.push('/employee/vehicle-checks/defects/new')}
          className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-sm"
        >
          + Report Defect
        </button>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <button onClick={() => router.push('/employee')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-slate-600">
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button onClick={() => router.push('/employee/profile')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-slate-600">
            <span className="text-xl">👤</span>
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>
    </main>
  )
}

// Default export — wraps the content in Suspense (required for useSearchParams)
export default function EmployeeDefectsPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </main>
    }>
      <DefectsPageContent />
    </Suspense>
  )
}
