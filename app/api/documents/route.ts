/**
 * GET /api/documents
 *   List files in the caller's company. Anyone in the company can see.
 *
 *   Query params:
 *     folder_id   - filter by folder
 *     root=true   - return only root-level files (no folder_id)
 *     omit both   - return ALL files in the company
 *
 *   Response: { documents: [{ id, filename, mime_type, size_bytes,
 *               uploaded_at, uploaded_by_name, signed_url, folder_id }] }
 *
 *   Signed URLs expire in 10 minutes. Page sessions usually fit;
 *   if a long-running tab is left open, refresh to get fresh URLs.
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
  const { data: profile } = await svc
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'No company' }, { status: 400 })
  }

  const url = new URL(req.url)
  const folderId = url.searchParams.get('folder_id')
  const rootOnly = url.searchParams.get('root') === 'true'

  let query = svc
    .from('documents')
    .select('id, folder_id, storage_path, filename, mime_type, size_bytes, uploaded_at, uploaded_by')
    .eq('company_id', profile.company_id)
    .order('uploaded_at', { ascending: false })

  if (folderId) {
    query = query.eq('folder_id', folderId)
  } else if (rootOnly) {
    query = query.is('folder_id', null)
  }

  const { data: docs, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolve uploader names + sign URLs in parallel.
  const uploaderIds = Array.from(new Set((docs || []).map(d => d.uploaded_by).filter(Boolean) as string[]))
  let uploaderNameById = new Map<string, string>()
  if (uploaderIds.length > 0) {
    const { data: profs } = await svc
      .from('profiles')
      .select('id, full_name')
      .in('id', uploaderIds)
    for (const p of (profs || [])) {
      uploaderNameById.set(p.id, p.full_name || 'User')
    }
  }

  const signed = await Promise.all((docs || []).map(async (d) => {
    const { data } = await svc.storage
      .from('company-documents')
      .createSignedUrl(d.storage_path, 60 * 10)
    return {
      id: d.id,
      folder_id: d.folder_id,
      filename: d.filename,
      mime_type: d.mime_type,
      size_bytes: d.size_bytes,
      uploaded_at: d.uploaded_at,
      uploaded_by_name: d.uploaded_by ? (uploaderNameById.get(d.uploaded_by) || 'User') : 'Someone',
      signed_url: data?.signedUrl || null,
    }
  }))

  return NextResponse.json({ documents: signed })
}
