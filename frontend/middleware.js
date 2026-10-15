import { NextResponse } from "next/server";
import { verifyAuthToken } from "./src/lib/auth";
export async function middleware(request) {
  const token = request.cookies.get("auth_token")?.value;
  const user = token ? await verifyAuthToken(token) : null;
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
