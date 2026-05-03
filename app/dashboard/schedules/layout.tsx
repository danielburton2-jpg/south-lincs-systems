import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * /dashboard/schedules/* layout.
 *
 * Server-side guard added in step 4 of the Day Sheet rollout.
 *
 * Companies in 'day_sheet' mode shouldn't be able to access the
 * shift-patterns Schedules pages, so they get redirected to
 * /dashboard/day-sheet.
 *
 * Companies in 'shift_patterns' mode (the default) pass through —
 * the Schedules pages render exactly as before.
 *
 * If the Schedules feature isn't enabled for the company at all,
 * everyone gets bounced to /dashboard.
 *
 * NOTE: This layout runs on top of the existing dashboard layout,
 * not in place of it. It only adds the mode check.
 */
export default async function SchedulesLayout({
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

  const { data: company } = await supabase
    .from('companies')
    .select('schedules_mode')
    .eq('id', profile.company_id)
    .single()

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
  if (company?.schedules_mode === 'day_sheet') redirect('/dashboard/day-sheet')

  return <>{children}</>
}
