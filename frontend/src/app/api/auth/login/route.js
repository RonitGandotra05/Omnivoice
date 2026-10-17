import { handleOperatorLogin } from "@/lib/server/operator-auth.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request) => handleOperatorLogin(request);
