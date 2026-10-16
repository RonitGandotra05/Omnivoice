import { verifyAuthToken } from "./auth";
import { activeAdmin } from "./active-admin.mjs";
import { query } from "./db";
export async function verifyAdminSession(token) {
  return activeAdmin(await verifyAuthToken(token), async (id) => {
    const result = await query(
      "SELECT is_active, is_admin FROM users WHERE id = $1",
      [id],
    );
    return result.rows[0];
  });
}
