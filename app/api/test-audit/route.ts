import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/test-audit
 *
 * Triggers a single audit insert and reports success/failure to the
 * caller. Watch your terminal for [audit] log lines.
 *
 * Visit http://localhost:3000/api/test-audit in your browser to run.
 */
export async function GET() {
  console.log('[test-audit] endpoint hit')

  await logAudit({
    user_email: 'test@diagnostic',
    user_role: 'diagnostic',
    action: 'TEST_AUDIT',
    entity: 'test',
    entity_id: 'manual-test-' + Date.now(),
    details: { source: 'test-audit endpoint' },
  })

  return NextResponse.json({
    ok: true,
    message: 'Check your terminal for [audit] log lines, then check audit_logs in Supabase.',
  })
}
