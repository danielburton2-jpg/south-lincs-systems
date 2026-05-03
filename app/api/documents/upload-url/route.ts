/**
 * POST /api/documents/upload-url
 *
 * Admin requests a short-lived signed upload URL for one file.
 * Client PUTs the file bytes directly to Supabase Storage, then
 * calls /api/documents/finalize to create the DB row.
 *
 * Body:
 *   {
 *     document_id: string,    // pre-generated UUID; reused for the path
 *     folder_id:   string|null,
 *     filename:    string,
 *     mime_type:   string,
 *     size_bytes:  number,
 *   }
 *
 * Response: { storage_path, signed_url, token }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

const MAX_BYTES = 50 * 1024 * 1024  // 50 MB — bigger than messaging since these are reference docs

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'text/plain',
  'text/csv',
]

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[/\\]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 200)
    || 'file'
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

  const documentId: string = body.document_id || ''
  const folderId: string | null = body.folder_id || null
  const filename: string = (body.filename || '').toString()
  const mimeType: string = (body.mime_type || '').toString()
  const sizeBytes: number = Number(body.size_bytes) || 0

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) {
    return NextResponse.json({ error: 'Invalid document_id' }, { status: 400 })
  }
  if (!filename || filename.length > 250) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }
  if (!mimeType || !ALLOWED_MIME_PREFIXES.some(p => mimeType.startsWith(p))) {
    return NextResponse.json({
      error: 'Unsupported file type. Allowed: images, PDF, Word, Excel, plain text.'
    }, { status: 400 })
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
    return NextResponse.json({
      error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`
    }, { status: 400 })
  }

  // If folder_id given, verify it belongs to the caller's company
  if (folderId) {
    const { data: folder } = await svc
      .from('document_folders')
      .select('id, company_id')
      .eq('id', folderId)
      .single()
    if (!folder || folder.company_id !== caller.company_id) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }
  }

  // Path: {company_id}/{folder_id|root}/{uuid}-{filename}
  const safeName = sanitizeFilename(filename)
  const folderSegment = folderId || 'root'
  const fileUuid = crypto.randomUUID()
  const storagePath = `${caller.company_id}/${folderSegment}/${fileUuid}-${safeName}`

  const { data: signed, error: signErr } = await svc
    .storage
    .from('company-documents')
    .createSignedUploadUrl(storagePath)

  if (signErr || !signed) {
    return NextResponse.json({
      error: signErr?.message || 'Could not create upload URL'
    }, { status: 500 })
  }

  return NextResponse.json({
    storage_path: storagePath,
    signed_url: signed.signedUrl,
    token: signed.token,
  })
}
