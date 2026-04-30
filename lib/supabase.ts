import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser Supabase client. Reads/writes auth cookies via the SSR
 * helper so the same session is visible to middleware on the server.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
