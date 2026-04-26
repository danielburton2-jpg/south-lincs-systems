import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const {
      action,
      user_id,
      company_id,
      request_type,
      start_date,
      end_date,
      half_day_type,
      early_finish_time,
      reason,
      days_requested,
      request_id,
      reviewer_id,
      reviewer_email,
      reviewer_role,
      review_notes,
      // For admin_create
      target_user_id,
      // For adjust_balance
      adjustment_amount,
      adjustment_reason,
    } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // CREATE a new holiday request (employee self-service)
    if (action === 'create') {
      const { data, error } = await supabase
        .from('holiday_requests')
        .insert({
          user_id,
          company_id,
          request_type,
          start_date,
          end_date,
          half_day_type: half_day_type || null,
          early_finish_time: early_finish_time || null,
          reason: reason || null,
          days_requested: days_requested || 0,
          status: 'pending',
        })
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      const { data: profile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', user_id)
        .single()

      await logAudit({
        user_id,
        user_email: profile?.email,
        user_role: 'user',
        action: 'CREATE_HOLIDAY_REQUEST',
        entity: 'holiday_request',
        entity_id: data.id,
        details: { request_type, start_date, end_date, days_requested },
      })

      return NextResponse.json({ success: true, request: data })
    }

    // ADMIN_CREATE — admin/manager creates holiday for an employee, auto-approved
    if (action === 'admin_create') {
      // Insert as approved
      const { data, error } = await supabase
        .from('holiday_requests')
        .insert({
          user_id: target_user_id,
          company_id,
          request_type,
          start_date,
          end_date,
          half_day_type: half_day_type || null,
          early_finish_time: early_finish_time || null,
          reason: reason || null,
          days_requested: days_requested || 0,
          status: 'approved',
          reviewed_by: reviewer_id,
          reviewed_at: new Date().toISOString(),
          review_notes: review_notes || `Created by ${reviewer_role}`,
        })
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      // Deduct from balance for holiday type
      if (request_type === 'holiday' && days_requested > 0) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('holiday_entitlement')
          .eq('id', target_user_id)
          .single()

        const newBalance = (profile?.holiday_entitlement || 0) - days_requested
        await supabase
          .from('profiles')
          .update({ holiday_entitlement: newBalance })
          .eq('id', target_user_id)
      }

      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', target_user_id)
        .single()

      await logAudit({
        user_id: reviewer_id,
        user_email: reviewer_email,
        user_role: reviewer_role,
        action: 'ADMIN_CREATE_HOLIDAY',
        entity: 'holiday_request',
        entity_id: data.id,
        details: {
          target_user: targetProfile?.full_name,
          target_email: targetProfile?.email,
          request_type,
          start_date,
          end_date,
          days_requested,
        },
      })

      return NextResponse.json({ success: true, request: data })
    }

    // ADJUST_BALANCE — admin adjusts holiday entitlement
    if (action === 'adjust_balance') {
      // Only admins can do this
      if (reviewer_role !== 'admin') {
        return NextResponse.json({ error: 'Only admins can adjust balance' }, { status: 403 })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('holiday_entitlement, full_name, email')
        .eq('id', target_user_id)
        .single()

      if (!profile) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const oldBalance = profile.holiday_entitlement || 0
      const newBalance = oldBalance + Number(adjustment_amount)

      if (newBalance < 0) {
        return NextResponse.json({ error: 'Adjustment would result in negative balance' }, { status: 400 })
      }

      await supabase
        .from('profiles')
        .update({ holiday_entitlement: newBalance })
        .eq('id', target_user_id)

      await logAudit({
        user_id: reviewer_id,
        user_email: reviewer_email,
        user_role: reviewer_role,
        action: 'ADJUST_HOLIDAY_BALANCE',
        entity: 'profile',
        entity_id: target_user_id,
        details: {
          target_user: profile.full_name,
          target_email: profile.email,
          old_balance: oldBalance,
          new_balance: newBalance,
          adjustment: adjustment_amount,
          reason: adjustment_reason,
        },
      })

      return NextResponse.json({ success: true, old_balance: oldBalance, new_balance: newBalance })
    }

    // CANCEL a pending request (deletes it)
    if (action === 'cancel_pending') {
      const { error } = await supabase
        .from('holiday_requests')
        .update({ status: 'cancelled' })
        .eq('id', request_id)
        .eq('status', 'pending')

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id,
        action: 'CANCEL_PENDING_HOLIDAY',
        entity: 'holiday_request',
        entity_id: request_id,
      })

      return NextResponse.json({ success: true })
    }

    // REQUEST CANCELLATION of approved holiday
    if (action === 'request_cancel') {
      const { error } = await supabase
        .from('holiday_requests')
        .update({
          status: 'cancel_pending',
          cancel_requested_at: new Date().toISOString(),
        })
        .eq('id', request_id)
        .eq('status', 'approved')

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id,
        action: 'REQUEST_CANCEL_HOLIDAY',
        entity: 'holiday_request',
        entity_id: request_id,
      })

      return NextResponse.json({ success: true })
    }

    // APPROVE a holiday request
    if (action === 'approve') {
      const { data: req } = await supabase
        .from('holiday_requests')
        .select('*')
        .eq('id', request_id)
        .single()

      if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

      if (req.user_id === reviewer_id) {
        return NextResponse.json({ error: 'You cannot approve your own request' }, { status: 403 })
      }

      const { error } = await supabase
        .from('holiday_requests')
        .update({
          status: 'approved',
          reviewed_by: reviewer_id,
          reviewed_at: new Date().toISOString(),
          review_notes: review_notes || null,
        })
        .eq('id', request_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      if (req.request_type === 'holiday' && req.days_requested > 0) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('holiday_entitlement')
          .eq('id', req.user_id)
          .single()

        const newBalance = (profile?.holiday_entitlement || 0) - req.days_requested
        await supabase
          .from('profiles')
          .update({ holiday_entitlement: newBalance })
          .eq('id', req.user_id)
      }

      await logAudit({
        user_id: reviewer_id,
        user_email: reviewer_email,
        user_role: reviewer_role,
        action: 'APPROVE_HOLIDAY_REQUEST',
        entity: 'holiday_request',
        entity_id: request_id,
        details: { request_type: req.request_type, days_deducted: req.request_type === 'holiday' ? req.days_requested : 0 },
      })

      return NextResponse.json({ success: true })
    }

    // REJECT a holiday request
    if (action === 'reject') {
      const { data: req } = await supabase
        .from('holiday_requests')
        .select('user_id')
        .eq('id', request_id)
        .single()

      if (req?.user_id === reviewer_id) {
        return NextResponse.json({ error: 'You cannot reject your own request' }, { status: 403 })
      }

      const { error } = await supabase
        .from('holiday_requests')
        .update({
          status: 'rejected',
          reviewed_by: reviewer_id,
          reviewed_at: new Date().toISOString(),
          review_notes: review_notes || null,
        })
        .eq('id', request_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: reviewer_id,
        user_email: reviewer_email,
        user_role: reviewer_role,
        action: 'REJECT_HOLIDAY_REQUEST',
        entity: 'holiday_request',
        entity_id: request_id,
      })

      return NextResponse.json({ success: true })
    }

    // APPROVE CANCELLATION (refunds days)
    if (action === 'approve_cancel') {
      const { data: req } = await supabase
        .from('holiday_requests')
        .select('*')
        .eq('id', request_id)
        .single()

      if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

      if (req.user_id === reviewer_id) {
        return NextResponse.json({ error: 'You cannot approve your own cancellation' }, { status: 403 })
      }

      const { error } = await supabase
        .from('holiday_requests')
        .update({
          status: 'cancelled',
          cancel_reviewed_by: reviewer_id,
          cancel_reviewed_at: new Date().toISOString(),
        })
        .eq('id', request_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      if (req.request_type === 'holiday' && req.days_requested > 0) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('holiday_entitlement')
          .eq('id', req.user_id)
          .single()

        const newBalance = (profile?.holiday_entitlement || 0) + Number(req.days_requested)
        await supabase
          .from('profiles')
          .update({ holiday_entitlement: newBalance })
          .eq('id', req.user_id)
      }

      await logAudit({
        user_id: reviewer_id,
        user_email: reviewer_email,
        user_role: reviewer_role,
        action: 'APPROVE_HOLIDAY_CANCEL',
        entity: 'holiday_request',
        entity_id: request_id,
        details: { days_refunded: req.request_type === 'holiday' ? req.days_requested : 0 },
      })

      return NextResponse.json({ success: true })
    }

    // REJECT CANCELLATION (keep approved)
    if (action === 'reject_cancel') {
      const { error } = await supabase
        .from('holiday_requests')
        .update({
          status: 'approved',
          cancel_reviewed_by: reviewer_id,
          cancel_reviewed_at: new Date().toISOString(),
        })
        .eq('id', request_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        user_id: reviewer_id,
        user_email: reviewer_email,
        user_role: reviewer_role,
        action: 'REJECT_HOLIDAY_CANCEL',
        entity: 'holiday_request',
        entity_id: request_id,
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    console.error('Holiday request error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}