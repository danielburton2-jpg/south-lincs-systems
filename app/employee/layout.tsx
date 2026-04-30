import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import IdleTimeoutGuard from '@/components/IdleTimeoutGuard'

/**
 * /employee/* layout.
 *
 *   • Server-side gate: only role='user' reaches the children. Anyone
 *     else gets redirected away.
 *   • Mounts the idle-timeout guard (handles silent auto-logout).
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
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Send the wrong role to the right place
  if (profile.role === 'superuser')                            redirect('/superuser')
  if (profile.role === 'admin' || profile.role === 'manager')  redirect('/dashboard')
  if (profile.role !== 'user')                                 redirect('/login')

  return (
    <>
      <IdleTimeoutGuard />
      {children}
    </>
  )
}
