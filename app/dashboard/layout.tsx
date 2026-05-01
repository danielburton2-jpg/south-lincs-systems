import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardSidebar from '@/components/DashboardSidebar'
import IdleTimeoutGuard from '@/components/IdleTimeoutGuard'

/**
 * /dashboard/* layout.
 *
 *   • Server-side gate: only admins and managers reach the children.
 *   • Renders the sidebar with permission flags for each feature so the
 *     sidebar can decide which sections to show and what sub-item label
 *     to use for each.
 *   • Mounts <IdleTimeoutGuard /> for silent auto-logout after inactivity.
 *
 * Each feature exposes two flags to the sidebar:
 *   • <feature>CanEdit       — true if user has Edit on that feature
 *   • has<Feature>Access     — true if user has any access (read or edit)
 *
 * Admins always have both. Other roles read from user_features.
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
    .select('id, full_name, email, role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    redirect('/login')
  }

  // Permission flags. Admins always full.
  let holidaysCanEdit = profile.role === 'admin'
  let hasHolidayAccess = profile.role === 'admin'
  let schedulesCanEdit = profile.role === 'admin'
  let schedulesCanViewAll = profile.role === 'admin'
  let hasSchedulesAccess = profile.role === 'admin'

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

  return (
    <div className="min-h-screen flex bg-slate-50">
      <IdleTimeoutGuard />
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
      />
      <main className="flex-1 overflow-x-auto">
        {children}
      </main>
    </div>
  )
}
