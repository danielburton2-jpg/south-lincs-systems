/**
 * POST /api/documents/finalize
 *
 * Admin records a document row after a successful direct-to-storage
 * upload. The path was minted by /api/documents/upload-url; this
 * call commits the metadata.
 *
 * Body: {
 *   document_id, folder_id|null, storage_path,
 *   filename, mime_type, size_bytes
 * }
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
  if (!caller.company_id) {
    return NextResponse.json({ error: 'No company' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const documentId = body.document_id
  const folderId = body.folder_id || null
  const storagePath = body.storage_path
  const filename = body.filename
  const mimeType = body.mime_type
  const sizeBytes = Number(body.size_bytes) || 0

  if (!documentId || !storagePath || !filename) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Path validation: first segment must equal the caller's company.
  // Prevents one user finalising another company's storage path.
  const segs = storagePath.split('/')
  if (segs.length < 3 || segs[0] !== caller.company_id) {
    return NextResponse.json({ error: 'Storage path does not match company' }, { status: 400 })
  }

  // If folder_id given, also verify the path's folder segment matches.
  if (folderId && segs[1] !== folderId) {
    return NextResponse.json({
      error: 'Storage path does not match folder_id'
    }, { status: 400 })
  }
  if (!folderId && segs[1] !== 'root') {
    return NextResponse.json({
      error: 'Storage path expected /root/ for unfiled docs'
    }, { status: 400 })
  }

  const { data: doc, error } = await svc
    .from('documents')
    .insert({
      id: documentId,
      company_id: caller.company_id,
      folder_id: folderId,
      storage_path: storagePath,
      filename,
      mime_type: mimeType || null,
      size_bytes: sizeBytes,
      uploaded_by: caller.id,
    })
    .select('id, folder_id, filename, mime_type, size_bytes, uploaded_at')
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ document: doc })
}
