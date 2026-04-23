import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'

export async function POST(request: Request) {
  try {
    const { user_id, response, device_name } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Get the stored challenge
    const { data: pending } = await supabase
      .from('biometric_credentials')
      .select('public_key')
      .eq('credential_id', 'pending-' + user_id)
      .single()

    if (!pending) {
      return NextResponse.json({ error: 'No pending registration' }, { status: 400 })
    }

    const url = new URL(request.url)
    const rpID = url.hostname
    const origin = url.origin

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.public_key,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
    }

    const { credential } = verification.registrationInfo

    // Delete the pending entry
    await supabase
      .from('biometric_credentials')
      .delete()
      .eq('credential_id', 'pending-' + user_id)

    // Save the real credential
    await supabase.from('biometric_credentials').insert({
      user_id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      device_name: device_name || 'My Device',
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}