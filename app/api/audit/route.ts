import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/audit
 *
 * Used by client pages to record an audit event. Body shape matches
 * the AuditPayload in lib/audit.ts. This route is in the middleware's
 * PUBLIC_API_ROUTES list so it doesn't require auth — but the caller
 * is expected to be authed; the middleware just doesn't gate it
 * because writing audit events shouldn't 401 (we want to record
 * even half-broken sessions).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    await logAudit({
      user_id: body.user_id,
      user_email: body.user_email,
      user_role: body.user_role,
      action: body.action,
      entity: body.entity,
      entity_id: body.entity_id,
      details: body.details,
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('audit api error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
