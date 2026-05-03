import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/detach-day-sheet-document
 *
 * Body: { day_sheet_id, document_id }
 *
 * Removes the link row from day_sheet_documents. The underlying
 * document is NOT deleted — it stays in /documents and can be
 * re-attached later or remains attached to other day sheets.
 *
 * Admin-only.
 *
 * Idempotent: if the link doesn't exist, returns { ok: true }.
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
    .select('id, role, company_id')
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

  const { error: delErr } = await svc
    .from('day_sheet_documents')
    .delete()
    .eq('day_sheet_id', day_sheet_id)
    .eq('document_id', document_id)
    .eq('company_id', caller.company_id)

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 })
  }

  await logAudit({
    action: 'DETACH_DAY_SHEET_DOCUMENT',
    entity: 'day_sheet_document',
    details: { day_sheet_id, document_id },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ ok: true })
}
