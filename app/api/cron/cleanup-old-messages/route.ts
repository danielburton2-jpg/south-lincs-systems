/**
 * GET /api/cron/cleanup-old-messages
 *
 * Daily cron route. Deletes message rows older than 90 days and
 * cleans up their associated storage attachment objects.
 *
 * Threads themselves are NOT deleted — only their old messages.
 * An empty thread that has no messages left is still visible (with
 * an empty preview) so the conversation channel stays open.
 *
 * Authentication: this route is protected by Vercel's CRON_SECRET
 * environment variable. Vercel automatically sends an
 * `Authorization: Bearer ${CRON_SECRET}` header for scheduled cron
 * runs. Manual calls without the right header are rejected.
 *
 * Set CRON_SECRET in Vercel Project Settings → Environment Variables.
 * Use any random string (e.g. `openssl rand -hex 32`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const RETENTION_DAYS = 90
const BATCH_LIMIT = 500  // safety bound — process at most N per run

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function GET(req: NextRequest) {
  // ── Auth gate ──
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({
      error: 'CRON_SECRET not configured on the server',
    }, { status: 500 })
  }
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const svc = adminClient()

  // 1. Find old messages (cap at BATCH_LIMIT for safety).
  const { data: oldMessages, error: findErr } = await svc
    .from('messages')
    .select('id')
    .lt('created_at', cutoff)
    .limit(BATCH_LIMIT)
  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 500 })
  }
  if (!oldMessages || oldMessages.length === 0) {
    return NextResponse.json({
      ok: true,
      deleted: 0,
      cutoff,
      note: 'no messages older than retention window',
    })
  }

  const messageIds = oldMessages.map(m => m.id)

  // 2. Collect attachment storage paths so we can delete them after
  //    the row delete cascades.
  const { data: atts } = await svc
    .from('message_attachments')
    .select('storage_path')
    .in('message_id', messageIds)
  const storagePaths = (atts || [])
    .map(a => a.storage_path)
    .filter(Boolean) as string[]

  // 3. Delete the message rows. message_attachments cascade via FK.
  const { error: delErr } = await svc
    .from('messages')
    .delete()
    .in('id', messageIds)
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  // 4. Best-effort delete the storage objects. Failure here orphans
  //    the storage objects but doesn't break user-visible state.
  let storageDeleted = 0
  let storageErrors = 0
  if (storagePaths.length > 0) {
    // Supabase remove() takes up to ~1000 paths per call. We're
    // bounded above by BATCH_LIMIT messages × ~5 attachments each
    // (max). One call should suffice.
    try {
      const { data: removed, error: rmErr } = await svc
        .storage
        .from('message-attachments')
        .remove(storagePaths)
      if (rmErr) {
        console.warn('[cleanup] storage remove error:', rmErr.message)
        storageErrors = storagePaths.length
      } else {
        storageDeleted = (removed || []).length
      }
    } catch (err: any) {
      console.warn('[cleanup] storage remove threw:', err?.message)
      storageErrors = storagePaths.length
    }
  }

  console.log('[cleanup-old-messages]', {
    cutoff,
    deletedMessages: messageIds.length,
    storageRequested: storagePaths.length,
    storageDeleted,
    storageErrors,
    capped: messageIds.length === BATCH_LIMIT,
  })

  return NextResponse.json({
    ok: true,
    cutoff,
    deletedMessages: messageIds.length,
    storageDeleted,
    storageErrors,
    capped: messageIds.length === BATCH_LIMIT,
  })
}
