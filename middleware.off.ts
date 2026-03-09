import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest){

const session = request.cookies.get("session")

const { pathname } = request.nextUrl

// allow login page
if(pathname === "/login"){
return NextResponse.next()
}

// allow next internal files
if(pathname.startsWith("/_next")){
return NextResponse.next()
}

// allow static files
if(pathname.startsWith("/favicon")){
return NextResponse.next()
}

// protect dev pages
if(pathname.startsWith("/dev")){
if(!session){
return NextResponse.redirect(new URL("/login",request.url))
}
}

// protect company pages
if(pathname.startsWith("/company")){
if(!session){
return NextResponse.redirect(new URL("/login",request.url))
}
}

return NextResponse.next()

}

export const config = {
matcher:[
"/dev/:path*",
"/company/:path*"
]
}
