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
    if (request.method === "POST" && /\/signin\/(google)$/.test(path)) {
      const identity = demoIdentities(request, browserOwner(request).owner);
      await rateLimit(identity.ip, "oauth-signin", 10);
    }
    const cookies = [];
    const response = await NextAuth(
      createAccountAuth(request, process.env, (cookie) => cookies.push(cookie)),
    )(request, context);
    for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
    // An OAuth first factor must not retain a previous account's full session
    // while the newly selected account is waiting for its second factor.
    if (cookies.length) {
      const names = new Set([
        "next-auth.session-token",
        "__Secure-next-auth.session-token",
      ]);
      for (const part of (request.headers.get("cookie") || "").split(";")) {
        const name = part.trim().split("=")[0];
        if (/^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(name))
          names.add(name);
      }
      for (const name of names)
        response.headers.append(
          "Set-Cookie",
          `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${name.startsWith("__Secure-") || new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
        );
    }
    // A completed social sign-in must not leave an older manual session selected.
    if (/\/callback\/(google)$/.test(path))
      response.headers.append(
        "Set-Cookie",
        `ov_account=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
      );
    return response;
  } catch (error) {
    return Response.json(
      { error: "Sign-in is temporarily unavailable. Please try again later." },
      {
        status:
          error.status || (error.message === "Request too large" ? 413 : 503),
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
export { handle as GET, handle as POST };
