import nodemailer from "nodemailer";
import { accountMailEnabled } from "./account-config.mjs";
import { setupAuthSecurity, authDigest } from "./auth-guard.mjs";
import { databasePool } from "./support-store.mjs";
import { ApiError } from "./provider.mjs";
export async function reserveAccountMail(email, env = process.env) {
  await setupAuthSecurity(env);
  const subject = authDigest("mail", email, env),
    db = await databasePool(env).connect();
  try {
    await db.query("BEGIN");
    for (const [who, period, seconds, limit] of [
      [subject, "hour", 3600, 3],
      [subject, "day", 86400, 10],
      ["site", "day", 86400, 200],
    ]) {
      const bucket = Math.floor(Date.now() / 1000 / seconds);
      const result = await db.query(
        `INSERT INTO ov_auth_mail_budget(subject,period,bucket,count) VALUES($1,$2,$3,1) ON CONFLICT(subject,period,bucket) DO UPDATE SET count=ov_auth_mail_budget.count+1 WHERE ov_auth_mail_budget.count<$4 RETURNING count`,
        [who, period, bucket, limit],
      );
      if (!result.rowCount)
        throw new ApiError(
          "Please wait before requesting another account email.",
          429,
        );
    }
    await db.query(
      "DELETE FROM ov_auth_mail_budget WHERE bucket<CASE WHEN period='hour' THEN EXTRACT(EPOCH FROM NOW())/3600-48 ELSE EXTRACT(EPOCH FROM NOW())/86400-2 END",
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export function accountTransport(env = process.env) {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: Number(env.SMTP_PORT) === 465,
    requireTLS: Number(env.SMTP_PORT) !== 465,
    tls: { rejectUnauthorized: true },
    auth: env.SMTP_USERNAME
      ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
const messages = {
  password_changed:
    "Your OmniVoice password was changed. Other sessions were signed out.",
  password_reset:
    "Your OmniVoice password was reset. Other sessions were signed out. Two-factor authentication, if enabled, remains required.",
  mfa_enabled:
    "Authenticator-based two-factor authentication was enabled for your OmniVoice account.",
  mfa_disabled:
    "Two-factor authentication was disabled for your OmniVoice account.",
  recovery_regenerated:
    "New two-factor recovery codes were generated. Previous codes no longer work.",
  recovery_used:
    "A recovery code was used to sign in to your OmniVoice account. Consider generating a new set of codes.",
};
export async function sendSecurityNotice(
  account,
  event,
  env = process.env,
  createTransport = accountTransport,
) {
  if (!accountMailEnabled(env) || !messages[event]) return false;
  let transport;
  try {
    await reserveAccountMail(account.email, env);
    transport = createTransport(env);
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: account.email,
      subject: "OmniVoice account security update",
      text:
        messages[event] +
        "\n\nIf this was not you, reset your password and review your account security at " +
        new URL("/account/settings", env.PUBLIC_APP_URL).toString() +
        ".",
    });
    return true;
  } catch {
    return false;
  } finally {
    transport?.close();
  }
}
