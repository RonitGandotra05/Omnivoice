import { sameOrigin } from "@/lib/request-security.mjs";
import { NextResponse } from "next/server";
export async function POST(request) {
  if (!sameOrigin(request)) return NextResponse.json({error:"Cross-origin requests are not allowed."},{status:403});
  const response = NextResponse.json({ success: true });
  response.cookies.set("auth_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
