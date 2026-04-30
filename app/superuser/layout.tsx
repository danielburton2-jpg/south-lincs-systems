import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import SuperuserSidebar from '@/components/SuperuserSidebar'
import IdleTimeoutGuard from '@/components/IdleTimeoutGuard'

/**
 * /superuser/* layout.
 *
 *   • Server-side gate: only superusers reach the children. Anyone
 *     else gets redirected to /login.
 *   • Renders the permanent left sidebar.
 *   • Mounts <IdleTimeoutGuard /> which silently signs out after
 *     inactivity (only for the roles configured in that component).
 *
 * NOTE: This layout is the right place for the IdleTimeoutGuard —
 * NOT the root app/layout.tsx. Mounting it at the root means it runs
 * on /login too, which previously caused a build error to take down
 * the whole app. Keep IdleTimeoutGuard scoped to logged-in areas only.
 */

export default async function SuperuserLayout({
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

  if (!profile || profile.role !== 'superuser') {
    redirect('/login')
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <IdleTimeoutGuard />
      <SuperuserSidebar
        user={{
          full_name: profile.full_name,
          email: profile.email,
          role: profile.role,
        }}
      />
      <main className="flex-1 overflow-x-auto">
        {children}
      </main>
    </div>
  )
}
