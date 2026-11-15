import { NextResponse, type NextRequest } from "next/server";

// Next 16's renamed middleware. Runs before routes in both server modes.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/proxy-redirect") {
    return NextResponse.redirect(new URL("/static", request.url));
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-from-proxy", "1");
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-proxy", "hit");
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|test.png).*)"],
};
