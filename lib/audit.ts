/**
 * Audit logging helper.
 *
 * Server-side helper that writes to public.audit_logs using the
 * service role key (bypasses RLS).
 *
 * Verbose mode for now — every call logs to the terminal so we can
 * confirm audit is firing. Once trust is established that audit is
 * working, the [audit] log lines can be quieted.
 *
 * NOTE on types: Supabase's TS client types tables as `never` when no
 * generated database types are configured. Without that, .insert() on
 * any table fails type-checking. We pin a local row type and cast the
 * client through `any` so this single helper compiles cleanly. If/when
 * we generate full DB types via `supabase gen types`, this can revert
 * to a fully-typed call.
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

// Shape of an audit_logs row insert. Matches the table schema.
type AuditLogRow = {
  user_id: string | null
  user_email: string | null
  user_role: string | null
  action: string
  entity: string | null
  entity_id: string | null
  details: Record<string, any> | null
  ip_address: string | null
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
    const row: AuditLogRow = {
      user_id: p.user_id ?? null,
      user_email: p.user_email ?? null,
      user_role: p.user_role ?? null,
      action: p.action,
      entity: p.entity ?? null,
      entity_id: p.entity_id ?? null,
      details: p.details ?? null,
      ip_address: p.ip_address ?? null,
    }
    // Cast through `any` because the Supabase client has no generated
    // schema types here — without that, every `.from()` returns `never`
    // and `.insert()` fails type-checking.
    const result = await (svc().from('audit_logs') as any).insert(row)
    if (result.error) {
      console.error('[audit] INSERT FAILED:', result.error.message)
    }
  } catch (err) {
    console.error('[audit] EXCEPTION:', err)
  }
}

/**
 * Look up an actor's email + role for audit purposes.
 *
 * Returns the three fields ready to spread into a `logAudit({...})`
 * call: `{ user_id, user_email, user_role }`. Uses the service-role
 * client (bypasses RLS) so it works regardless of the caller's auth
 * context.
 *
 * If `userId` is null/undefined, returns an empty object — safe to
 * spread, just produces no actor info. If the profile lookup fails
 * for any reason, returns at least `{ user_id }` so the actor's id
 * is still recorded even when their profile can't be read.
 *
 * Use this in API routes that already know the caller's id (from
 * `supabase.auth.getUser()`) but don't otherwise need to load the
 * profile. Avoids the audit row ending up with null user_email and
 * user_role columns, which makes the /superuser/audit viewer harder
 * to use.
 *
 * Usage:
 *   const { data: { user } } = await supabase.auth.getUser()
 *   const actor = await getActorFields(user?.id)
 *   await logAudit({
 *     ...actor,
 *     action: 'CREATE_THING',
 *     entity: 'thing',
 *     details: { ... },
 *   })
 */
export async function getActorFields(
  userId: string | null | undefined,
): Promise<{ user_id?: string; user_email?: string; user_role?: string }> {
  if (!userId) return {}
  try {
    const { data: profile } = await (svc().from('profiles') as any)
      .select('email, role')
      .eq('id', userId)
      .single()
    return {
      user_id: userId,
      user_email: profile?.email || undefined,
      user_role: profile?.role || undefined,
    }
  } catch {
    return { user_id: userId }
  }
}
