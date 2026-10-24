import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireProductAdmin } from "@/lib/server/product-admin.mjs";
import ProductAdmin from "@/components/ProductAdmin";
export const dynamic = "force-dynamic";
export default async function Dashboard() {
  const incoming = await headers();
  try {
    await requireProductAdmin(
      new Request(process.env.PUBLIC_APP_URL || "http://localhost:3000", {
        headers: { cookie: incoming.get("cookie") || "" },
      }),
    );
  } catch (error) {
    if (error.status === 401)
      redirect("/account?callbackUrl=%2Fadmin%2Fdashboard");
    if (error.status === 403) redirect("/");
    throw error;
  }
  return <ProductAdmin />;
}
