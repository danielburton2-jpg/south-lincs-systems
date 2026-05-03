/**
 * DELETE /api/documents/folders/[folderId]
 *
 * Admin deletes a folder. Refused if the folder still has files in
 * it (admin must move or delete files first). This avoids accidental
 * mass-deletes.
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
  { params }: { params: Promise<{ folderId: string }> }
) {
  const { folderId } = await params

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

  // Verify folder belongs to caller's company
  const { data: folder } = await svc
    .from('document_folders')
    .select('id, company_id')
    .eq('id', folderId)
    .single()
  if (!folder || folder.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
  }

  // Refuse if folder still has files
  const { count } = await svc
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('folder_id', folderId)
  if ((count ?? 0) > 0) {
    return NextResponse.json({
      error: `Folder still contains ${count} file${count === 1 ? '' : 's'}. Delete or move them first.`,
    }, { status: 400 })
  }

  const { error: dErr } = await svc
    .from('document_folders')
    .delete()
    .eq('id', folderId)
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
