import { isProductAdmin } from "./admin-policy.mjs";
import { normalizeEmail } from "./auth-email.mjs";
import { validNewPassword } from "./auth-password.mjs";
export function accountProviders(env = process.env) {
  const sessionReady =
    !!env.NEXTAUTH_SECRET &&
    env.NEXTAUTH_SECRET.length >= 32 &&
    !/change-me|replace-with|example/i.test(env.NEXTAUTH_SECRET);
  return {
    google:
      sessionReady && !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
  };
}
export function accountMailEnabled(env = process.env) {
  return (
    env.ACCOUNT_EMAIL_ENABLED === "true" &&
    !!env.SMTP_HOST &&
    !!env.SMTP_FROM &&
    (env.PUBLIC_APP_URL || "").startsWith("https://")
  );
}
export const normalizeAccountEmail = normalizeEmail;
export const validAccountPassword = validNewPassword;
export function accountView(row) {
  if (!row) return null;
  return {
    id: row.id,
    is_admin: isProductAdmin(row),
    name: row.name,
    email: row.email,
    email_verified: row.email_verified === true,
    theme: ["light", "dark", "system"].includes(row.theme)
      ? row.theme
      : "system",
    has_password: !!row.password_hash,
    created_at: row.created_at,
    // Kept for older clients. Trial eligibility is derived from verified identity.
    extended_access: row.extended_access === true,
  };
}
