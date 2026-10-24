import { operatorMfaRequired } from "./server/operator-auth.mjs";
import { setupAuthSecurity } from "./server/auth-guard.mjs";
import { verifyAuthToken } from "./auth";
import { activeAdmin } from "./active-admin.mjs";
import { ADMIN_EMAIL } from "./server/admin-policy.mjs";
import { query } from "./db";
export async function verifyAdminSession(token) {
  const user = await verifyAuthToken(token);
  if (!user?.isAdmin) return null;
  await setupAuthSecurity();
  return activeAdmin(user, async (id) => {
    const result = await query(
      "SELECT u.email,u.is_active,u.is_admin,COALESCE(m.version,0) AS auth_version,COALESCE(m.enabled,FALSE) AS mfa_enabled FROM users u LEFT JOIN ov_auth_mfa m ON m.principal='operator:'||u.id::text WHERE u.id=$1",
      [id],
    );
    return result.rows[0]?.email?.toLowerCase() === ADMIN_EMAIL
      ? { ...result.rows[0], mfa_required: operatorMfaRequired() }
      : null;
  });
}
