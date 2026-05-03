import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * /dashboard/day-sheet/* layout.
 *
 * Server-side guard: a company in 'shift_patterns' mode (the default)
 * has no business inside the Day Sheet pages. They get bounced to
 * /dashboard/schedules.
 *
 * Companies whose schedules feature isn't enabled at all also get
 * bounced (to /dashboard).
 *
 * Day-sheet companies pass through.
 */
export default async function DaySheetLayout({
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
        setAll() { /* no-op */ },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) redirect('/dashboard')
  if (profile.role !== 'admin' && profile.role !== 'manager') redirect('/dashboard')

  const { data: company } = await supabase
    .from('companies')
    .select('schedules_mode')
    .eq('id', profile.company_id)
    .single()

  // Belt-and-braces: also confirm the Schedules feature is on at all.
  // (Mode is meaningless if Schedules isn't enabled.)
  const { data: schedulesFeature } = await supabase
    .from('features').select('id').eq('slug', 'schedules').single()

  let schedulesEnabled = false
  if (schedulesFeature) {
    const { data: cf } = await supabase
      .from('company_features')
      .select('is_enabled')
      .eq('company_id', profile.company_id)
      .eq('feature_id', schedulesFeature.id)
      .maybeSingle()
    schedulesEnabled = !!cf?.is_enabled
  }

  if (!schedulesEnabled) redirect('/dashboard')
  if (company?.schedules_mode !== 'day_sheet') redirect('/dashboard/schedules')

  return <>{children}</>
}
