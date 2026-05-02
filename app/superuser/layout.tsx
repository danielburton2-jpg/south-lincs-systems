import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import SuperuserSidebar from '@/components/SuperuserSidebar'
import IdleTimeoutGuard from '@/components/IdleTimeoutGuard'

/**
 * /superuser/* layout
 *
 * Wraps every superuser page with:
 *   • Permanent left sidebar
 *   • Auto-logout after 60 minutes of inactivity (via IdleTimeoutGuard)
 *
 * Also gates access: redirects non-superusers to /login.
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
    }
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
      {/* Idle timeout — silently signs the user out after 60 min inactivity.
          Only activates for the roles defined in IdleTimeoutGuard. */}
      <IdleTimeoutGuard role={profile.role} />

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
