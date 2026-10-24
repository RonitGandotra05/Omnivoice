import { createStudioHandler } from "@/lib/server/studio-handler.mjs";
import { timingSafeEqual } from "node:crypto";
import { demoAccount } from "@/lib/server/demo-accounts.mjs";
import { isProductAdmin } from "@/lib/server/admin-policy.mjs";
import { verifyAdminSession } from "@/lib/admin-session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = createStudioHandler({
  authenticate: async (request) => {
    const configured = process.env.SUPPORT_INTEGRATION_KEY;
    const provided = request.headers
      .get("authorization")
      ?.replace(/^Bearer /, "");
    if (configured && configured.length >= 32 && provided) {
      const a = Buffer.from(configured),
        b = Buffer.from(provided);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
    if (isProductAdmin(await demoAccount(request))) return true;
    return !!(
      await verifyAdminSession(request.cookies.get("auth_token")?.value || "")
    )?.isAdmin;
  },
});
async function handle(request, context) {
  const { path } = await context.params;
  return handler(request, path.join("/"));
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
