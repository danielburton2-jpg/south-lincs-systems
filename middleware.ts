import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Auth middleware.
 *
 * Subscription rule: a company user (non-superuser) can only access the
 * app if their company has a valid subscription end. The "effective end"
 * is whichever of:
 *   • override_end_date (if set, takes priority)
 *   • end_date          (calculated from start + length when the company
 *                        was created or last edited)
 *
 * If neither is set → blocked. If the effective end is today or in the
 * past → blocked. (Today counts as expired so a 1-year sub starting
 * Jan 1 ends Jan 1 next year — the user can use it through Dec 31 only.)
 *
 * Superusers are not company-bound and therefore never expire.
 */

const PUBLIC_API_ROUTES = ['/api/audit']

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const { pathname } = request.nextUrl

  if (PUBLIC_API_ROUTES.some(p => pathname.startsWith(p))) {
    return response
  }

  // /signup is no longer present (deleted), so only /login is auth-free
  const isAuthFreePath = pathname === '/login'

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    if (isAuthFreePath) return response
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_frozen, is_deleted, company_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    await supabase.auth.signOut()
    const url = new URL('/login', request.url)
    url.searchParams.set('error', 'noprofile')
    return NextResponse.redirect(url)
  }

  if (profile.is_frozen || profile.is_deleted) {
    await supabase.auth.signOut()
    const url = new URL('/login', request.url)
    url.searchParams.set('error', 'frozen')
    return NextResponse.redirect(url)
  }

  // Company subscription check (non-superusers only)
  if (profile.company_id && profile.role !== 'superuser') {
    const { data: company } = await supabase
      .from('companies')
      .select('is_active, end_date, override_end_date')
      .eq('id', profile.company_id)
      .single()

    if (company) {
      // Inactive blocks immediately
      if (!company.is_active) {
        await supabase.auth.signOut()
        const url = new URL('/login', request.url)
        url.searchParams.set('error', 'inactive')
        return NextResponse.redirect(url)
      }

      // Effective end: override wins, otherwise the calculated end.
      // If neither is set → blocked.
      const effectiveEnd = company.override_end_date || company.end_date
      if (!effectiveEnd) {
        await supabase.auth.signOut()
        const url = new URL('/login', request.url)
        url.searchParams.set('error', 'expired')
        return NextResponse.redirect(url)
      }

      // Compare against today at midnight (so "ends today" still allows today)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const end = new Date(effectiveEnd)
      end.setHours(0, 0, 0, 0)
      if (end < today) {
        await supabase.auth.signOut()
        const url = new URL('/login', request.url)
        url.searchParams.set('error', 'expired')
        return NextResponse.redirect(url)
      }
    } else {
      // Profile says they're in a company that doesn't exist — block
      await supabase.auth.signOut()
      const url = new URL('/login', request.url)
      url.searchParams.set('error', 'inactive')
      return NextResponse.redirect(url)
    }
  }

  const role = profile.role

  if (isAuthFreePath) {
    if (role === 'superuser') return NextResponse.redirect(new URL('/superuser', request.url))
    if (role === 'admin' || role === 'manager') return NextResponse.redirect(new URL('/dashboard', request.url))
    return NextResponse.redirect(new URL('/employee', request.url))
  }

  if (pathname.startsWith('/superuser') && role !== 'superuser') {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (pathname.startsWith('/dashboard') && role !== 'admin' && role !== 'manager') {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (pathname.startsWith('/employee') && role === 'superuser') {
    return NextResponse.redirect(new URL('/superuser', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
