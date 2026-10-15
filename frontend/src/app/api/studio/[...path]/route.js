import { NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request, context) {
  const { path } = await context.params;
  const action = path.join("/");
  const base = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const company = process.env.SUPPORT_COMPANY_ID;
  const key = process.env.SUPPORT_API_KEY;
  const connected = Boolean(company && key);
  if (action === "status" && request.method === "GET") {
    let available = false;
    try {
      available = (
        await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(2000),
          cache: "no-store",
        })
      ).ok;
    } catch {}
    return NextResponse.json({ connected, available });
  }
  const demo = ["preview", "parse"].includes(action);
  const allowed =
    /^(workspace|profile|query|conversations|voice\/(?:session|sync)|documents(?:\/[a-f0-9-]{36})?|escalations(?:\/[a-f0-9-]{36}\/retry)?)$/;
  if (!demo && (!connected || !allowed.test(action)))
    return NextResponse.json(
      { error: "Connected workspace is not configured." },
      { status: 400 },
    );
  if (!demo) {
    const user = await verifyAuthToken(
      request.cookies.get("auth_token")?.value || "",
    );
    if (!user?.isAdmin)
      return NextResponse.json(
        {
          error:
            "Sign in as an administrator to access the connected workspace.",
        },
        { status: 401 },
      );
  }
  // Bound request bodies before forwarding; never expose server-side company keys.
  if (Number(request.headers.get("content-length") || 0) > 11 * 1024 * 1024)
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  try {
    const headers = {};
    if (!demo) headers.Authorization = `Bearer ${key}`;
    const type = request.headers.get("content-type");
    if (type) headers["Content-Type"] = type;
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.arrayBuffer();
    if (body?.byteLength > 11 * 1024 * 1024)
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const response = await fetch(
      `${base}/api/support/${demo ? action : `${company}/${action}`}`,
      {
        method: request.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : data.detail?.map?.((d) => d.msg).join("; ");
      return NextResponse.json(
        {
          error:
            detail?.replaceAll("ElevenLabs", "Voice service") ||
            "Request failed",
        },
        { status: response.status },
      );
    }
    if (typeof data.message === "string")
      data.message = data.message.replaceAll("ElevenLabs", "Voice service");
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      {
        error:
          "Support API unavailable. Start the backend on port 8000 and try again.",
      },
      { status: 503 },
    );
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
