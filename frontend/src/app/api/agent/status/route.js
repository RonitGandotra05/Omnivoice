import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
    const response = await fetch(`${base}/api/agent/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error("Backend unavailable");
    const data = await response.json();
    return NextResponse.json({
      provider: "OmniVoice",
      configured: Boolean(data.configured),
      phone_configured: Boolean(data.phone_configured),
      live_calls_enabled: Boolean(data.live_calls_enabled),
      simulation_available: true,
    });
  } catch {
    return NextResponse.json({
      provider: "OmniVoice",
      configured: false,
      phone_configured: false,
      live_calls_enabled: false,
      simulation_available: true,
      backend_available: false,
    });
  }
}
