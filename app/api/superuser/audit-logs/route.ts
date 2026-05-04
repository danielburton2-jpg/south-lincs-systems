import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * GET /api/superuser/audit-logs
 *
 * Query params (all optional):
 *   from        ISO date — only events on/after this date (>= 00:00 UTC)
 *   to          ISO date — only events on/before this date (<= 23:59 UTC)
 *   actor       substring of user_email (case-insensitive)
 *   action      exact action verb (e.g. "CREATE_USER")
 *   entity      exact entity type (e.g. "profile")
 *   before      ISO timestamp — return events strictly older than this.
 *               Used as the cursor for "Older →" pagination.
 *   limit       max rows to return (default 100, capped at 500)
 *
 * Returns:
 *   { rows: AuditLogRow[], next_cursor: string | null }
 *
 *   next_cursor is the created_at of the last (oldest) row in the
 *   batch — pass it as `before` on the next call to page back. Null
 *   when there are no more rows.
 *
 * Service-role read. Doesn't enforce caller authz here — the
 * /superuser/* layout already gates the page client-side. If you
 * ever harden this, add a "caller must be superuser" check to match
 * the rest of the /api/superuser/* routes you might add later.
 */

type AuditLogRow = {
  id: number
  user_id: string | null
  user_email: string | null
  user_role: string | null
  action: string
  entity: string | null
  entity_id: string | null
  details: Record<string, any> | null
  ip_address: string | null
  created_at: string
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const actor = (searchParams.get('actor') || '').trim()
    const action = (searchParams.get('action') || '').trim()
    const entity = (searchParams.get('entity') || '').trim()
    const before = searchParams.get('before') || ''

    let limit = parseInt(searchParams.get('limit') || '', 10)
    if (!limit || limit <= 0) limit = DEFAULT_LIMIT
    if (limit > MAX_LIMIT) limit = MAX_LIMIT

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    let query = supabase
      .from('audit_logs')
      .select('id, user_id, user_email, user_role, action, entity, entity_id, details, ip_address, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    // Date filters. We accept date-only strings (YYYY-MM-DD) and
    // expand them to full timestamps so a user picking "from 2026-05-04"
    // gets the whole of May 4, not just events at exactly midnight.
    if (from) {
      const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(from)
        ? `${from}T00:00:00Z`
        : from
      query = query.gte('created_at', fromIso)
    }
    if (to) {
      const toIso = /^\d{4}-\d{2}-\d{2}$/.test(to)
        ? `${to}T23:59:59.999Z`
        : to
      query = query.lte('created_at', toIso)
    }

    if (actor) {
      query = query.ilike('user_email', `%${actor}%`)
    }
    if (action) {
      query = query.eq('action', action)
    }
    if (entity) {
      query = query.eq('entity', entity)
    }

    // Cursor pagination — fetch rows strictly older than the cursor.
    // (We use < not <= so the row at the cursor itself isn't repeated.)
    if (before) {
      query = query.lt('created_at', before)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const rows = (data || []) as AuditLogRow[]
    // Next cursor: if we got a full page, there might be more — set it
    // to the oldest row's timestamp. If we got fewer, no more rows.
    const next_cursor = rows.length === limit && rows.length > 0
      ? rows[rows.length - 1].created_at
      : null

    return NextResponse.json({ rows, next_cursor })
  } catch (err: any) {
    console.error('audit-logs GET error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
