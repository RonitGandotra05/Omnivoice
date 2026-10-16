import { NextResponse } from "next/server";
import { boundedBody, sameOrigin } from "./src/lib/request-security.mjs";
import { verifyAdminSession } from "./src/lib/admin-session";
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
  const token = request.cookies.get("auth_token")?.value;
  let user;
  try {
    user = token ? await verifyAdminSession(token) : null;
  } catch {
    return NextResponse.json(
      { error: "Account verification is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (user?.isAdmin) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/"))
    return NextResponse.json(
      { error: "Administrator sign in required" },
      { status: 401 },
    );
  return NextResponse.redirect(new URL("/admin/login", request.url));
}
export const config = {
  runtime: "nodejs",
  matcher: [
    "/admin/dashboard/:path*",
    "/admin/users/:path*",
    "/admin/testing/:path*",
    "/api/admin/:path*",
  ],
};
