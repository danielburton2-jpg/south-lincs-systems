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
  // Default to false. Admin gets it ONLY if (a) the company has the
  // feature enabled, AND for non-admins also (b) the user_features
  // row grants them access. Old code defaulted admins to true which
  // bypassed the company-level gate — that meant admins of e.g. a
  // Holidays-only company saw Schedules in their sidebar.
  let holidaysCanEdit       = false
  let hasHolidayAccess      = false
  let schedulesCanEdit      = false
  let schedulesCanViewAll   = false
  let hasSchedulesAccess    = false

  // Vehicles starts off for everyone — gets enabled below if the
  // company has the feature ticked. The sidebar still requires admin
  // role on top of this.
  let hasVehiclesAccess     = false
  let hasServicesAccess     = false
  let hasDocumentsAccess    = false

  // ── Holidays: company gate first, then per-user for non-admins ─
  if (profile.company_id) {
    const { data: holidaysFeature } = await supabase
      .from('features').select('id').eq('slug', 'holidays').single()

    if (holidaysFeature) {
      const { data: cf } = await supabase
        .from('company_features')
        .select('is_enabled')
        .eq('company_id', profile.company_id)
        .eq('feature_id', holidaysFeature.id)
        .maybeSingle()

      if (cf?.is_enabled) {
        if (profile.role === 'admin') {
          // Admin: company has it on → admin gets full access
          hasHolidayAccess = true
          holidaysCanEdit  = true
        } else {
          // Non-admin: still need a user_features row
          const { data: uf } = await supabase
            .from('user_features')
            .select('is_enabled, can_view, can_edit')
            .eq('user_id', user.id)
            .eq('feature_id', holidaysFeature.id)
            .maybeSingle()
          holidaysCanEdit  = !!uf?.can_edit
          hasHolidayAccess = !!(uf?.can_view || uf?.can_edit || uf?.is_enabled)
        }
      }
    }
  }

  // ── Schedules: same pattern ────────────────────────────────────
  if (profile.company_id) {
    const { data: schedulesFeature } = await supabase
      .from('features').select('id').eq('slug', 'schedules').single()

    if (schedulesFeature) {
      const { data: cf } = await supabase
        .from('company_features')
        .select('is_enabled')
        .eq('company_id', profile.company_id)
        .eq('feature_id', schedulesFeature.id)
        .maybeSingle()

      if (cf?.is_enabled) {
        if (profile.role === 'admin') {
          hasSchedulesAccess  = true
          schedulesCanEdit    = true
          schedulesCanViewAll = true
        } else {
          const { data: uf } = await supabase
            .from('user_features')
            .select('is_enabled, can_view, can_view_all, can_edit')
            .eq('user_id', user.id)
            .eq('feature_id', schedulesFeature.id)
            .maybeSingle()
          schedulesCanEdit    = !!uf?.can_edit
          schedulesCanViewAll = !!uf?.can_view_all
          hasSchedulesAccess  = !!(uf?.is_enabled || uf?.can_view || uf?.can_edit)
        }
      }
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

  // Documents — same per-company feature flag pattern.
  if (profile.company_id) {
    const { data: documentsFeature, error: dErr } = await supabase
      .from('features').select('id').eq('slug', 'documents').single()

    if (dErr) {
      console.warn('[layout] documents feature lookup failed:', dErr.message)
    }

    if (documentsFeature) {
      const { data: cf, error: cfErr } = await supabase
        .from('company_features')
        .select('is_enabled')
        .eq('company_id', profile.company_id)
        .eq('feature_id', documentsFeature.id)
        .maybeSingle()

      if (cfErr) {
        console.warn('[layout] company_features lookup (documents) failed:', cfErr.message)
      }

      hasDocumentsAccess = !!cf?.is_enabled
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
          hasDocumentsAccess={hasDocumentsAccess}
        />
        <main className="flex-1 overflow-x-auto">
          {children}
        </main>
      </div>
    </NotificationShell>
  )
}
