import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const {
      user_id,
      user_email,
      user_role,
      action,
      entity,
      entity_id,
      details,
    } = await request.json()

    await logAudit({
      user_id,
      user_email,
      user_role,
      action,
      entity,
      entity_id,
      details,
      ip_address: request.headers.get('x-forwarded-for') || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}