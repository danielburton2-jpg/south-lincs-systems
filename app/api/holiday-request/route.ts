import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit, getActorFields } from '@/lib/audit'
import { holidayYearForDate, isCurrentHolidayYear } from '@/lib/holidayYear'

/**
 * POST /api/holiday-request
 *
 * Multi-action endpoint:
 *   action='create'           — employee submits a request
 *   action='cancel_pending'   — employee cancels their own pending request
 *   action='request_cancel'   — employee asks to cancel an approved request
 *   action='approve'          — admin approves a pending request
 *   action='reject'           — admin rejects a pending request
 *   action='approve_cancel'   — admin approves a cancellation request
 *   action='reject_cancel'    — admin rejects a cancellation request
 *   action='admin_create'     — ADMIN: book a holiday for someone, auto-approved
 *   action='adjust_balance'   — ADMIN: directly add/subtract days, with reason
 *
 * Balance behaviour:
 *   • CREATE never deducts balance (only approval does)
 *   • APPROVE deducts only if the request falls in the CURRENT holiday year
 *     and the request_type is 'holiday' (early_finish/keep_day_off don't deduct)
 *   • REJECT never touches balance
 *   • APPROVE_CANCEL refunds balance ONLY if it was deducted
 *   • REJECT_CANCEL just flips status back to approved, no balance change
 *   • ADMIN_CREATE creates a request already in 'approved' state. Same balance
 *     rule applies — current year holiday types deduct, next year don't.
 *   • ADJUST_BALANCE writes directly to profile.holiday_entitlement and
 *     records a balance_adjustments row.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action } = body

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    if (action === 'create')          return await handleCreate(supabase, body, request)
    if (action === 'cancel_pending')  return await handleCancelPending(supabase, body, request)
    if (action === 'request_cancel')  return await handleRequestCancel(supabase, body, request)
    if (action === 'approve')         return await handleApprove(supabase, body, request)
    if (action === 'reject')          return await handleReject(supabase, body, request)
    if (action === 'approve_cancel')  return await handleApproveCancel(supabase, body, request)
    if (action === 'reject_cancel')   return await handleRejectCancel(supabase, body, request)
    if (action === 'admin_create')    return await handleAdminCreate(supabase, body, request)
    if (action === 'adjust_balance')  return await handleAdjustBalance(supabase, body, request)

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    console.error('holiday-request error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}

// ─── action handlers ────────────────────────────────────────────────

async function handleCreate(supabase: any, body: any, req: Request) {
  const {
    user_id, company_id, request_type, start_date, end_date,
    half_day_type, early_finish_time, reason, days_requested,
  } = body

  if (!user_id || !company_id || !request_type || !start_date) {
    return NextResponse.json({ error: 'user_id, company_id, request_type and start_date required' }, { status: 400 })
  }

  const { data: company } = await supabase
    .from('companies')
    .select('holiday_year_start')
    .eq('id', company_id)
    .single()

  const yr = holidayYearForDate(start_date, company?.holiday_year_start)
  const isCurrent = isCurrentHolidayYear(start_date, company?.holiday_year_start)

  const { data: created, error } = await supabase
    .from('holiday_requests')
    .insert({
      company_id, user_id, request_type,
      start_date,
      end_date: end_date || start_date,
      half_day_type: half_day_type || null,
      early_finish_time: early_finish_time || null,
      days_requested: typeof days_requested === 'number' ? days_requested : 0,
      reason: reason || null,
      holiday_year_label: yr.label,
      is_current_year: isCurrent,
      status: 'pending',
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    ...(await getActorFields(user_id)),
    action: 'CREATE_HOLIDAY_REQUEST',
    entity: 'holiday_request', entity_id: created.id,
    details: { request_type, start_date, end_date, days_requested, holiday_year_label: yr.label, is_current_year: isCurrent },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ request: created })
}

async function handleCancelPending(supabase: any, body: any, req: Request) {
  const { request_id, user_id } = body
  if (!request_id || !user_id) return NextResponse.json({ error: 'request_id and user_id required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('holiday_requests')
    .select('id, user_id, status').eq('id', request_id).single()
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.user_id !== user_id) return NextResponse.json({ error: 'Not your request' }, { status: 403 })
  if (existing.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending requests can be cancelled directly' }, { status: 400 })
  }

  const { error } = await supabase
    .from('holiday_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', request_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    ...(await getActorFields(user_id)),
    action: 'CANCEL_PENDING_HOLIDAY',
    entity: 'holiday_request', entity_id: request_id,
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ success: true })
}

async function handleRequestCancel(supabase: any, body: any, req: Request) {
  const { request_id, user_id } = body
  if (!request_id || !user_id) return NextResponse.json({ error: 'request_id and user_id required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('holiday_requests')
    .select('id, user_id, status').eq('id', request_id).single()
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.user_id !== user_id) return NextResponse.json({ error: 'Not your request' }, { status: 403 })
  if (existing.status !== 'approved') {
    return NextResponse.json({ error: 'Only approved requests can have a cancellation requested' }, { status: 400 })
  }

  const { error } = await supabase
    .from('holiday_requests')
    .update({ status: 'cancel_pending', updated_at: new Date().toISOString() })
    .eq('id', request_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    ...(await getActorFields(user_id)),
    action: 'REQUEST_CANCEL_HOLIDAY',
    entity: 'holiday_request', entity_id: request_id,
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ success: true })
}

async function handleApprove(supabase: any, body: any, req: Request) {
  const { request_id, reviewer_id, reviewer_email, reviewer_role, review_notes } = body
  if (!request_id || !reviewer_id) return NextResponse.json({ error: 'request_id and reviewer_id required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('holiday_requests').select('*').eq('id', request_id).single()
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be approved' }, { status: 400 })
  if (existing.user_id === reviewer_id) return NextResponse.json({ error: 'You cannot approve your own request' }, { status: 400 })

  const shouldDeduct = existing.request_type === 'holiday' && existing.is_current_year
  let newBalance: number | null = null

  if (shouldDeduct) {
    const { data: profile } = await supabase
      .from('profiles').select('holiday_entitlement').eq('id', existing.user_id).single()
    const before = Number(profile?.holiday_entitlement || 0)
    const after = before - Number(existing.days_requested || 0)
    newBalance = after
    const { error: balErr } = await supabase
      .from('profiles').update({ holiday_entitlement: after }).eq('id', existing.user_id)
    if (balErr) return NextResponse.json({ error: balErr.message }, { status: 400 })
  }

  const { error: updErr } = await supabase
    .from('holiday_requests')
    .update({
      status: 'approved', reviewed_by: reviewer_id, reviewed_at: new Date().toISOString(),
      review_notes: review_notes || null, updated_at: new Date().toISOString(),
    })
    .eq('id', request_id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  await logAudit({
    user_id: reviewer_id, user_email: reviewer_email, user_role: reviewer_role,
    action: 'APPROVE_HOLIDAY_REQUEST',
    entity: 'holiday_request', entity_id: request_id,
    details: { target_user_id: existing.user_id, days_requested: existing.days_requested, deducted_from_balance: shouldDeduct, new_balance: newBalance, is_current_year: existing.is_current_year },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ success: true, deducted: shouldDeduct, new_balance: newBalance })
}

async function handleReject(supabase: any, body: any, req: Request) {
  const { request_id, reviewer_id, reviewer_email, reviewer_role, review_notes } = body
  if (!request_id || !reviewer_id) return NextResponse.json({ error: 'request_id and reviewer_id required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('holiday_requests').select('user_id, status').eq('id', request_id).single()
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be rejected' }, { status: 400 })
  if (existing.user_id === reviewer_id) return NextResponse.json({ error: 'You cannot reject your own request' }, { status: 400 })

  const { error } = await supabase
    .from('holiday_requests')
    .update({
      status: 'rejected', reviewed_by: reviewer_id, reviewed_at: new Date().toISOString(),
      review_notes: review_notes || null, updated_at: new Date().toISOString(),
    })
    .eq('id', request_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    user_id: reviewer_id, user_email: reviewer_email, user_role: reviewer_role,
    action: 'REJECT_HOLIDAY_REQUEST',
    entity: 'holiday_request', entity_id: request_id,
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ success: true })
}

async function handleApproveCancel(supabase: any, body: any, req: Request) {
  const { request_id, reviewer_id, reviewer_email, reviewer_role, review_notes } = body

  const { data: existing } = await supabase
    .from('holiday_requests').select('*').eq('id', request_id).single()
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.status !== 'cancel_pending') {
    return NextResponse.json({ error: 'Not in cancel_pending state' }, { status: 400 })
  }

  const shouldRefund = existing.request_type === 'holiday' && existing.is_current_year

  if (shouldRefund) {
    const { data: profile } = await supabase
      .from('profiles').select('holiday_entitlement').eq('id', existing.user_id).single()
    const before = Number(profile?.holiday_entitlement || 0)
    const after = before + Number(existing.days_requested || 0)
    const { error: balErr } = await supabase
      .from('profiles').update({ holiday_entitlement: after }).eq('id', existing.user_id)
    if (balErr) return NextResponse.json({ error: balErr.message }, { status: 400 })
  }

  const { error } = await supabase
    .from('holiday_requests')
    .update({
      status: 'cancelled', reviewed_by: reviewer_id, reviewed_at: new Date().toISOString(),
      review_notes: review_notes || null, updated_at: new Date().toISOString(),
    })
    .eq('id', request_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    user_id: reviewer_id, user_email: reviewer_email, user_role: reviewer_role,
    action: 'APPROVE_CANCEL_HOLIDAY',
    entity: 'holiday_request', entity_id: request_id,
    details: { refunded: shouldRefund, days_requested: existing.days_requested },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ success: true, refunded: shouldRefund })
}

async function handleRejectCancel(supabase: any, body: any, req: Request) {
  const { request_id, reviewer_id, reviewer_email, reviewer_role, review_notes } = body

  const { data: existing } = await supabase
    .from('holiday_requests').select('status').eq('id', request_id).single()
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.status !== 'cancel_pending') {
    return NextResponse.json({ error: 'Not in cancel_pending state' }, { status: 400 })
  }

  const { error } = await supabase
    .from('holiday_requests')
    .update({
      status: 'approved', reviewed_by: reviewer_id, reviewed_at: new Date().toISOString(),
      review_notes: review_notes || null, updated_at: new Date().toISOString(),
    })
    .eq('id', request_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAudit({
    user_id: reviewer_id, user_email: reviewer_email, user_role: reviewer_role,
    action: 'REJECT_CANCEL_HOLIDAY',
    entity: 'holiday_request', entity_id: request_id,
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ success: true })
}

/**
 * ADMIN_CREATE — admin books a holiday for someone, auto-approved.
 * Same balance rule as approve: deducts only if current year + holiday type.
 */
async function handleAdminCreate(supabase: any, body: any, req: Request) {
  const {
    target_user_id, company_id, request_type, start_date, end_date,
    half_day_type, early_finish_time, reason, days_requested,
    reviewer_id, reviewer_email, reviewer_role, review_notes,
  } = body

  if (!target_user_id || !company_id || !request_type || !start_date || !reviewer_id) {
    return NextResponse.json({ error: 'target_user_id, company_id, request_type, start_date and reviewer_id required' }, { status: 400 })
  }
  if (target_user_id === reviewer_id) {
    return NextResponse.json({ error: 'Use the My Holidays tab to book your own time off' }, { status: 400 })
  }

  const { data: company } = await supabase
    .from('companies').select('holiday_year_start').eq('id', company_id).single()
  const yr = holidayYearForDate(start_date, company?.holiday_year_start)
  const isCurrent = isCurrentHolidayYear(start_date, company?.holiday_year_start)
  const shouldDeduct = request_type === 'holiday' && isCurrent

  // Insert as already-approved
  const { data: created, error: insErr } = await supabase
    .from('holiday_requests')
    .insert({
      company_id, user_id: target_user_id, request_type,
      start_date,
      end_date: end_date || start_date,
      half_day_type: half_day_type || null,
      early_finish_time: early_finish_time || null,
      days_requested: typeof days_requested === 'number' ? days_requested : 0,
      reason: reason || null,
      holiday_year_label: yr.label,
      is_current_year: isCurrent,
      status: 'approved',
      reviewed_by: reviewer_id,
      reviewed_at: new Date().toISOString(),
      review_notes: review_notes || `Created by admin`,
    })
    .select()
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })

  // Deduct balance if applicable
  let newBalance: number | null = null
  if (shouldDeduct) {
    const { data: profile } = await supabase
      .from('profiles').select('holiday_entitlement').eq('id', target_user_id).single()
    const before = Number(profile?.holiday_entitlement || 0)
    const after = before - Number(days_requested || 0)
    newBalance = after
    const { error: balErr } = await supabase
      .from('profiles').update({ holiday_entitlement: after }).eq('id', target_user_id)
    if (balErr) return NextResponse.json({ error: balErr.message }, { status: 400 })
  }

  await logAudit({
    user_id: reviewer_id, user_email: reviewer_email, user_role: reviewer_role,
    action: 'ADMIN_CREATE_HOLIDAY',
    entity: 'holiday_request', entity_id: created.id,
    details: { target_user_id, request_type, start_date, end_date, days_requested, deducted_from_balance: shouldDeduct, new_balance: newBalance, is_current_year: isCurrent },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ success: true, request: created, deducted: shouldDeduct, new_balance: newBalance })
}

/**
 * ADJUST_BALANCE — admin add/subtract days with a reason.
 * Writes to balance_adjustments + updates profile.holiday_entitlement.
 */
async function handleAdjustBalance(supabase: any, body: any, req: Request) {
  const { target_user_id, adjustment_amount, adjustment_reason, reviewer_id, reviewer_email, reviewer_role } = body

  if (!target_user_id || adjustment_amount === undefined || !adjustment_reason || !reviewer_id) {
    return NextResponse.json({ error: 'target_user_id, adjustment_amount, adjustment_reason and reviewer_id required' }, { status: 400 })
  }
  const amt = Number(adjustment_amount)
  if (!Number.isFinite(amt) || amt === 0) {
    return NextResponse.json({ error: 'adjustment_amount must be a non-zero number' }, { status: 400 })
  }

  // Get current balance + company id (for the adjustment row)
  const { data: profile } = await supabase
    .from('profiles')
    .select('holiday_entitlement, company_id')
    .eq('id', target_user_id)
    .single()
  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const before = Number(profile.holiday_entitlement || 0)
  const after = before + amt

  // Update the balance
  const { error: updErr } = await supabase
    .from('profiles').update({ holiday_entitlement: after }).eq('id', target_user_id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  // Log the adjustment
  const { error: logErr } = await supabase
    .from('balance_adjustments').insert({
      company_id: profile.company_id,
      user_id: target_user_id,
      adjusted_by: reviewer_id,
      adjustment: amt,
      reason: adjustment_reason,
      balance_before: before,
      balance_after: after,
    })
  if (logErr) console.error('balance_adjustments insert failed:', logErr)

  await logAudit({
    user_id: reviewer_id, user_email: reviewer_email, user_role: reviewer_role,
    action: 'ADJUST_HOLIDAY_BALANCE',
    entity: 'profile', entity_id: target_user_id,
    details: { adjustment: amt, reason: adjustment_reason, balance_before: before, balance_after: after },
    ip_address: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.json({ success: true, balance_before: before, balance_after: after })
}
