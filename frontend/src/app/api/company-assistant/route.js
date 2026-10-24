import { createCompanyAssistant } from "@/lib/server/company-assistant.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const POST = createCompanyAssistant();
