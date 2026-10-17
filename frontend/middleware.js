import { NextResponse } from "next/server";
import { boundedBody, sameOrigin } from "./src/lib/request-security.mjs";
import { verifyAuthToken } from "./src/lib/auth";
export async function middleware(request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    try {
      await boundedBody(request.clone(), 64 * 1024);
    } catch {
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    }
  }
  // Middleware checks the signed claim using Web Crypto only. Every admin API
  // independently verifies current database role/revocation in its Node handler.
  const token = request.cookies.get("auth_token")?.value;
  let user;
  try {
    user = token ? await verifyAuthToken(token) : null;
  } catch {
    return NextResponse.json(
      { error: "Account verification is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (user?.isAdmin) {
    if (
      user.enrollmentOnly &&
      !request.nextUrl.pathname.startsWith("/admin/security")
    )
      return request.nextUrl.pathname.startsWith("/api/")
        ? NextResponse.json(
            { error: "Complete two-factor setup before using the workspace." },
            { status: 403 },
          )
        : NextResponse.redirect(new URL("/admin/security", request.url));
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/"))
    return NextResponse.json(
      { error: "Administrator sign in required" },
      { status: 401 },
    );
  return NextResponse.redirect(new URL("/admin/login", request.url));
}
export const config = {
  matcher: [
    "/admin/dashboard/:path*",
    "/admin/users/:path*",
    "/admin/testing/:path*",
    "/admin/security/:path*",
    "/api/admin/:path*",
  ],
};
