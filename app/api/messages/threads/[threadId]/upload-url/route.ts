/**
 * POST /api/messages/threads/[threadId]/upload-url
 *
 * Returns a short-lived signed upload URL the client can PUT a file to.
 *
 * Body:
 *   {
 *     message_id: string,    // pre-generated UUID — used for the path + as the message row id later
 *     filename: string,
 *     mime_type: string,
 *     size_bytes: number
 *   }
 *
 * Response:
 *   {
 *     storage_path: string,  // pass back to messages-with-attachments
 *     signed_url:   string   // PUT here with the file body
 *   }
 *
 * Validation:
 *   • Caller must be a member of the thread (via is_thread_member RLS path)
 *   • mime_type must match an allowed prefix
 *   • size_bytes must be ≤ 25 MB
 *   • filename gets sanitized (no slashes, normalized)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED_PREFIXES = ['image/', 'application/pdf']

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

function sanitizeFilename(raw: string): string {
  // Strip path separators, control chars, leading dots; collapse whitespace.
  return raw
    .replace(/[/\\]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 200)
    || 'file'
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params

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

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad request body' }, { status: 400 })

  const messageId: string = body.message_id || ''
  const filename: string = (body.filename || '').toString()
  const mimeType: string = (body.mime_type || '').toString()
  const sizeBytes: number = Number(body.size_bytes) || 0

  // UUID validation — basic shape check
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) {
    return NextResponse.json({ error: 'Invalid message_id' }, { status: 400 })
  }

  if (!filename || filename.length > 250) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  if (!mimeType || !ALLOWED_PREFIXES.some(p => mimeType.startsWith(p))) {
    return NextResponse.json({
      error: 'Only images and PDFs are allowed.'
    }, { status: 400 })
  }

  if (sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
    return NextResponse.json({
      error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB).`
    }, { status: 400 })
  }

  // Verify the user is a member of the target thread + same company.
  const svc = adminClient()
  const { data: thread } = await svc
    .from('message_threads')
    .select('id, company_id')
    .eq('id', threadId)
    .single()
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  const { data: profile } = await svc
    .from('profiles')
    .select('id, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id || profile.company_id !== thread.company_id) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  // Calls the SQL helper to confirm membership (works for live job_title threads too)
  const { data: isMember, error: memberErr } = await svc.rpc('is_thread_member', {
    p_thread_id: threadId,
    p_user_id: user.id,
  })
  if (memberErr || !isMember) {
    return NextResponse.json({ error: 'Not a member of this thread' }, { status: 403 })
  }

  // Build the path. The {messageId} segment lets the future message
  // create endpoint reuse the same UUID as the messages.id, so the
  // attachment gets bound to the message atomically.
  const fileUuid = crypto.randomUUID()
  const safeName = sanitizeFilename(filename)
  const storagePath = `${profile.company_id}/${threadId}/${messageId}/${fileUuid}-${safeName}`

  // Create a signed upload URL. Supabase's storage API returns a token
  // the client uses to PUT.
  const { data: signed, error: signErr } = await svc
    .storage
    .from('message-attachments')
    .createSignedUploadURL(storagePath)

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
