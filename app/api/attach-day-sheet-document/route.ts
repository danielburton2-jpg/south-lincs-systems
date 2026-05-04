import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/attach-day-sheet-document
 *
 * Body: { day_sheet_id, document_id }
 *
 * Creates a row in day_sheet_documents linking the two. Both must
 * belong to the same company as the caller.
 *
 * Admin-only — matches the auth pattern on /api/documents/finalize.
 *
 * Idempotent: if the link already exists (UNIQUE constraint), returns
 * { ok: true } without error.
 */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function POST(req: NextRequest) {
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
    .select('id, email, role, company_id')
    .eq('id', user.id)
    .single()
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  const body = await req.json()
  const { day_sheet_id, document_id } = body
  if (!day_sheet_id || !document_id) {
    return NextResponse.json({ error: 'day_sheet_id and document_id are required' }, { status: 400 })
  }

  // Validate ownership: both day sheet and document must belong to
  // the caller's company.
  const { data: ds } = await svc
    .from('day_sheets')
    .select('id, company_id')
    .eq('id', day_sheet_id)
    .single()
  if (!ds || ds.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Day sheet not found in your company' }, { status: 404 })
  }

  const { data: doc } = await svc
    .from('documents')
    .select('id, company_id')
    .eq('id', document_id)
    .single()
  if (!doc || doc.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Document not found in your company' }, { status: 404 })
  }

  // Insert the link. If it already exists the UNIQUE constraint will
  // raise; treat as a no-op.
  const { error: insErr } = await svc
    .from('day_sheet_documents')
    .insert({
      company_id: caller.company_id,
      day_sheet_id,
      document_id,
      created_by: caller.id,
    })

  if (insErr) {
    // Postgres unique-violation code 23505 — the link already exists.
    // Anything else is a real error.
    if ((insErr as any).code === '23505') {
      return NextResponse.json({ ok: true, already_attached: true })
    }
    return NextResponse.json({ error: insErr.message }, { status: 400 })
  }

  await logAudit({
    user_id: caller.id,
    user_email: caller.email,
    user_role: caller.role,
    action: 'ATTACH_DAY_SHEET_DOCUMENT',
    entity: 'day_sheet_document',
    details: { day_sheet_id, document_id },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ ok: true })
}
