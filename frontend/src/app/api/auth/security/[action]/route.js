import { handleOperatorSecurity } from "@/lib/server/operator-auth.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request, context) {
  const { action } = await context.params;
  return handleOperatorSecurity(request, action);
}
export { handle as GET, handle as POST };
