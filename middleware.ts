import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {

  const { pathname } = request.nextUrl;

  // allow login page
  if (pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  // allow static files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/images")
  ) {
    return NextResponse.next();
  }

  // check for Supabase auth cookies
  const accessToken = request.cookies.get("sb-access-token");
  const refreshToken = request.cookies.get("sb-refresh-token");

  // if no session redirect to login
  if (!accessToken && !refreshToken) {

    const loginUrl = new URL("/login", request.url);

    return NextResponse.redirect(loginUrl);

  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};