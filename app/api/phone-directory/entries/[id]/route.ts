/**
 * PATCH /api/phone-directory/entries/[id]
 *   Body: any subset of { name, phone_number, notes, sort_order }
 *
 * DELETE /api/phone-directory/entries/[id]
 *
 * Both: admin only, scoped to caller's company.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

async function adminCallerOrError(req: NextRequest) {
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
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }
  const svc = adminClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'No company' }, { status: 400 }) }
  if (profile.role !== 'admin') return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
  return { profile, svc }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const r = await adminCallerOrError(req)
  if ('error' in r) return r.error
  const { profile, svc } = r

  const body = await req.json().catch(() => null)
  const updates: Record<string, any> = {}
  if (typeof body?.name === 'string') {
    const v = body.name.trim()
    if (!v) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    updates.name = v
  }
  if (typeof body?.phone_number === 'string') {
    const v = body.phone_number.trim()
    if (!v) return NextResponse.json({ error: 'Phone number cannot be empty' }, { status: 400 })
    updates.phone_number = v
  }
  if (body?.notes !== undefined) {
    updates.notes = body.notes ? String(body.notes).trim() : null
  }
  if (typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)) {
    updates.sort_order = body.sort_order
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  // Ensure same-company guard at API layer (RLS enforces it too)
  const { data: existing } = await svc
    .from('phone_directory_entries')
    .select('id, company_id')
    .eq('id', id)
    .single()
  if (!existing || existing.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data, error } = await svc
    .from('phone_directory_entries')
    .update(updates)
    .eq('id', id)
    .select('id, name, phone_number, notes, sort_order')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    action: 'PHONE_DIRECTORY_ENTRY_UPDATED',
    entity: 'phone_directory_entry',
    details: { id, updates },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ entry: data })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const r = await adminCallerOrError(req)
  if ('error' in r) return r.error
  const { profile, svc } = r

  const { data: existing } = await svc
    .from('phone_directory_entries')
    .select('id, company_id, name, phone_number')
    .eq('id', id)
    .single()
  if (!existing || existing.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await svc
    .from('phone_directory_entries')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    action: 'PHONE_DIRECTORY_ENTRY_DELETED',
    entity: 'phone_directory_entry',
    details: { id, name: existing.name, phone_number: existing.phone_number },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ ok: true })
}
