import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'

export async function POST(request: Request) {
  try {
    const { email } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { data: credentials } = await supabase
      .from('biometric_credentials')
      .select('credential_id')
      .eq('user_id', profile.id)
      .neq('credential_id', 'pending-' + profile.id)

    if (!credentials || credentials.length === 0) {
      return NextResponse.json({ error: 'No biometric credentials found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const rpID = url.hostname

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map((c) => ({
        id: c.credential_id,
        type: 'public-key' as const,
      })),
      userVerification: 'required',
    })

    // Store challenge for verification
    await supabase.from('biometric_credentials').upsert({
      user_id: profile.id,
      credential_id: 'auth-pending-' + profile.id,
      public_key: options.challenge,
    }, { onConflict: 'credential_id' })

    return NextResponse.json({ ...options, user_id: profile.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}