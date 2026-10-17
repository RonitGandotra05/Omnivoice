import { randomUUID } from "node:crypto";
import { databasePool } from "./support-store.mjs";
import { setupDemoDatabase } from "./demo-protection.mjs";
import { ApiError } from "./provider.mjs";
import { normalizeAccountEmail } from "./account-config.mjs";

export async function verifiedProviderEmail(provider, profile, _account) {
  if (
    provider !== "google" ||
    (profile?.email_verified !== true && profile?.email_verified !== "true")
  )
    return null;
  const email = normalizeAccountEmail(profile.email);
  if (
    !email ||
    (!email.endsWith("@gmail.com") &&
      !(typeof profile.hd === "string" && profile.hd.trim()))
  )
    return null;
  return normalizeAccountEmail(profile.email);
}

export async function provisionSocialAccount(
  { provider, subject, email, name, beforeCreate },
  env = process.env,
) {
  email = normalizeAccountEmail(email);
  if (
    provider !== "google" ||
    !subject ||
    String(subject).length > 255 ||
    !normalizeAccountEmail(email)
  )
    throw new ApiError("A verified sign-in email is required.", 401);
  await setupDemoDatabase(env);
  const known = await databasePool(env).query(
    "SELECT account_id FROM ov_account_identities WHERE provider=$1 AND provider_subject=$2",
    [provider, String(subject)],
  );
  if (!known.rowCount && beforeCreate) await beforeCreate();
  const db = await databasePool(env).connect();
  try {
    await db.query("BEGIN");
    // Serialize social provisioning; the email index also protects manual registrations.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "account-email:" + email,
    ]);
    const existing = await db.query(
      `SELECT a.* FROM ov_account_identities i JOIN ov_demo_accounts a ON a.id=i.account_id WHERE i.provider=$1 AND i.provider_subject=$2`,
      [provider, String(subject)],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (!row.active) throw new ApiError("Account unavailable.", 403);
      await db.query(
        "UPDATE ov_demo_accounts SET last_login_at=NOW() WHERE id=$1",
        [row.id],
      );
      await db.query("COMMIT");
      return row;
    }
    // Never silently link a different login method by matching an email.
    const conflict = await db.query(
      "SELECT id FROM ov_demo_accounts WHERE LOWER(email)=$1",
      [email],
    );
    if (conflict.rowCount)
      throw new ApiError(
        "Use your original sign-in method for this email.",
        409,
      );
    const row = (
      await db.query(
        `INSERT INTO ov_demo_accounts(id,name,email,email_verified,last_login_at) VALUES($1,$2,$3,TRUE,NOW()) RETURNING *`,
        [
          randomUUID(),
          String(name || email.split("@")[0])
            .trim()
            .slice(0, 100) || "Member",
          email,
        ],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO ov_account_identities(provider,provider_subject,account_id) VALUES($1,$2,$3)",
      [provider, String(subject), row.id],
    );
    await db.query("COMMIT");
    return row;
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505")
      throw new ApiError(
        "Use your original sign-in method for this email.",
        409,
      );
    throw error;
  } finally {
    db.release();
  }
}
