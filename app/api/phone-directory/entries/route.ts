/**
 * GET /api/phone-directory/entries
 *   Returns: { entries: [{ id, name, phone_number, notes, sort_order }] }
 *   Driver-side: requires a valid unlock cookie (see verify-code).
 *   Admin-side: bypasses the unlock cookie (admins manage; they don't
 *               need to PIN-unlock to read what they manage).
 *
 * POST /api/phone-directory/entries
 *   Body: { name, phone_number, notes? }
 *   Admin only. Creates a new entry in the caller's company.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { verifyUnlockToken, UNLOCK_COOKIE_NAME } from '@/lib/phoneCodeAuth'
import { logAudit } from '@/lib/audit'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

async function getCallerProfile(req: NextRequest) {
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
  if (!user) return null
  const svc = adminClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()
  return profile && profile.company_id ? profile : null
}

export async function GET(req: NextRequest) {
  const profile = await getCallerProfile(req)
  if (!profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Driver-side gate: require a valid unlock cookie. Admins bypass
  // because they're managing entries, not consuming them via the
  // PIN-protected employee surface.
  if (profile.role !== 'admin') {
    const cookieStore = await cookies()
    const token = cookieStore.get(UNLOCK_COOKIE_NAME)?.value
    if (!verifyUnlockToken(token, profile.id)) {
      return NextResponse.json({ error: 'Unlock required' }, { status: 403 })
    }
  }

  const svc = adminClient()
  const { data, error } = await svc
    .from('phone_directory_entries')
    .select('id, name, phone_number, notes, sort_order')
    .eq('company_id', profile.company_id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ entries: data || [] })
}

export async function POST(req: NextRequest) {
  const profile = await getCallerProfile(req)
  if (!profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const name: string = (body?.name || '').trim()
  const phone_number: string = (body?.phone_number || '').trim()
  const notes: string | null = body?.notes ? String(body.notes).trim() : null
  const sort_order: number = Number.isFinite(body?.sort_order) ? body.sort_order : 0

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!phone_number) return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })

  const svc = adminClient()
  const { data, error } = await svc
    .from('phone_directory_entries')
    .insert({
      company_id: profile.company_id,
      name,
      phone_number,
      notes: notes || null,
      sort_order,
      created_by: profile.id,
    })
    .select('id, name, phone_number, notes, sort_order')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    action: 'PHONE_DIRECTORY_ENTRY_CREATED',
    entity: 'phone_directory_entry',
    details: { id: data.id, name, phone_number },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ entry: data })
}
