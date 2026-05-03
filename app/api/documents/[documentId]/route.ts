/**
 * DELETE /api/documents/[documentId]
 *
 * Admin deletes a single document. Removes the storage object then
 * the DB row.
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params

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

  const { data: doc } = await svc
    .from('documents')
    .select('id, company_id, storage_path')
    .eq('id', documentId)
    .single()
  if (!doc || doc.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Best-effort storage cleanup. Even if this fails the user-visible
  // doc is gone after we delete the row.
  try {
    await svc.storage.from('company-documents').remove([doc.storage_path])
  } catch (err) {
    console.warn('[delete-document] storage cleanup failed:', err)
  }

  const { error: dErr } = await svc.from('documents').delete().eq('id', documentId)
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
