/**
 * PATCH /api/phone-directory/on-call/[id]
 *   Body: any subset of { phone_directory_entry_id, start_date,
 *                         end_date, time_window, notes }
 *
 * DELETE /api/phone-directory/on-call/[id]
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

async function adminCallerOrError() {
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
    .from('profiles').select('id, role, company_id').eq('id', user.id).single()
  if (!profile?.company_id) return { error: NextResponse.json({ error: 'No company' }, { status: 400 }) }
  if (profile.role !== 'admin') return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
  return { profile, svc }
}

const VALID_WINDOWS = new Set(['all_day', 'am', 'pm'])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const r = await adminCallerOrError()
  if ('error' in r) return r.error
  const { profile, svc } = r

  const body = await req.json().catch(() => null)
  const updates: Record<string, any> = {}

  if (body?.phone_directory_entry_id) {
    // Verify the new entry is in the same company
    const { data: entry } = await svc
      .from('phone_directory_entries')
      .select('id, company_id')
      .eq('id', body.phone_directory_entry_id)
      .single()
    if (!entry || entry.company_id !== profile.company_id) {
      return NextResponse.json({ error: 'Directory entry not found' }, { status: 404 })
    }
    updates.phone_directory_entry_id = body.phone_directory_entry_id
  }
  if (body?.start_date) {
    if (!ISO_DATE_RE.test(body.start_date)) {
      return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 })
    }
    updates.start_date = body.start_date
  }
  if (body?.end_date) {
    if (!ISO_DATE_RE.test(body.end_date)) {
      return NextResponse.json({ error: 'end_date must be YYYY-MM-DD' }, { status: 400 })
    }
    updates.end_date = body.end_date
  }
  if (body?.time_window) {
    if (!VALID_WINDOWS.has(body.time_window)) {
      return NextResponse.json({ error: 'Window must be all_day, am, or pm' }, { status: 400 })
    }
    updates.time_window = body.time_window
  }
  if (body?.notes !== undefined) {
    updates.notes = body.notes ? String(body.notes).trim() : null
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // Same-company guard on the slot itself
  const { data: existing } = await svc
    .from('on_call_slots')
    .select('id, company_id, start_date, end_date')
    .eq('id', id)
    .single()
  if (!existing || existing.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // If both dates being updated, verify ordering. If only one is, check
  // against the existing other.
  const finalStart = updates.start_date || existing.start_date
  const finalEnd = updates.end_date || existing.end_date
  if (finalStart > finalEnd) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  const { data, error } = await svc
    .from('on_call_slots')
    .update(updates)
    .eq('id', id)
    .select(`
      id, company_id, phone_directory_entry_id, start_date, end_date,
      time_window, notes, created_at,
      phone_directory_entries ( id, name, phone_number, notes )
    `)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    action: 'ON_CALL_SLOT_UPDATED',
    entity: 'on_call_slot',
    details: { id, updates },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ slot: data })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const r = await adminCallerOrError()
  if ('error' in r) return r.error
  const { profile, svc } = r

  const { data: existing } = await svc
    .from('on_call_slots')
    .select('id, company_id')
    .eq('id', id)
    .single()
  if (!existing || existing.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await svc
    .from('on_call_slots')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    action: 'ON_CALL_SLOT_DELETED',
    entity: 'on_call_slot',
    details: { id },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ ok: true })
}
