import NextAuth from "next-auth";
import { createAccountAuth } from "@/lib/server/account-auth.mjs";
import { demoIdentities } from "@/lib/server/demo-protection.mjs";
import { browserOwner } from "@/lib/server/provider.mjs";
import { rateLimit } from "@/lib/server/support-store.mjs";
import { boundedBody } from "@/lib/request-security.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request, context) {
  try {
    if (request.method === "POST")
      await boundedBody(request.clone(), 16 * 1024);
    const path = new URL(request.url).pathname;
    if (
      request.method === "POST" &&
      /\/signin\/(google|apple|github)$/.test(path)
    ) {
      const identity = demoIdentities(request, browserOwner(request).owner);
      await rateLimit(identity.ip, "oauth-signin", 10);
    }
    const response = await NextAuth(createAccountAuth(request))(
      request,
      context,
    );
    // A completed social sign-in must not leave an older manual session selected.
    if (/\/callback\/(google|apple|github)$/.test(path))
      response.headers.append(
        "Set-Cookie",
        `ov_account=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
      );
    return response;
  } catch (error) {
    return Response.json(
      { error: "Sign-in is temporarily unavailable. Please try again later." },
      {
        status: error.status || 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
export { handle as GET, handle as POST };
