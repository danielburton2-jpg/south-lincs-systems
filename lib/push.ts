/**
 * lib/push.ts
 *
 * Server-side helper for sending Web Push notifications.
 *
 * Reads VAPID keys from env, looks up active subscriptions for the
 * target user, and sends a push to each. Marks subscriptions inactive
 * when the browser returns 410 Gone (subscription revoked).
 *
 * Used from /api/notify-event/route.ts.
 */
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

let vapidConfigured = false
function ensureVapidConfigured() {
  if (vapidConfigured) return
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    throw new Error('VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in env.')
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  vapidConfigured = true
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export type PushPayload = {
  title: string
  body?: string
  url?: string
  tone?: 'info' | 'urgent'
  /** Optional tag — same tag replaces previous notification on phone */
  tag?: string
}

/**
 * Send a push to every active subscription belonging to a user.
 *
 * Returns the number of subscriptions successfully sent to.
 * Failures don't throw — callers should never have a "save defect →
 * push failed → defect not saved" cascade. The defect is already saved
 * by the time we get here.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<number> {
  try {
    ensureVapidConfigured()
  } catch (err) {
    console.warn('[push] not sending — VAPID not configured:', (err as Error).message)
    return 0
  }

  const svc = adminClient()
  const { data: subs, error } = await svc
    .from('push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key')
    .eq('user_id', userId)
    .eq('is_active', true)

  if (error) {
    console.warn('[push] could not load subscriptions:', error.message)
    return 0
  }
  if (!subs || subs.length === 0) {
    return 0
  }

  const body = JSON.stringify(payload)

  let sentCount = 0
  await Promise.all(subs.map(async (sub: any) => {
    const subscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh_key,
        auth: sub.auth_key,
      },
    }
    try {
      await webpush.sendNotification(subscription, body)
      sentCount += 1
      // Best-effort touch the last_used_at — don't await
      svc.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', sub.id).then()
    } catch (err: any) {
      const status = err?.statusCode
      if (status === 404 || status === 410) {
        // Subscription expired — mark inactive so we don't keep retrying
        await svc.from('push_subscriptions').update({ is_active: false }).eq('id', sub.id)
        console.log('[push] subscription gone, marked inactive:', sub.id)
      } else {
        console.warn('[push] send failed:', status, err?.body || err?.message)
      }
    }
  }))

  return sentCount
}
