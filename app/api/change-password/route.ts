import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const {
      action,           // 'admin_change' or 'self_change'
      target_user_id,   // user whose password is being changed
      new_password,
      current_password, // only for self_change
      actor_id,         // who is making the change
      actor_email,
      actor_role,
    } = await request.json()

    // Validate basic input
    if (!new_password || new_password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // ADMIN CHANGES SOMEONE ELSE'S PASSWORD
    if (action === 'admin_change') {
      if (actor_role !== 'admin' && actor_role !== 'superuser') {
        return NextResponse.json({ error: 'Only admins can change other users\' passwords' }, { status: 403 })
      }

      // Get target user info
      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('email, full_name, company_id, role')
        .eq('id', target_user_id)
        .single()

      if (!targetProfile) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      // If actor is admin, ensure target is in same company
      if (actor_role === 'admin') {
        const { data: actorProfile } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', actor_id)
          .single()

        if (actorProfile?.company_id !== targetProfile.company_id) {
          return NextResponse.json({ error: 'You can only change passwords for users in your company' }, { status: 403 })
        }

        // Admins cannot change superuser passwords
        if (targetProfile.role === 'superuser') {
          return NextResponse.json({ error: 'You cannot change a superuser\'s password' }, { status: 403 })
        }
      }

      // Update the password using service role
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        target_user_id,
        { password: new_password }
      )

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 })
      }

      await logAudit({
        user_id: actor_id,
        user_email: actor_email,
        user_role: actor_role,
        action: 'CHANGE_USER_PASSWORD',
        entity: 'profile',
        entity_id: target_user_id,
        details: {
          target_user: targetProfile.full_name,
          target_email: targetProfile.email,
        },
      })

      return NextResponse.json({ success: true })
    }

    // USER CHANGES THEIR OWN PASSWORD
    if (action === 'self_change') {
      if (!current_password) {
        return NextResponse.json({ error: 'Current password is required' }, { status: 400 })
      }

      // Get target user
      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', target_user_id)
        .single()

      if (!targetProfile) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      // Verify current password by attempting to sign in
      const verifyClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      const { error: signInError } = await verifyClient.auth.signInWithPassword({
        email: targetProfile.email,
        password: current_password,
      })

      if (signInError) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
      }

      // Sign out the verification session immediately
      await verifyClient.auth.signOut()

      // Update password using service role
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        target_user_id,
        { password: new_password }
      )

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 })
      }

      await logAudit({
        user_id: target_user_id,
        user_email: targetProfile.email,
        user_role: actor_role,
        action: 'CHANGE_OWN_PASSWORD',
        entity: 'profile',
        entity_id: target_user_id,
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    console.error('Change password error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}