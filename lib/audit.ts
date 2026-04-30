/**
 * Audit logging helper.
 *
 * Server-side helper that writes to public.audit_logs using the
 * service role key (bypasses RLS).
 *
 * Verbose mode for now — every call logs to the terminal so we can
 * confirm audit is firing. Once trust is established that audit is
 * working, the [audit] log lines can be quieted.
 */

import { createClient } from '@supabase/supabase-js'

type AuditPayload = {
  user_id?: string
  user_email?: string
  user_role?: string
  action: string
  entity?: string
  entity_id?: string
  details?: Record<string, any>
  ip_address?: string
}

let cached: ReturnType<typeof createClient> | null = null
function svc() {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('[audit] MISSING ENV VARS — URL:', !!url, 'key:', !!key)
  }
  cached = createClient(url!, key!)
  return cached
}

export async function logAudit(p: AuditPayload): Promise<void> {
  console.log('[audit]', p.action, '— entity:', p.entity ?? '-', 'user:', p.user_email ?? '-')
  try {
    const result = await svc().from('audit_logs').insert({
      user_id: p.user_id ?? null,
      user_email: p.user_email ?? null,
      user_role: p.user_role ?? null,
      action: p.action,
      entity: p.entity ?? null,
      entity_id: p.entity_id ?? null,
      details: p.details ?? null,
      ip_address: p.ip_address ?? null,
    })
    if (result.error) {
      console.error('[audit] INSERT FAILED:', result.error.message)
    }
  } catch (err) {
    console.error('[audit] EXCEPTION:', err)
  }
}
