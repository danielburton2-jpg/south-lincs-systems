import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import IdleTimeoutGuard from '@/components/IdleTimeoutGuard'
import NotificationShell from '@/components/NotificationShell'

/**
 * /employee/* layout.
 *
 *   • Server-side gate: only role='user' reaches the children. Anyone
 *     else gets redirected away.
 *   • Mounts the idle-timeout guard (handles silent auto-logout).
 *   • Mounts the notification shell so toasts + chime work app-wide.
 *
 * No sidebar — employee app is mobile-first. Bottom nav lives on the
 * page itself since it's part of the visual design rhythm.
 */

export default async function EmployeeLayout({
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
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Send the wrong role to the right place. Admins and managers are
  // allowed in /employee — they use the View Switcher card on
  // /dashboard/profile to flip to the mobile app, e.g. to do a
  // walkround on their phone while out driving. Superusers and any
  // other role are redirected away.
  if (profile.role === 'superuser') redirect('/superuser')
  if (
    profile.role !== 'user' &&
    profile.role !== 'admin' &&
    profile.role !== 'manager'
  ) {
    redirect('/login')
  }

  return (
    <NotificationShell
      userId={profile.id}
      companyId={profile.company_id}
      role={profile.role}
      scope="employee"
    >
      <IdleTimeoutGuard role={profile.role} />
      {children}
    </NotificationShell>
  )
}
