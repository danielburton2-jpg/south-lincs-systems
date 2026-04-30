import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * /superuser — landing page after sign-in.
 *
 * Reads the current profile server-side and shows a welcome message.
 * More cards / quick stats can be added in later stages.
 */

export default async function SuperuserHomePage() {
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
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user!.id)
    .single()

  const displayName = profile?.full_name || profile?.email || 'there'

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold text-slate-900">
        Welcome, {displayName}
      </h1>
      <p className="text-slate-500 mt-2">
        You&apos;re signed in as a superuser.
      </p>
    </div>
  )
}
