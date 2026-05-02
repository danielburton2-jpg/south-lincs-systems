'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { notifyEvent } from '@/lib/notifyEvent'
const supabase = createClient()

const WEEKS_VISIBLE = 26
// "Drop weeks at the beginning once 2 weeks have passed" — so we always
// show 2 historical weeks for context, then today, then 23 future weeks.
const HISTORY_WEEKS = 2

// ─── Service type colour palette ──────────────────────────────────────
// Yellow = Service, Red = MOT, others picked.
const SERVICE_TYPE_META: Record<string, { label: string; icon: string; bg: string; border: string; text: string; accent: string }> = {
  safety_inspection: { label: 'Service',  icon: '🔧', bg: 'bg-yellow-200',  border: 'border-yellow-500',  text: 'text-yellow-900',  accent: 'bg-yellow-500' },
  full_service:      { label: 'Full Svc', icon: '🛠️', bg: 'bg-yellow-300',  border: 'border-yellow-600',  text: 'text-yellow-900',  accent: 'bg-yellow-600' },
  mot_prep:          { label: 'MOT',      icon: '📋', bg: 'bg-red-200',     border: 'border-red-500',     text: 'text-red-900',     accent: 'bg-red-500' },
  tacho:             { label: 'Tacho',    icon: '⏱️', bg: 'bg-purple-200',  border: 'border-purple-500',  text: 'text-purple-900',  accent: 'bg-purple-500' },
  loler:             { label: 'LOLER',    icon: '⚙️', bg: 'bg-cyan-200',    border: 'border-cyan-500',    text: 'text-cyan-900',    accent: 'bg-cyan-500' },
  tax:               { label: 'Tax',      icon: '💷', bg: 'bg-green-200',   border: 'border-green-500',   text: 'text-green-900',   accent: 'bg-green-500' },
  custom:            { label: 'Custom',   icon: '📝', bg: 'bg-slate-300',    border: 'border-slate-500',    text: 'text-slate-800',    accent: 'bg-slate-500' },
}

const STATUS_OVERLAY: Record<string, string> = {
  in_progress: 'ring-2 ring-amber-500 ring-inset',
  completed:   '', // no fade — completed cells stay visible with a green tick overlay
  cancelled:   'opacity-30 line-through',
  overdue:     'ring-2 ring-red-700 ring-inset',
}

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛', class_2: '🚚', bus: '🚌', coach: '🚍', minibus: '🚐',
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  class_1: 'Class 1', class_2: 'Class 2', bus: 'Bus', coach: 'Coach', minibus: 'Minibus',
}

// ─── Date helpers ────────────────────────────────────────────────────
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const startOfWeekMon = (d: Date): Date => {
  const out = new Date(d); out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  out.setDate(out.getDate() + (day === 0 ? -6 : 1 - day))
  return out
}

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d); out.setDate(out.getDate() + n); return out
}

// ISO week number (mostly correct for UK use)
const isoWeekNumber = (d: Date): number => {
  const target = new Date(d.valueOf())
  const dayNr = (d.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setMonth(0, 1)
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7)
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000)
}

const formatShort = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

export default function ServicesCalendarPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [vehicles, setVehicles] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [mechanicsById, setMechanicsById] = useState<Record<string, any>>({})
  const [defaultsByType, setDefaultsByType] = useState<Record<string, any>>({})

  // Filters
  const [filterVehicleType, setFilterVehicleType] = useState<string>('all')
  const [filterServiceType, setFilterServiceType] = useState<string>('all')
  const [filterMechanic, setFilterMechanic] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [selectedSchedule, setSelectedSchedule] = useState<any | null>(null)
  // When a completed schedule is selected, we also load its service_records
  // row so we can show the report inline (defects found, mileage, costs, mechanic).
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null)
  const [recordLoading, setRecordLoading] = useState(false)
  // Quick-assign modal for projected (auto) cells
  const [quickAssign, setQuickAssign] = useState<{ vehicle: any; service_type: string; weekIso: string; dueDate: string } | null>(null)
  const [quickAssignMechanic, setQuickAssignMechanic] = useState<string>('')
  const [quickAssignBusy, setQuickAssignBusy] = useState(false)

  // Week navigation — offset in weeks from "default" (which is today minus HISTORY_WEEKS)
  // 0 = default view (today's week is at column index HISTORY_WEEKS)
  // -1 = shifted 1 week earlier (older), +1 = shifted 1 week later (newer)
  const [weekOffset, setWeekOffset] = useState(0)

  const todayWeekStart = useMemo(() => startOfWeekMon(new Date()), [])

  // Build the rolling 26-week window
  const weeks = useMemo(() => {
    // Anchor = today's Monday minus HISTORY_WEEKS, then shifted by weekOffset
    const anchor = addDays(todayWeekStart, (-HISTORY_WEEKS + weekOffset) * 7)
    return Array.from({ length: WEEKS_VISIBLE }, (_, i) => {
      const monday = addDays(anchor, i * 7)
      return {
        monday,
        iso: isoDate(monday),
        weekNo: isoWeekNumber(monday),
        isToday: isoDate(monday) === isoDate(todayWeekStart),
        isPast: monday < todayWeekStart,
      }
    })
  }, [todayWeekStart, weekOffset])

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)

    if (!profile.company_id) { router.push('/dashboard'); return }
    if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'superuser') {
      router.push('/dashboard'); return
    }

    const { data: companyData } = await supabase
      .from('companies').select('*, company_features (is_enabled, features (name))').eq('id', profile.company_id).single()
    setCompany(companyData)

    const hasFeature = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && (cf.features?.name === 'Services & Defects' || cf.features?.name === 'Services & MOT')
    )
    if (!hasFeature) { router.push('/dashboard'); return }

    // Vehicles (all active)
    const { data: vehData } = await supabase
      .from('vehicles')
      .select('*')
      .eq('company_id', profile.company_id)
      .eq('active', true)
      .order('registration', { ascending: true })
    setVehicles(vehData || [])

    // Mechanics — use the API endpoint that uses the service role
    // (bypasses RLS, same approach as dashboard/page.tsx). The earlier
    // direct user_features query returned nothing for some users due
    // to RLS on user_features only exposing your own rows.
    try {
      // Look up the Services & Defects feature by slug (slug never
      // changes, name has been renamed from 'Services & MOT'). Users
      // with this feature enabled are the company's mechanics — they
      // can be assigned services and defects.
      const { data: mechFeat } = await supabase.from('features').select('id').eq('slug', 'services_mot').single()

      const usersRes = await fetch('/api/get-company-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: profile.company_id }),
      })
      const usersResult = await usersRes.json()

      const mMap: Record<string, any> = {}
      if (mechFeat?.id && usersResult?.users) {
        usersResult.users.forEach((u: any) => {
          if (u.is_frozen || u.is_deleted) return
          const hasMechFeat = (u.user_features || []).some(
            (uf: any) => uf.feature_id === mechFeat.id && uf.is_enabled
          )
          if (hasMechFeat) {
            mMap[u.id] = {
              id: u.id,
              full_name: u.full_name,
              email: u.email,
              company_id: u.company_id,
            }
          }
        })
      }
      setMechanicsById(mMap)
    } catch (err) {
      console.error('Failed to load mechanics:', err)
      setMechanicsById({})
    }

    // Service defaults (for MOT prep lead time per vehicle type)
    const { data: defs } = await supabase
      .from('company_service_defaults').select('*').eq('company_id', profile.company_id)
    const dMap: Record<string, any> = {}
    ;(defs || []).forEach((d: any) => { dMap[d.vehicle_type] = d })
    setDefaultsByType(dMap)

    setLoading(false)
  }, [router])

  useEffect(() => { init() }, [init])

  // Load schedules covering the visible window
  const loadSchedules = useCallback(async () => {
    if (!currentUser?.company_id || weeks.length === 0) return
    const start = weeks[0].iso
    const end = weeks[weeks.length - 1].iso
    // Add 6 days to end so we catch jobs scheduled for any day in that final week
    const endPlus = addDays(weeks[weeks.length - 1].monday, 6)
    const endPlusIso = isoDate(endPlus)

    const { data } = await supabase
      .from('service_schedules')
      .select('*')
      .eq('company_id', currentUser.company_id)
      .or(
        `and(scheduled_date.gte.${start},scheduled_date.lte.${endPlusIso}),` +
        `and(week_commencing.gte.${start},week_commencing.lte.${end})`
      )
    setSchedules(data || [])
  }, [currentUser?.company_id, weeks])

  useEffect(() => { loadSchedules() }, [loadSchedules])

  // Realtime
  useEffect(() => {
    if (!currentUser?.company_id) return
    const channel = supabase.channel('services-cal-rt')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'service_schedules', filter: `company_id=eq.${currentUser.company_id}` },
        () => loadSchedules()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.company_id, loadSchedules])

  // When a completed schedule is selected, load its service_records row
  // (with summary info: defects, mileage, costs, mechanic name).
  useEffect(() => {
    setSelectedRecord(null)
    if (!selectedSchedule || selectedSchedule.status !== 'completed') return

    setRecordLoading(true)
    ;(async () => {
      const { data: rec } = await supabase
        .from('service_records')
        .select('*')
        .eq('schedule_id', selectedSchedule.id)
        .maybeSingle()

      if (rec) {
        // Look up the mechanic's name from our cached map
        const mech = rec.performed_by ? mechanicsById[rec.performed_by] : null
        setSelectedRecord({ ...rec, mechanic_name: mech?.full_name || null })
      }
      setRecordLoading(false)
    })()
  }, [selectedSchedule, mechanicsById])

  // Index schedules by (vehicle_id + weekIso) for O(1) lookup in the grid
  // Each entry is either { kind: 'real', schedule: ... } or { kind: 'projected', vehicle, service_type, dueDate }
  const cellIndex = useMemo(() => {
    const map: Record<string, any[]> = {}

    // ── 1. Add real scheduled jobs ────────────────────────────────
    schedules.forEach(s => {
      let weekIso: string
      if (s.date_mode === 'week' && s.week_commencing) {
        weekIso = s.week_commencing
      } else if (s.scheduled_date) {
        weekIso = isoDate(startOfWeekMon(new Date(s.scheduled_date)))
      } else {
        return
      }
      // Apply filters
      // Note: completed schedules are ALWAYS shown so admins keep
      // a permanent visual record. Cancelled ones can be hidden by
      // ticking "Hide cancelled" (default: shown but faded).
      if (filterServiceType !== 'all' && s.service_type !== filterServiceType) return
      if (filterMechanic !== 'all') {
        if (filterMechanic === '__unassigned__') {
          if (s.assigned_to) return
        } else if (s.assigned_to !== filterMechanic) return
      }
      const key = `${s.vehicle_id}|${weekIso}`
      if (!map[key]) map[key] = []
      map[key].push({ kind: 'real', schedule: s, service_type: s.service_type })
    })

    // ── 2. Build a set of (vehicle_id + service_type) that already
    //       have a real schedule in the visible window — so we can
    //       suppress projections that are already covered.
    const realByVehicleType: Record<string, Set<string>> = {}
    schedules.forEach(s => {
      if (s.status === 'completed' || s.status === 'cancelled') return
      const key = `${s.vehicle_id}|${s.service_type}`
      if (!realByVehicleType[key]) realByVehicleType[key] = new Set()
      // Track which week the real one is in
      let weekIso: string | null = null
      if (s.date_mode === 'week' && s.week_commencing) weekIso = s.week_commencing
      else if (s.scheduled_date) weekIso = isoDate(startOfWeekMon(new Date(s.scheduled_date)))
      if (weekIso) realByVehicleType[key].add(weekIso)
    })

    // ── 3. Build projections from vehicle compliance dates ────────
    const windowStart = weeks[0]?.iso
    const windowEnd = weeks[weeks.length - 1]?.iso
    if (!windowStart || !windowEnd) return map

    // Helper: turn a date string into a week-iso, but only return if
    // it falls inside the visible window
    const projectIntoWindow = (dateStr: string | null | undefined): string | null => {
      if (!dateStr) return null
      const wkIso = isoDate(startOfWeekMon(new Date(dateStr)))
      if (wkIso < windowStart || wkIso > windowEnd) return null
      return wkIso
    }

    // Helper: is this projection already covered by a real schedule?
    const isCovered = (vehicleId: string, serviceType: string): boolean => {
      const set = realByVehicleType[`${vehicleId}|${serviceType}`]
      return !!set && set.size > 0
    }

    vehicles.forEach(v => {
      // Apply mechanic filter — projections have no mechanic, so if
      // a specific mechanic is selected, skip projections entirely
      if (filterMechanic !== 'all' && filterMechanic !== '__unassigned__') return

      // ── Service projection (yellow) — CASCADES forward up to
      //    52 weeks (1 year) from TODAY at the company's interval
      //    (per vehicle type, or vehicle override). The visible
      //    window only shows 26 weeks at a time, but as the user
      //    navigates forward with Next/4w, the further-out
      //    projections come into view.
      if (v.next_service_due && (filterServiceType === 'all' || filterServiceType === 'safety_inspection')) {
        // Resolve the service interval for this vehicle
        const intervalWeeks: number =
          (v.service_interval_weeks && v.service_interval_weeks > 0)
            ? v.service_interval_weeks
            : (defaultsByType[v.vehicle_type]?.service_interval_weeks ?? 6)

        // Hard cap on how far out we project: 52 weeks from today.
        // (Computed once outside the vehicles loop would be cleaner —
        //  but the deps are already settled, perf impact is trivial.)
        const cascadeCutoff = new Date()
        cascadeCutoff.setHours(0, 0, 0, 0)
        cascadeCutoff.setDate(cascadeCutoff.getDate() + 52 * 7)

        // Walk forward from next_service_due in interval steps.
        // Each step is a "cascade point". Stop when:
        //   - we pass the 52-week cutoff, or
        //   - safety net hit (HARD_CAP) so an infinite loop can't happen.
        let cursor = new Date(v.next_service_due)
        let cascadeIndex = 0
        const HARD_CAP = 60
        while (cascadeIndex < HARD_CAP) {
          if (cursor > cascadeCutoff) break

          const dueIso = isoDate(cursor)
          const wk = projectIntoWindow(dueIso) // null if outside visible 26-week window

          // Projection #0 is suppressed if a real schedule exists for
          // this service type. Cascaded projections (#1+) always show
          // — they're provisional until the previous one is completed.
          const suppress = cascadeIndex === 0 && (
            isCovered(v.id, 'safety_inspection') || isCovered(v.id, 'full_service')
          )

          // Only place on the grid if (a) it's in the visible window
          // and (b) not suppressed.
          if (wk && !suppress) {
            const key = `${v.id}|${wk}`
            if (!map[key]) map[key] = []
            map[key].push({
              kind: 'projected',
              vehicle: v,
              service_type: 'safety_inspection',
              dueDate: dueIso,
              weekIso: wk,
              cascadeIndex,
            })
          }

          // Step forward by the interval
          cursor = new Date(cursor.getTime() + intervalWeeks * 7 * 24 * 60 * 60 * 1000)
          cascadeIndex++
        }
      }

      // ── MOT projection (red) — at expiry minus lead time ────────
      if (v.mot_expiry_date && (filterServiceType === 'all' || filterServiceType === 'mot_prep')) {
        if (!isCovered(v.id, 'mot_prep')) {
          const lead = defaultsByType[v.vehicle_type]?.mot_prep_lead_days ?? 14
          const expiry = new Date(v.mot_expiry_date)
          const prepDate = new Date(expiry.getTime() - lead * 24 * 60 * 60 * 1000)
          const wk = projectIntoWindow(isoDate(prepDate))
          if (wk) {
            const key = `${v.id}|${wk}`
            if (!map[key]) map[key] = []
            map[key].push({
              kind: 'projected',
              vehicle: v,
              service_type: 'mot_prep',
              dueDate: v.mot_expiry_date,
              weekIso: wk,
            })
          }
        }
      }

      // ── Tacho projection (purple) ───────────────────────────────
      if (v.tacho_calibration_date && (filterServiceType === 'all' || filterServiceType === 'tacho')) {
        if (!isCovered(v.id, 'tacho')) {
          const wk = projectIntoWindow(v.tacho_calibration_date)
          if (wk) {
            const key = `${v.id}|${wk}`
            if (!map[key]) map[key] = []
            map[key].push({
              kind: 'projected',
              vehicle: v,
              service_type: 'tacho',
              dueDate: v.tacho_calibration_date,
              weekIso: wk,
            })
          }
        }
      }

      // ── Tax projection (green) ──────────────────────────────────
      if (v.tax_due_date && (filterServiceType === 'all' || filterServiceType === 'tax')) {
        if (!isCovered(v.id, 'tax')) {
          const wk = projectIntoWindow(v.tax_due_date)
          if (wk) {
            const key = `${v.id}|${wk}`
            if (!map[key]) map[key] = []
            map[key].push({
              kind: 'projected',
              vehicle: v,
              service_type: 'tax',
              dueDate: v.tax_due_date,
              weekIso: wk,
            })
          }
        }
      }

      // ── LOLER projection (cyan) ─────────────────────────────────
      if (v.loler_due_date && (filterServiceType === 'all' || filterServiceType === 'loler')) {
        if (!isCovered(v.id, 'loler')) {
          const wk = projectIntoWindow(v.loler_due_date)
          if (wk) {
            const key = `${v.id}|${wk}`
            if (!map[key]) map[key] = []
            map[key].push({
              kind: 'projected',
              vehicle: v,
              service_type: 'loler',
              dueDate: v.loler_due_date,
              weekIso: wk,
            })
          }
        }
      }
    })

    return map
  }, [schedules, filterServiceType, filterMechanic, vehicles, weeks, defaultsByType])

  // Filter the vehicle list, then sort by urgency.
  // Urgency tiers (top → bottom):
  //   0 = pending — has a non-completed/non-cancelled schedule OR a
  //       projected due-date in the visible window. Sorted ascending
  //       by date, so the most overdue / soonest is first.
  //   1 = idle  — no schedules at all (or only cancelled). Sorted
  //       alphabetically.
  //   2 = completed — has schedules, all completed/cancelled. Sorted
  //       by most-recent completion last, so the freshly-done sit at
  //       the very bottom.
  const filteredVehicles = useMemo(() => {
    const filtered = vehicles.filter(v => {
      if (filterVehicleType !== 'all' && v.vehicle_type !== filterVehicleType) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return v.registration?.toLowerCase().includes(q) ||
          (v.fleet_number || '').toLowerCase().includes(q) ||
          (v.name || '').toLowerCase().includes(q)
      }
      return true
    })

    // Build a single urgency record per vehicle
    const ranked = filtered.map(v => {
      // Earliest "pending" date — from real non-completed/cancelled
      // schedules and from in-window projections.
      let earliestPending: string | null = null

      // Real schedules
      schedules.forEach(s => {
        if (s.vehicle_id !== v.id) return
        if (s.status === 'completed' || s.status === 'cancelled') return
        const d = s.scheduled_date || s.week_commencing
        if (!d) return
        if (!earliestPending || d < earliestPending) earliestPending = d
      })

      // Projections (from compliance fields). Only consider those in
      // the visible window or already overdue.
      const projDates: (string | null)[] = [
        v.mot_expiry_date,
        v.next_service_due,
        v.tacho_calibration_date,
        v.tax_due_date,
        v.loler_due_date,
      ]
      projDates.forEach(d => {
        if (!d) return
        // Already covered by a real non-completed schedule for the
        // same service type? Skip — we don't want to double-count.
        // (Cheap conservative version: just include all due dates.)
        if (!earliestPending || d < earliestPending) earliestPending = d
      })

      // Most-recent completion (for tier 2 sort)
      let latestCompleted: string | null = null
      schedules.forEach(s => {
        if (s.vehicle_id !== v.id) return
        if (s.status !== 'completed') return
        const d = s.scheduled_date || s.week_commencing
        if (!d) return
        if (!latestCompleted || d > latestCompleted) latestCompleted = d
      })

      // Did this vehicle have ANY schedules at all (any status)?
      const hadAnySchedule = schedules.some(s => s.vehicle_id === v.id)

      let tier: 0 | 1 | 2
      let primary: string  // sort key within tier
      if (earliestPending) {
        tier = 0
        primary = earliestPending
      } else if (!hadAnySchedule) {
        tier = 1
        primary = ''
      } else {
        tier = 2
        // More-recent completion sorts LATER (= bigger string), which
        // puts the freshly-done vehicles at the bottom of tier 2.
        primary = latestCompleted || ''
      }

      return { v, tier, primary }
    })

    ranked.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      if (a.primary !== b.primary) return a.primary < b.primary ? -1 : 1
      // Stable secondary: registration alphabetical
      return (a.v.registration || '').localeCompare(b.v.registration || '')
    })

    return ranked.map(r => r.v)
  }, [vehicles, filterVehicleType, search, schedules])

  // Click an empty cell → go to schedule form pre-filled
  const onClickEmptyCell = (vehicleId: string, weekIso: string) => {
    router.push(`/dashboard/services/schedule?vehicle_id=${vehicleId}&week_commencing=${weekIso}&date_mode=week`)
  }

  const updateStatus = async (s: any, status: string) => {
    const { error } = await supabase.from('service_schedules').update({ status }).eq('id', s.id)
    if (error) { alert('Could not update: ' + error.message); return }
    setSelectedSchedule(null)
    loadSchedules()
  }

  const reassign = async (s: any, newMechId: string) => {
    const { error } = await supabase.from('service_schedules')
      .update({
        assigned_to: newMechId || null,
        assigned_by: newMechId ? currentUser.id : null,
        assigned_at: newMechId ? new Date().toISOString() : null,
      })
      .eq('id', s.id)
    if (error) { alert('Could not reassign: ' + error.message); return }

    // Phone push to the new assignee (skipped if just unassigning).
    if (newMechId) {
      await notifyEvent({ kind: 'service_assigned', schedule_id: s.id })
    }

    setSelectedSchedule(null)
    loadSchedules()
  }

  // Quick-assign: turn an auto-projection into a real scheduled job
  const submitQuickAssign = async () => {
    if (!quickAssign) return
    if (!quickAssignMechanic) { alert('Pick a mechanic'); return }
    setQuickAssignBusy(true)

    // Find the active template for this vehicle type + service type so the
    // mechanic gets the right check sheet when they open the job.
    const { data: tmpl } = await supabase
      .from('service_templates')
      .select('id')
      .eq('company_id', currentUser.company_id)
      .eq('vehicle_type', quickAssign.vehicle.vehicle_type)
      .eq('service_type', quickAssign.service_type)
      .eq('active', true)
      .maybeSingle()

    const { data: inserted, error } = await supabase.from('service_schedules').insert({
      company_id: currentUser.company_id,
      vehicle_id: quickAssign.vehicle.id,
      service_type: quickAssign.service_type,
      template_id: tmpl?.id || null,
      date_mode: 'week',
      week_commencing: quickAssign.weekIso,
      scheduled_date: null,
      assigned_to: quickAssignMechanic,
      assigned_by: currentUser.id,
      assigned_at: new Date().toISOString(),
      priority: 'normal',
      status: 'scheduled',
      auto_generated: true,
    })
    .select('id')
    .single()

    setQuickAssignBusy(false)
    if (error) { alert('Could not assign: ' + error.message); return }

    // Phone push to the assignee
    if (inserted?.id) {
      await notifyEvent({ kind: 'service_assigned', schedule_id: inserted.id })
    }

    setQuickAssign(null)
    setQuickAssignMechanic('')
    loadSchedules()
  }

  // Auto-scroll the calendar so today's column starts visible
  const gridRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!loading && gridRef.current) {
      // Today's column index = HISTORY_WEEKS - weekOffset
      // (when offset is 0, today is at index HISTORY_WEEKS; when offset is +1,
      //  the window has shifted forward by 1, so today is now at index HISTORY_WEEKS - 1)
      const cellWidth = 50
      const todayIndex = HISTORY_WEEKS - weekOffset
      // Only auto-scroll horizontally if today is actually within the visible grid
      if (todayIndex >= 0 && todayIndex < WEEKS_VISIBLE) {
        gridRef.current.scrollLeft = Math.max(0, todayIndex * cellWidth - 20)
      } else if (weekOffset > 0) {
        // We've navigated beyond today — show start of window
        gridRef.current.scrollLeft = 0
      } else {
        // We've navigated before today — show end of window
        gridRef.current.scrollLeft = gridRef.current.scrollWidth
      }
    }
  }, [loading, weekOffset])

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  const mechanicOptions = Object.values(mechanicsById)

  return (
    <div className="p-4 max-w-[1600px]">

      {/* Title row — compact, single line */}
      <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-bold text-slate-900">Services Calendar</h1>
          <span className="text-[11px] text-slate-500">{company?.name} · 26wk</span>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => router.push('/dashboard/services/schedule')}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1 rounded-md text-xs font-medium"
          >
            + Schedule
          </button>
          <button
            onClick={() => router.push('/dashboard/vehicles')}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            ← Back
          </button>
        </div>
      </div>

      <div className="space-y-2">

        {/* Toolbar — filters + week nav + legend, all in one card */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-2 space-y-2">

          {/* Row 1 — filters */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <input
              type="text"
              placeholder="Search vehicle…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-xs border border-slate-300 rounded px-2 py-1 min-w-[140px] flex-shrink"
            />
            <select value={filterVehicleType} onChange={e => setFilterVehicleType(e.target.value)}
              className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white">
              <option value="all">All types</option>
              <option value="class_1">🚛 Class 1</option>
              <option value="class_2">🚚 Class 2</option>
              <option value="bus">🚌 Bus</option>
              <option value="coach">🚍 Coach</option>
              <option value="minibus">🚐 Minibus</option>
            </select>
            <select value={filterServiceType} onChange={e => setFilterServiceType(e.target.value)}
              className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white">
              <option value="all">All services</option>
              {Object.entries(SERVICE_TYPE_META).map(([v, m]) => (
                <option key={v} value={v}>{m.icon} {m.label}</option>
              ))}
            </select>
            <select value={filterMechanic} onChange={e => setFilterMechanic(e.target.value)}
              className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white">
              <option value="all">All mechanics</option>
              <option value="__unassigned__">— Unassigned —</option>
              {mechanicOptions.map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <span className="text-[10px] text-slate-400 ml-auto">
              {filteredVehicles.length} vehicle{filteredVehicles.length !== 1 ? 's' : ''} · click empty cell to schedule
            </span>
          </div>

          {/* Row 2 — week nav (left) + range (right) */}
          <div className="flex items-center justify-between flex-wrap gap-2 border-t border-slate-100 pt-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWeekOffset(o => o - 4)}
                className="bg-slate-50 hover:bg-slate-200 text-slate-600 px-1.5 py-1 rounded text-[11px]"
                title="Shift 4 weeks earlier">⏪</button>
              <button
                onClick={() => setWeekOffset(o => o - 1)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded text-xs"
                title="Shift 1 week earlier">←</button>
              <button
                onClick={() => setWeekOffset(0)}
                disabled={weekOffset === 0}
                className={`px-2 py-1 rounded text-xs ${
                  weekOffset === 0
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white font-medium'
                }`}
                title="Reset to today">⌂ Today</button>
              <button
                onClick={() => setWeekOffset(o => o + 1)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded text-xs"
                title="Shift 1 week later">→</button>
              <button
                onClick={() => setWeekOffset(o => o + 4)}
                className="bg-slate-50 hover:bg-slate-200 text-slate-600 px-1.5 py-1 rounded text-[11px]"
                title="Shift 4 weeks later">⏩</button>
            </div>

            <div className="text-[11px] text-slate-600">
              <strong>{formatShort(weeks[0].monday)}</strong>
              {' → '}
              <strong>{formatShort(addDays(weeks[weeks.length - 1].monday, 6))}</strong>
              {weekOffset !== 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-medium">
                  {weekOffset > 0 ? `+${weekOffset}` : weekOffset}w
                </span>
              )}
            </div>
          </div>

          {/* Row 3 — legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 items-center text-[10px] text-slate-600 border-t border-slate-100 pt-2">
            {Object.entries(SERVICE_TYPE_META).map(([v, m]) => (
              <span key={v} className="flex items-center gap-1">
                <span className={`inline-block w-3 h-3 rounded-sm ${m.bg} ${m.border} border-l-4`}></span>
                {m.label}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-slate-100 border-2 border-dashed border-slate-400"></span>
              Auto-projected
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-green-200 border border-green-500 border-l-4 flex items-center justify-center text-green-700 font-bold text-[8px] leading-none">✓</span>
              Completed
            </span>
          </div>

        </div>

        {/* The big calendar grid */}
        {filteredVehicles.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-12 text-center">
            <p className="text-5xl mb-3">🚛</p>
            <p className="text-slate-500">
              {vehicles.length === 0 ? 'No active vehicles in your fleet yet.' : 'No vehicles match the filters.'}
            </p>
          </div>
        ) : (
          <div ref={gridRef} className="bg-white rounded-xl shadow overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="border-separate border-spacing-0" style={{ minWidth: 150 + WEEKS_VISIBLE * 50 }}>
              <thead className="sticky top-0 z-30">
                {/* Week numbers row */}
                <tr>
                  <th className="sticky left-0 z-40 bg-slate-100 border-b-2 border-slate-300 border-r border-slate-300 px-1.5 py-1 text-left text-[10px] font-semibold text-slate-700 uppercase" style={{ width: 130, minWidth: 130 }}>
                    Vehicle
                  </th>
                  {weeks.map(w => (
                    <th key={w.iso}
                      className={`border-b-2 border-r border-slate-200 px-0.5 py-1 text-center text-[10px] font-semibold leading-tight ${
                        w.isToday ? 'bg-blue-100 border-b-blue-500 text-blue-900' :
                        w.isPast  ? 'bg-slate-100 text-slate-500' :
                                    'bg-slate-50 text-slate-700'
                      }`}
                      style={{ width: 50, minWidth: 50 }}>
                      <div>W{w.weekNo}</div>
                      <div className={`text-[9px] font-normal ${w.isToday ? 'text-blue-700' : 'text-slate-500'}`}>
                        {formatShort(w.monday)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredVehicles.map((v, rowIdx) => (
                  <tr key={v.id} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} style={{ height: 32 }}>
                    {/* Vehicle column (sticky left) */}
                    <td className={`sticky left-0 z-20 border-b border-r border-slate-200 px-1.5 py-0.5 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                      style={{ width: 130, minWidth: 130 }}>
                      <div className="flex items-center gap-1">
                        <span className="text-sm flex-shrink-0">{VEHICLE_TYPE_ICONS[v.vehicle_type] || '🚗'}</span>
                        <div className="min-w-0 leading-tight">
                          <p className="font-mono font-bold text-slate-800 text-[11px] truncate">{v.registration}</p>
                          <p className="text-[9px] text-slate-500 truncate">
                            {v.fleet_number ? `#${v.fleet_number} · ` : ''}{VEHICLE_TYPE_LABELS[v.vehicle_type]}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Week cells */}
                    {weeks.map(w => {
                      const items = cellIndex[`${v.id}|${w.iso}`] || []
                      const isToday = w.isToday

                      if (items.length === 0) {
                        // Empty cell — clickable to schedule
                        return (
                          <td key={w.iso}
                            onClick={() => onClickEmptyCell(v.id, w.iso)}
                            className={`border-b border-r border-slate-200 cursor-pointer hover:bg-blue-50 transition group ${
                              isToday ? 'bg-blue-50/50' : ''
                            }`}
                            style={{ width: 50, minWidth: 50, height: 32 }}
                            title={`Schedule ${v.registration} for week commencing ${formatShort(w.monday)}`}>
                            <div className="w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                              <span className="text-blue-600 text-lg">+</span>
                            </div>
                          </td>
                        )
                      }

                      // Filled cell — show colour blocks for each entry
                      return (
                        <td key={w.iso}
                          className={`border-b border-r border-slate-200 p-0.5 ${isToday ? 'bg-blue-50/30' : ''}`}
                          style={{ width: 50, minWidth: 50, height: 32 }}>
                          <div className="flex flex-col gap-0.5 h-full">
                            {items.slice(0, 3).map((entry: any, i: number) => {
                              const meta = SERVICE_TYPE_META[entry.service_type] || SERVICE_TYPE_META.custom

                              if (entry.kind === 'projected') {
                                // Auto-projection — pure colour block, hover tooltip
                                const projTitle = entry.cascadeIndex
                                  ? `${meta.label} (projected #${entry.cascadeIndex + 1}) — click to assign`
                                  : `${meta.label} due — click to assign mechanic`
                                return (
                                  <button key={`p-${i}`}
                                    onClick={() => {
                                      setQuickAssign({
                                        vehicle: entry.vehicle,
                                        service_type: entry.service_type,
                                        weekIso: entry.weekIso,
                                        dueDate: entry.dueDate,
                                      })
                                      setQuickAssignMechanic('')
                                    }}
                                    className={`flex-1 ${meta.bg} border-2 border-dashed ${meta.border} rounded hover:brightness-95 transition`}
                                    title={projTitle}
                                  >
                                    <span className="sr-only">{meta.label}</span>
                                  </button>
                                )
                              }

                              // Real schedule — pure colour block with status overlay
                              const s = entry.schedule
                              const overlay = STATUS_OVERLAY[s.status] || ''
                              const isCompleted = s.status === 'completed'
                              const statusBit = isCompleted
                                ? ' (completed ✓)'
                                : s.assigned_to ? ' (assigned)' : ' (unassigned)'
                              const realTitle = `${meta.label} — ${s.status}${statusBit}${s.priority === 'urgent' ? ' • URGENT' : ''}`
                              return (
                                <button key={s.id}
                                  onClick={() => setSelectedSchedule(s)}
                                  className={`flex-1 ${meta.bg} ${meta.border} ${overlay} border-l-4 rounded hover:brightness-95 transition relative flex items-center justify-center`}
                                  title={realTitle}>
                                  <span className="sr-only">{meta.label}</span>
                                  {isCompleted && (
                                    <span className="text-green-700 font-bold text-xs leading-none drop-shadow-sm" aria-hidden>✓</span>
                                  )}
                                  {s.priority === 'urgent' && !isCompleted && (
                                    <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-700 rounded-full"></span>
                                  )}
                                </button>
                              )
                            })}
                            {items.length > 3 && (
                              <button
                                onClick={() => {
                                  // Open the first overflow item — could be either type
                                  const overflow = items[3]
                                  if (overflow.kind === 'real') setSelectedSchedule(overflow.schedule)
                                  else setQuickAssign({
                                    vehicle: overflow.vehicle,
                                    service_type: overflow.service_type,
                                    weekIso: overflow.weekIso,
                                    dueDate: overflow.dueDate,
                                  })
                                }}
                                className="text-[8px] text-slate-600 hover:text-slate-900 italic leading-none">
                                +{items.length - 3}
                              </button>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* Quick-assign modal (for projected cells) */}
      {quickAssign && (() => {
        const meta = SERVICE_TYPE_META[quickAssign.service_type] || SERVICE_TYPE_META.custom
        const v = quickAssign.vehicle
        const wkDate = new Date(quickAssign.weekIso)
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setQuickAssign(null)}>
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className={`flex items-start justify-between -mx-5 -mt-5 px-5 py-3 ${meta.bg} ${meta.text} rounded-t-xl`}>
                <div>
                  <p className="text-xs uppercase opacity-80">{meta.icon} {meta.label} — Quick assign</p>
                  <h3 className="text-lg font-bold">
                    {VEHICLE_TYPE_ICONS[v.vehicle_type] || ''} {v.registration}
                  </h3>
                  {v.fleet_number && <p className="text-xs opacity-80">Fleet #{v.fleet_number}</p>}
                </div>
                <button onClick={() => setQuickAssign(null)} className="opacity-60 hover:opacity-100 text-xl">×</button>
              </div>

              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Week</span>
                  <span className="font-medium">
                    Week {isoWeekNumber(wkDate)} • Mon {wkDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">
                    {quickAssign.service_type === 'mot_prep' ? 'MOT expires' : 'Due'}
                  </span>
                  <span className="font-medium">{new Date(quickAssign.dueDate).toLocaleDateString('en-GB')}</span>
                </div>
                {quickAssign.service_type === 'mot_prep' && (
                  <p className="text-xs text-slate-500 italic">
                    Scheduled this week so prep is done before MOT runs out.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assign to mechanic *</label>
                {mechanicOptions.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                    No mechanics available — give a user the <strong>Services &amp; Defects</strong> feature first.
                  </div>
                ) : (
                  <select value={quickAssignMechanic} onChange={e => setQuickAssignMechanic(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                    autoFocus>
                    <option value="">— pick a mechanic —</option>
                    {mechanicOptions.map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button onClick={submitQuickAssign} disabled={quickAssignBusy || !quickAssignMechanic}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  {quickAssignBusy ? 'Assigning...' : 'Assign & Schedule'}
                </button>
                <button onClick={() => setQuickAssign(null)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Detail modal */}
      {selectedSchedule && (() => {
        const s = selectedSchedule
        const v = vehicles.find(x => x.id === s.vehicle_id)
        const meta = SERVICE_TYPE_META[s.service_type] || SERVICE_TYPE_META.custom
        const isCompleted = s.status === 'completed'
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setSelectedSchedule(null)}>
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className={`flex items-start justify-between -mx-5 -mt-5 px-5 py-3 ${meta.bg} ${meta.text} rounded-t-xl`}>
                <div>
                  <p className="text-xs uppercase opacity-80">{meta.icon} {meta.label}{isCompleted && ' ✓'}</p>
                  <h3 className="text-lg font-bold">
                    {v ? `${VEHICLE_TYPE_ICONS[v.vehicle_type] || ''} ${v.registration}` : 'Vehicle'}
                  </h3>
                  {v?.fleet_number && <p className="text-xs opacity-80">Fleet #{v.fleet_number}</p>}
                </div>
                <button onClick={() => setSelectedSchedule(null)} className="opacity-60 hover:opacity-100 text-xl">×</button>
              </div>

              <div className="space-y-2 text-sm pt-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <span className={`capitalize font-medium ${isCompleted ? 'text-green-700' : ''}`}>
                    {s.status.replace('_', ' ')}{isCompleted && ' ✓'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">When</span>
                  <span>
                    {s.date_mode === 'week'
                      ? `Week commencing ${new Date(s.week_commencing).toLocaleDateString('en-GB')}`
                      : new Date(s.scheduled_date).toLocaleDateString('en-GB')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Priority</span>
                  <span className="capitalize">{s.priority}{s.priority === 'urgent' && ' 🚨'}</span>
                </div>
                {!isCompleted && (
                  <div>
                    <p className="text-slate-500 mb-1">Assigned to</p>
                    <select value={s.assigned_to || ''} onChange={e => reassign(s, e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                      <option value="">— Unassigned —</option>
                      {mechanicOptions.map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                  </div>
                )}
                {s.notes && (
                  <div>
                    <p className="text-slate-500">Notes</p>
                    <p className="bg-slate-50 rounded-lg p-2 text-slate-800 whitespace-pre-wrap">{s.notes}</p>
                  </div>
                )}
              </div>

              {/* Service report — only when completed */}
              {isCompleted && (
                <div className="border-t border-slate-200 pt-3">
                  <p className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2">Service Report</p>
                  {recordLoading ? (
                    <p className="text-sm text-slate-500 italic">Loading report...</p>
                  ) : !selectedRecord ? (
                    <p className="text-sm text-amber-600 italic">No service record found for this job.</p>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Outcome</span>
                        <span className={`font-semibold ${selectedRecord.pass ? 'text-green-700' : 'text-red-700'}`}>
                          {selectedRecord.pass ? '✓ PASS' : '✗ FAIL'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Performed by</span>
                        <span>{selectedRecord.mechanic_name || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Performed on</span>
                        <span>{selectedRecord.performed_date ? new Date(selectedRecord.performed_date).toLocaleDateString('en-GB') : '—'}</span>
                      </div>
                      {selectedRecord.defects_found > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Defects found</span>
                          <span className="text-red-700 font-semibold">{selectedRecord.defects_found}</span>
                        </div>
                      )}
                      {selectedRecord.start_mileage != null && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Start mileage</span>
                          <span className="font-mono">{Number(selectedRecord.start_mileage).toLocaleString()} mi</span>
                        </div>
                      )}
                      {selectedRecord.end_mileage != null && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">End mileage</span>
                          <span className="font-mono">{Number(selectedRecord.end_mileage).toLocaleString()} mi</span>
                        </div>
                      )}
                      {selectedRecord.mot_certificate_expiry && (
                        <div className="flex justify-between bg-indigo-50 -mx-2 px-2 py-1 rounded">
                          <span className="text-indigo-700">📋 New MOT expiry</span>
                          <span className="font-semibold text-indigo-900">
                            {new Date(selectedRecord.mot_certificate_expiry).toLocaleDateString('en-GB')}
                          </span>
                        </div>
                      )}
                      {selectedRecord.notes && (
                        <div className="border-t border-slate-100 pt-2">
                          <p className="text-slate-500 text-xs mb-0.5">Mechanic notes</p>
                          <p className="bg-slate-50 rounded p-2 text-slate-800 whitespace-pre-wrap">{selectedRecord.notes}</p>
                        </div>
                      )}
                      {selectedRecord.signature && (
                        <div className="text-xs text-slate-500 italic mt-2">
                          Signed off by {selectedRecord.signature}
                        </div>
                      )}
                      <button
                        onClick={() => router.push(`/employee/services/${selectedRecord.id}`)}
                        className="w-full mt-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium">
                        View full check sheet →
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                {s.status === 'scheduled' && (
                  <button onClick={() => updateStatus(s, 'in_progress')}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg text-sm font-medium">
                    Mark in progress
                  </button>
                )}
                {s.status !== 'cancelled' && s.status !== 'completed' && (
                  <button onClick={() => { if (confirm('Cancel this scheduled job?')) updateStatus(s, 'cancelled') }}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm">
                    Cancel job
                  </button>
                )}
                {isCompleted && (
                  <button onClick={() => setSelectedSchedule(null)}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
