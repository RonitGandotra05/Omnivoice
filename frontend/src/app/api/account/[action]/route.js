import { handleDemoAccount } from "@/lib/server/demo-accounts.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request, context) {
  const { action } = await context.params;
  return handleDemoAccount(request, action);
}
export { handle as GET, handle as POST };
