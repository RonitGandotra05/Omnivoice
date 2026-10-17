import { databasePool } from "./support-store.mjs";
import { ApiError } from "./provider.mjs";
import { beginAuthAttempt, finishAuthAttempt } from "./auth-guard.mjs";
import { verifyPassword } from "./auth-password.mjs";
import {
  mfaStatus,
  startMfaEnrollment,
  confirmMfaEnrollment,
  consumeMfaFactor,
  rotateRecoveryCodes,
  disableMfa,
} from "./auth-mfa.mjs";
import { sendSecurityNotice } from "./auth-notices.mjs";
export async function manageMfa(
  request,
  action,
  body,
  context,
  env = process.env,
  notify = sendSecurityNotice,
) {
  const { principal, email, password_hash, authenticated_at } = context;
  if (action === "mfa-status") return { mfa: await mfaStatus(principal, env) };
  const ids = await beginAuthAttempt(
    request,
    principal,
    "security-change",
    env,
  );
  let success = false;
  try {
    if (password_hash) {
      if (!(await verifyPassword(body.current_password, password_hash)))
        throw new ApiError("Current password is incorrect.", 401);
    } else if (!authenticated_at || Date.now() / 1000 - authenticated_at > 300)
      throw new ApiError(
        "Sign in again before changing your security settings.",
        401,
      );
    if (action === "mfa-start") {
      if (!context.email_verified && principal.startsWith("public:"))
        throw new ApiError(
          "Verify your email before enabling two-factor authentication.",
          403,
        );
      const result = await startMfaEnrollment(principal, email, env);
      success = true;
      return result;
    }
    const db = await databasePool(env).connect();
    let codes, version;
    try {
      await db.query("BEGIN");
      if (action === "mfa-enable")
        codes = await confirmMfaEnrollment(db, principal, body.code, env);
      else {
        await consumeMfaFactor(db, principal, body.code, env);
        if (action === "mfa-disable") await disableMfa(db, principal);
        else if (action === "mfa-recovery") {
          codes = await rotateRecoveryCodes(db, principal, env);
          await db.query(
            "UPDATE ov_auth_mfa SET version=version+1 WHERE principal=$1",
            [principal],
          );
        } else throw new ApiError("Not found", 404);
      }
      if (principal.startsWith("public:"))
        version = (
          await db.query(
            "UPDATE ov_demo_accounts SET session_version=session_version+1 WHERE id=$1 AND active=TRUE RETURNING session_version",
            [principal.slice(7)],
          )
        ).rows[0]?.session_version;
      await db.query("DELETE FROM ov_auth_challenges WHERE principal=$1", [
        principal,
      ]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    const state = await mfaStatus(principal, env);
    success = true;
    await notify(
      { email },
      action === "mfa-enable"
        ? "mfa_enabled"
        : action === "mfa-disable"
          ? "mfa_disabled"
          : "recovery_regenerated",
      env,
    );
    return { mfa: state, recovery_codes: codes, session_version: version };
  } finally {
    await finishAuthAttempt(ids, success, env);
  }
}
