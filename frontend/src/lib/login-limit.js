import { createHash } from "node:crypto";
import { pool } from "@/lib/db";
let setup;
export async function loginLimit(request, email) {
  // No spoofable forwarding headers unless the deployment explicitly trusts its proxy.
  const ip =
    process.env.TRUST_PROXY_HEADERS === "true"
      ? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
        "unknown"
      : "shared-ingress";
  const identities = [
    `login-ip:${ip}`,
    `login-account:${String(email).toLowerCase()}`,
  ];
  setup ||= pool
    .query(
      "CREATE TABLE IF NOT EXISTS login_request_limits (key TEXT NOT NULL, bucket BIGINT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, bucket))",
    )
    .catch((error) => {
      setup = undefined;
      throw error;
    });
  await setup;
  const bucket = Math.floor(Date.now() / 60000);
  for (const identity of identities) {
    const key = createHash("sha256").update(identity).digest("hex");
    const result = await pool.query(
      "INSERT INTO login_request_limits (key, bucket, count) VALUES ($1,$2,1) ON CONFLICT (key,bucket) DO UPDATE SET count=login_request_limits.count+1 WHERE login_request_limits.count < 10 RETURNING count",
      [key, bucket],
    );
    if (!result.rowCount) return false;
  }
  await pool.query("DELETE FROM login_request_limits WHERE bucket < $1", [
    bucket - 2,
  ]);
  return true;
}
