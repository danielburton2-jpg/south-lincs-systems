import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardSidebar from '@/components/DashboardSidebar'
import IdleTimeoutGuard from '@/components/IdleTimeoutGuard'
import NotificationShell from '@/components/NotificationShell'

/**
 * /dashboard/* layout.
 *
 *   • Server-side gate: only admins and managers reach the children.
 *   • Renders the sidebar with permission flags for each feature so the
 *     sidebar can decide which sections to show and what sub-item label
 *     to use for each.
 *   • Mounts <IdleTimeoutGuard /> for silent auto-logout after inactivity.
 *
 * Each feature exposes flags to the sidebar:
 *   • <feature>CanEdit       — true if user has Edit on that feature
 *   • has<Feature>Access     — true if user has any access (read or edit)
 *
 * Admins always have both. Other roles read from user_features.
 *
 * Vehicles is a special case: the page is admin-only, so we just need
 * to know whether the company has Vehicle Checks enabled — no per-user
 * tier yet.
 */

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* no-op in layout */ },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    redirect('/login')
  }

  // ── Permission flags ───────────────────────────────────────
  // Admins always full.
  let holidaysCanEdit       = profile.role === 'admin'
  let hasHolidayAccess      = profile.role === 'admin'
  let schedulesCanEdit      = profile.role === 'admin'
  let schedulesCanViewAll   = profile.role === 'admin'
  let hasSchedulesAccess    = profile.role === 'admin'

  // Vehicles starts off for everyone — gets enabled below if the
  // company has the feature ticked. The sidebar still requires admin
  // role on top of this.
  let hasVehiclesAccess     = false
  let hasServicesAccess     = false

  // ── Non-admin: look up per-user feature toggles ─────────────
  if (profile.role !== 'admin') {
    // Look up Holidays
    const { data: holidaysFeature } = await supabase
      .from('features').select('id').eq('slug', 'holidays').single()
    if (holidaysFeature) {
      const { data: uf } = await supabase
        .from('user_features')
        .select('is_enabled, can_view, can_edit')
        .eq('user_id', user.id)
        .eq('feature_id', holidaysFeature.id)
        .maybeSingle()
      holidaysCanEdit = !!uf?.can_edit
      hasHolidayAccess = !!(uf?.can_view || uf?.can_edit || uf?.is_enabled)
    }

    // Look up Schedules
    const { data: schedulesFeature } = await supabase
      .from('features').select('id').eq('slug', 'schedules').single()
    if (schedulesFeature) {
      const { data: uf } = await supabase
        .from('user_features')
        .select('is_enabled, can_view, can_view_all, can_edit')
        .eq('user_id', user.id)
        .eq('feature_id', schedulesFeature.id)
        .maybeSingle()
      schedulesCanEdit = !!uf?.can_edit
      schedulesCanViewAll = !!uf?.can_view_all
      hasSchedulesAccess = !!(uf?.is_enabled || uf?.can_view || uf?.can_edit)
    }
  }

  // ── Vehicles: company-level feature flag (regardless of role) ──
  // Lifted out of the else-branch so it always runs. The sidebar
  // separately gates by admin role; this just answers "does this
  // company have Vehicle Checks?".
  if (profile.company_id) {
    const { data: vehiclesFeature, error: vErr } = await supabase
      .from('features').select('id').eq('slug', 'vehicle_checks').single()

    if (vErr) {
      console.warn('[layout] vehicle_checks feature lookup failed:', vErr.message)
    }

    if (vehiclesFeature) {
      const { data: cf, error: cfErr } = await supabase
        .from('company_features')
        .select('is_enabled')
        .eq('company_id', profile.company_id)
        .eq('feature_id', vehiclesFeature.id)
        .maybeSingle()

      if (cfErr) {
        console.warn('[layout] company_features lookup failed:', cfErr.message)
      }

      hasVehiclesAccess = !!cf?.is_enabled
    }
  }

  // Services & MOT — same lookup pattern. Independent feature flag
  // (Vehicle Checks does NOT imply Services & MOT — they are separate
  // tickboxes on the company edit form).
  if (profile.company_id) {
    const { data: servicesFeature, error: sErr } = await supabase
      .from('features').select('id').eq('slug', 'services_mot').single()

    if (sErr) {
      console.warn('[layout] services_mot feature lookup failed:', sErr.message)
    }

    if (servicesFeature) {
      const { data: cf, error: cfErr } = await supabase
        .from('company_features')
        .select('is_enabled')
        .eq('company_id', profile.company_id)
        .eq('feature_id', servicesFeature.id)
        .maybeSingle()

      if (cfErr) {
        console.warn('[layout] company_features lookup (services) failed:', cfErr.message)
      }

      hasServicesAccess = !!cf?.is_enabled
    }
  }

  // Diagnostic line — visible in Vercel server logs / terminal.
  // Helps verify the sidebar is getting the right flags.
  console.log('[dashboard layout] flags:', {
    role: profile.role,
    company_id: profile.company_id,
    hasHolidayAccess,
    hasSchedulesAccess,
    hasVehiclesAccess,
    hasServicesAccess,
  })

  return (
    <NotificationShell
      userId={profile.id}
      companyId={profile.company_id}
      role={profile.role}
      scope="dashboard"
    >
      <div className="min-h-screen flex bg-slate-50">
        <IdleTimeoutGuard role={profile.role} />
        <DashboardSidebar
          user={{
            full_name: profile.full_name,
            email: profile.email,
            role: profile.role,
          }}
          holidaysCanEdit={holidaysCanEdit}
          hasHolidayAccess={hasHolidayAccess}
          schedulesCanEdit={schedulesCanEdit}
          schedulesCanViewAll={schedulesCanViewAll}
          hasSchedulesAccess={hasSchedulesAccess}
          hasVehiclesAccess={hasVehiclesAccess}
          hasServicesAccess={hasServicesAccess}
        />
        <main className="flex-1 overflow-x-auto">
          {children}
        </main>
      </div>
    </NotificationShell>
  )
}
