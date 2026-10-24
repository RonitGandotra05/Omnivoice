import { handleProductAdmin } from "@/lib/server/product-admin.mjs";
export const dynamic = "force-dynamic";
export const GET = (request) => handleProductAdmin(request, "overview");
