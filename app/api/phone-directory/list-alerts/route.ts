/**
 * GET /api/phone-directory/list-alerts
 *
 * Returns: { alerts: [{ id, user_id, user_name, failed_count, raised_at }] }
 *
 * Active alerts only (not dismissed). Same-company. Admin only —
 * banner UIs check `me.role === 'admin'` before fetching, so this is
 * pure defence-in-depth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function GET(req: NextRequest) {
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
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const svc = adminClient()
  const { data: caller } = await svc
    .from('profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (!caller?.company_id || caller.role !== 'admin') {
    return NextResponse.json({ alerts: [] })
  }

  const { data, error } = await svc
    .from('phone_directory_alerts')
    .select('id, user_id, user_name, failed_count, raised_at')
    .eq('company_id', caller.company_id)
    .is('dismissed_at', null)
    .order('raised_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ alerts: data || [] })
}
