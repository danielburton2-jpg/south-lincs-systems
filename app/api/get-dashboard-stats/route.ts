import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * GET /api/get-dashboard-stats
 *
 * Returns counts and basic info for the admin/manager dashboard:
 *   • company           — basic company info + subscription dates
 *   • totalUsers        — count of users in this company (excluding deleted)
 *   • activeUsers       — totalUsers minus frozen
 *   • frozenUsers       — count of frozen users
 *   • managerTitles     — for managers, the job titles they oversee (empty array for admin)
 *
 * For managers, we filter user counts to only their team (people with
 * job titles that the manager oversees). Admins see the whole company.
 *
 * Auth via the user's session cookie — service role for the actual reads.
 */
export async function GET() {
  try {
    const cookieStore = await cookies()
    const ssr = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll() { /* no-op */ },
        },
      },
    )
    const { data: { user } } = await ssr.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: profile } = await svc
      .from('profiles')
      .select('id, role, company_id')
      .eq('id', user.id)
      .single()

    if (!profile || !profile.company_id) {
      return NextResponse.json({ error: 'No company assigned' }, { status: 400 })
    }
    if (profile.role !== 'admin' && profile.role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the company
    const { data: company } = await svc
      .from('companies')
      .select('id, name, is_active, start_date, end_date, override_end_date, subscription_length')
      .eq('id', profile.company_id)
      .single()

    // For managers: load the job titles they oversee
    let managerTitles: string[] = []
    if (profile.role === 'manager') {
      const { data: titles } = await svc
        .from('manager_job_titles')
        .select('job_title')
        .eq('manager_id', user.id)
      managerTitles = (titles || []).map(t => t.job_title)
    }

    // Get all (non-deleted) users for the company
    const { data: companyUsers } = await svc
      .from('profiles')
      .select('id, role, job_title, is_frozen')
      .eq('company_id', profile.company_id)
      .eq('is_deleted', false)

    // For admin: counts include all users
    // For manager: counts include only people they oversee (by job title)
    const visibleUsers = profile.role === 'admin'
      ? (companyUsers || [])
      : (companyUsers || []).filter(u =>
          u.job_title && managerTitles.includes(u.job_title)
        )

    const totalUsers   = visibleUsers.length
    const frozenUsers  = visibleUsers.filter(u => u.is_frozen).length
    const activeUsers  = totalUsers - frozenUsers

    // ── At-a-glance panels ─────────────────────────────────────────
    // The dashboard shows three additional panels:
    //   • Holidays pending count
    //   • Open defects (count + 5 newest)
    //   • Next 5 scheduled services
    //
    // Each panel has its own gating that the page also checks. The API
    // returns flags telling the page whether to render each one, so a
    // company without (say) Vehicle Checks doesn't get defect data sent
    // pointlessly.

    // 1. Which features does this company have enabled?
    const { data: cfRows } = await svc
      .from('company_features')
      .select('is_enabled, features (slug)')
      .eq('company_id', profile.company_id)
      .eq('is_enabled', true)
    const enabledSlugs = new Set(
      (cfRows || [])
        .map((r: any) => r.features?.slug)
        .filter(Boolean),
    )
    const companyHasHolidays = enabledSlugs.has('holidays')
    const companyHasVehicleChecks = enabledSlugs.has('vehicle_checks')
    const companyHasServices = enabledSlugs.has('services_mot')

    // 2. For managers, do they have can_edit on holidays?
    //    (Admins always have edit rights — they don't have user_features rows.)
    let userCanEditHolidays = profile.role === 'admin'
    if (profile.role === 'manager' && companyHasHolidays) {
      const { data: ufRows } = await svc
        .from('user_features')
        .select('can_edit, features (slug)')
        .eq('user_id', user.id)
      const hRow = (ufRows || []).find((r: any) => r.features?.slug === 'holidays')
      userCanEditHolidays = !!hRow?.can_edit
    }

    // 3. Holidays pending
    let holidaysPendingCount: number | null = null
    const showHolidays = companyHasHolidays && userCanEditHolidays
    if (showHolidays) {
      const { count } = await svc
        .from('holiday_requests')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', profile.company_id)
        .eq('status', 'pending')
      holidaysPendingCount = count ?? 0
    }

    // 4. Defects — count + 5 newest open
    let defectsOpenCount: number | null = null
    let recentDefects: any[] = []
    const showDefects = companyHasVehicleChecks
    if (showDefects) {
      const { count } = await svc
        .from('vehicle_defects')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', profile.company_id)
        .eq('status', 'open')
      defectsOpenCount = count ?? 0

      const { data: defectRows } = await svc
        .from('vehicle_defects')
        .select(`
          id, severity, description, item_text, defect_note, reported_at,
          vehicle:vehicles(id, registration, fleet_number, vehicle_type)
        `)
        .eq('company_id', profile.company_id)
        .eq('status', 'open')
        .order('reported_at', { ascending: false })
        .limit(5)
      recentDefects = defectRows || []
    }

    // 5. Next 5 things coming up — merged from two sources:
    //    (a) service_schedules rows that aren't completed/cancelled
    //    (b) Per-vehicle compliance dates from `vehicles`:
    //          next_service_due, mot_expiry_date, tacho_calibration_date,
    //          tax_due_date, loler_due_date
    //
    //    Dedup: if a service_schedules row of the same type exists for a
    //    vehicle, we skip that vehicle's compliance projection of the
    //    same type. Different types are independent (a scheduled MOT
    //    doesn't suppress the LOLER projection).
    //
    //    Past-due items appear first (they're sorted by date ascending,
    //    no date filter) — overdue is what an admin needs to see.
    let nextServices: any[] = []
    const showServices = companyHasServices
    if (showServices) {
      // (a) Scheduled rows
      const { data: sched } = await svc
        .from('service_schedules')
        .select(`
          id, service_type, status, priority,
          date_mode, scheduled_date, week_commencing,
          vehicle_id,
          vehicle:vehicles(id, registration, fleet_number, vehicle_type)
        `)
        .eq('company_id', profile.company_id)
        .in('status', ['scheduled', 'in_progress'])

      // (b) Vehicles with compliance dates
      const { data: vehs } = await svc
        .from('vehicles')
        .select('id, registration, fleet_number, vehicle_type, next_service_due, mot_expiry_date, tacho_calibration_date, tax_due_date, loler_due_date')
        .eq('company_id', profile.company_id)
        .eq('active', true)

      // Build a set of {vehicle_id|service_type} pairs already covered
      // by a scheduled row, so we don't double-up.
      const coveredByVehicleAndType = new Set<string>()
      ;(sched || []).forEach((s: any) => {
        if (s.vehicle_id && s.service_type) {
          coveredByVehicleAndType.add(`${s.vehicle_id}|${s.service_type}`)
        }
      })

      type Row = {
        id: string                  // synthetic — for React keys
        kind: 'scheduled' | 'compliance'
        service_type: string        // canonical slug
        status: string | null       // 'scheduled' | 'in_progress' | null
        date: string                // ISO date for sorting
        dateLabel: string           // human label (handles week-commencing)
        vehicle: any
      }
      const rows: Row[] = []

      // (a) — scheduled rows
      ;(sched || []).forEach((s: any) => {
        const date =
          s.date_mode === 'week' && s.week_commencing ? s.week_commencing
          : s.scheduled_date ? s.scheduled_date
          : null
        if (!date) return
        const dateLabel = s.date_mode === 'week' && s.week_commencing
          ? `WC ${new Date(s.week_commencing).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
          : new Date(s.scheduled_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
        rows.push({
          id: `sch:${s.id}`,
          kind: 'scheduled',
          service_type: s.service_type || 'custom',
          status: s.status,
          date,
          dateLabel,
          vehicle: s.vehicle,
        })
      })

      // (b) — compliance projections per vehicle
      const COMPLIANCE_FIELDS: Array<[keyof any, string]> = [
        ['next_service_due',       'service'],
        ['mot_expiry_date',        'mot'],
        ['tacho_calibration_date', 'tacho_calibration'],
        ['tax_due_date',           'tax'],
        ['loler_due_date',         'loler_inspection'],
      ]
      ;(vehs || []).forEach((v: any) => {
        COMPLIANCE_FIELDS.forEach(([field, type]) => {
          const dateVal: string | null = v[field as string] || null
          if (!dateVal) return
          // Skip if a scheduled row already covers this vehicle+type
          if (coveredByVehicleAndType.has(`${v.id}|${type}`)) return
          rows.push({
            id: `cmp:${v.id}:${type}`,
            kind: 'compliance',
            service_type: type,
            status: null,
            date: dateVal,
            dateLabel: new Date(dateVal).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            vehicle: {
              id: v.id,
              registration: v.registration,
              fleet_number: v.fleet_number,
              vehicle_type: v.vehicle_type,
            },
          })
        })
      })

      // Sort by date ascending (overdue first), take 5
      rows.sort((a, b) => a.date.localeCompare(b.date))
      nextServices = rows.slice(0, 5)
    }

    return NextResponse.json({
      company,
      totalUsers,
      activeUsers,
      frozenUsers,
      managerTitles,
      // New "at a glance" payload
      showHolidays,
      holidaysPendingCount,
      showDefects,
      defectsOpenCount,
      recentDefects,
      showServices,
      nextServices,
    })
  } catch (err: any) {
    console.error('get-dashboard-stats error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
