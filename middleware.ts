import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {

  const { pathname } = request.nextUrl;

  // ALWAYS allow login page
  if (pathname === "/login") {
    return NextResponse.next();
  }

  // allow next internal files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return NextResponse.next();
  }

  // check for Supabase cookies
  const accessToken = request.cookies.get("sb-access-token");
  const refreshToken = request.cookies.get("sb-refresh-token");

  if (!accessToken && !refreshToken) {

    const url = request.nextUrl.clone();
    url.pathname = "/login";

    return NextResponse.redirect(url);

  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};