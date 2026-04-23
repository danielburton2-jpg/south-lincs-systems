import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'

export async function POST(request: Request) {
  try {
    const { user_id } = await request.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', user_id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const rpID = url.hostname

    const { data: existing } = await supabase
      .from('biometric_credentials')
      .select('credential_id')
      .eq('user_id', user_id)

    const options = await generateRegistrationOptions({
      rpName: 'South Lincs Systems',
      rpID,
      userName: profile.email,
      userDisplayName: profile.full_name || profile.email,
      attestationType: 'none',
      excludeCredentials: existing?.map((c) => ({
        id: c.credential_id,
        type: 'public-key' as const,
      })) || [],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
    })

    // Store challenge temporarily
    await supabase.from('biometric_credentials').upsert({
      user_id,
      credential_id: 'pending-' + user_id,
      public_key: options.challenge,
    }, { onConflict: 'credential_id' })

    return NextResponse.json(options)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}