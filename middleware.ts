import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const { pathname } = request.nextUrl

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // If not logged in, send to login page
  if (!user) {
    if (pathname.startsWith('/login')) return response
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Get the user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_frozen, is_deleted, company_id')
    .eq('id', user.id)
    .single()

  const role = profile?.role

  // If account is frozen or deleted, sign out and send to login
  if (profile?.is_frozen || profile?.is_deleted) {
    await supabase.auth.signOut()
    const url = new URL('/login', request.url)
    url.searchParams.set('error', 'frozen')
    return NextResponse.redirect(url)
  }

  // If company user, check company is active and not expired
  if (profile?.company_id && role !== 'superuser') {
    const { data: company } = await supabase
      .from('companies')
      .select('is_active, end_date, override_end_date')
      .eq('id', profile.company_id)
      .single()

    if (company) {
      const effectiveEnd = company.override_end_date || company.end_date
      const isExpired = effectiveEnd && new Date(effectiveEnd) < new Date()
      const isInactive = !company.is_active

      if (isExpired || isInactive) {
        await supabase.auth.signOut()
        const url = new URL('/login', request.url)
        url.searchParams.set('error', isExpired ? 'expired' : 'inactive')
        return NextResponse.redirect(url)
      }
    }
  }

  // If logged in and on login page, send to correct dashboard
  if (pathname.startsWith('/login')) {
    if (role === 'superuser') return NextResponse.redirect(new URL('/superuser', request.url))
    if (role === 'admin' || role === 'manager') return NextResponse.redirect(new URL('/dashboard', request.url))
    return NextResponse.redirect(new URL('/employee', request.url))
  }

  // Block wrong roles from accessing wrong areas
  if (pathname.startsWith('/superuser') && role !== 'superuser') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (pathname.startsWith('/dashboard') && role !== 'admin' && role !== 'manager') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (pathname.startsWith('/employee') && role !== 'user') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}