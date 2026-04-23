import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'

export async function POST(request: Request) {
  try {
    const { user_id, response } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: pending } = await supabase
      .from('biometric_credentials')
      .select('public_key')
      .eq('credential_id', 'auth-pending-' + user_id)
      .single()

    if (!pending) {
      return NextResponse.json({ error: 'No pending authentication' }, { status: 400 })
    }

    const { data: credential } = await supabase
      .from('biometric_credentials')
      .select('*')
      .eq('credential_id', response.id)
      .single()

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const rpID = url.hostname
    const origin = url.origin

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.public_key,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credential_id,
        publicKey: Buffer.from(credential.public_key, 'base64'),
        counter: Number(credential.counter),
      },
    })

    if (!verification.verified) {
      return NextResponse.json({ error: 'Authentication failed' }, { status: 400 })
    }

    // Update counter and last used
    await supabase
      .from('biometric_credentials')
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq('credential_id', response.id)

    // Delete pending challenge
    await supabase
      .from('biometric_credentials')
      .delete()
      .eq('credential_id', 'auth-pending-' + user_id)

    // Generate a magic link / session for this user
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', user_id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate sign-in link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email,
    })

    if (linkError || !linkData) {
      return NextResponse.json({ error: 'Failed to generate session' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      action_link: linkData.properties.action_link,
      email: profile.email,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}