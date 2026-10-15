import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json(
    { error: "Sign in again to renew your session." },
    { status: 410 },
  );
}
