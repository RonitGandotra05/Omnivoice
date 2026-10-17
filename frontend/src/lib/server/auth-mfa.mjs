import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { databasePool } from "./support-store.mjs";
import { setupAuthSecurity, authDigest } from "./auth-guard.mjs";
import { clientNetwork } from "./demo-protection.mjs";
import { ApiError } from "./provider.mjs";
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
function key(env) {
  if (env.AUTH_MFA_KEY) {
    const k = Buffer.from(env.AUTH_MFA_KEY, "base64");
    if (k.length !== 32)
      throw new ApiError("Two-factor encryption is not configured", 503);
    return k;
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32)
    throw new ApiError("Two-factor encryption is not configured", 503);
  return Buffer.from(
    hkdfSync("sha256", env.JWT_SECRET, "omnivoice", "mfa-at-rest-v1", 32),
  );
}
export function encryptMfa(secret, principal, env = process.env) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(env), iv);
  cipher.setAAD(Buffer.from("mfa-v1:" + principal));
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function decryptMfa(value, principal, env = process.env) {
  try {
    const [version, iv, tag, data] = value.split(".");
    if (version !== "v1") throw Error();
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key(env),
      Buffer.from(iv, "base64url"),
    );
    cipher.setAAD(Buffer.from("mfa-v1:" + principal));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ApiError(
      "Two-factor verification is temporarily unavailable",
      503,
    );
  }
}
const totp = (secret, email = "OmniVoice") =>
  new OTPAuth.TOTP({
    issuer: "OmniVoice",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
export function matchedTotpStep(secret, code, at = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const delta = totp(secret).validate({
    token: code,
    window: 1,
    timestamp: at,
  });
  return delta === null ? null : Math.floor(at / 30000) + delta;
}
const recoveryHash = (code, principal) =>
  tokenHash(
    "recovery:" + principal + ":" + code.replace(/-/g, "").toLowerCase(),
  );
function recoveryCodes(principal) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(10).toString("hex").match(/.{4}/g).join("-"),
  );
  return { codes, hashes: codes.map((c) => recoveryHash(c, principal)) };
}
export async function mfaStatus(
  principal,
  env = process.env,
  db = databasePool(env),
) {
  await setupAuthSecurity(env);
  const row = (
    await db.query(
      "SELECT enabled,version,jsonb_array_length(recovery_hashes) AS recovery_remaining FROM ov_auth_mfa WHERE principal=$1",
      [principal],
    )
  ).rows[0];
  return row || { enabled: false, version: 0, recovery_remaining: 0 };
}
export async function startMfaEnrollment(principal, email, env = process.env) {
  await setupAuthSecurity(env);
  const secret = new OTPAuth.Secret({ size: 20 }).base32,
    uri = totp(secret, email).toString();
  const r = await databasePool(env).query(
    `INSERT INTO ov_auth_mfa(principal,pending_secret,pending_expires) VALUES($1,$2,NOW()+INTERVAL '10 minutes') ON CONFLICT(principal) DO UPDATE SET pending_secret=$2,pending_expires=NOW()+INTERVAL '10 minutes' WHERE ov_auth_mfa.enabled=FALSE RETURNING principal`,
    [principal, encryptMfa(secret, principal, env)],
  );
  if (!r.rowCount)
    throw new ApiError("Two-factor authentication is already enabled.", 409);
  return {
    secret,
    qr_code: await QRCode.toDataURL(uri, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
    }),
    expires_in: 600,
  };
}
export async function confirmMfaEnrollment(
  db,
  principal,
  code,
  env = process.env,
) {
  const row = (
    await db.query(
      "SELECT *,pending_expires>NOW() AS pending_valid FROM ov_auth_mfa WHERE principal=$1 FOR UPDATE",
      [principal],
    )
  ).rows[0];
  if (!row?.pending_valid || row.enabled)
    throw new ApiError("Setup expired. Start two-factor setup again.", 409);
  const secret = decryptMfa(row.pending_secret, principal, env),
    step = matchedTotpStep(secret, code);
  if (step === null)
    throw new ApiError(
      "Use a fresh six-digit code from your authenticator.",
      401,
    );
  const recovery = recoveryCodes(principal);
  await db.query(
    "UPDATE ov_auth_mfa SET enabled=TRUE,secret=pending_secret,pending_secret=NULL,pending_expires=NULL,last_step=$2,recovery_hashes=$3,version=version+1 WHERE principal=$1",
    [principal, step, JSON.stringify(recovery.hashes)],
  );
  return recovery.codes;
}
export async function consumeMfaFactor(db, principal, code, env = process.env) {
  const row = (
    await db.query("SELECT * FROM ov_auth_mfa WHERE principal=$1 FOR UPDATE", [
      principal,
    ])
  ).rows[0];
  if (!row?.enabled)
    throw new ApiError("Two-factor authentication is not enabled.", 409);
  const step = matchedTotpStep(decryptMfa(row.secret, principal, env), code);
  if (step !== null && step > Number(row.last_step)) {
    await db.query("UPDATE ov_auth_mfa SET last_step=$2 WHERE principal=$1", [
      principal,
      step,
    ]);
    return { recovery: false };
  }
  if (
    typeof code === "string" &&
    /^(?:[a-f0-9]{4}-){4}[a-f0-9]{4}$/i.test(code)
  ) {
    const expected = Buffer.from(recoveryHash(code, principal), "hex"),
      hashes = row.recovery_hashes;
    const index = hashes.findIndex((value) =>
      timingSafeEqual(Buffer.from(value, "hex"), expected),
    );
    if (index >= 0) {
      hashes.splice(index, 1);
      await db.query(
        "UPDATE ov_auth_mfa SET recovery_hashes=$2 WHERE principal=$1",
        [principal, JSON.stringify(hashes)],
      );
      return { recovery: true };
    }
  }
  throw new ApiError(
    "Use a fresh authenticator code or an unused recovery code.",
    401,
  );
}
export async function rotateRecoveryCodes(db, principal, _env = process.env) {
  const recovery = recoveryCodes(principal);
  await db.query(
    "UPDATE ov_auth_mfa SET recovery_hashes=$2 WHERE principal=$1",
    [principal, JSON.stringify(recovery.hashes)],
  );
  return recovery.codes;
}
export async function disableMfa(db, principal) {
  await db.query(
    "UPDATE ov_auth_mfa SET enabled=FALSE,secret=NULL,pending_secret=NULL,pending_expires=NULL,recovery_hashes='[]',last_step=-1,version=version+1 WHERE principal=$1",
    [principal],
  );
}
export function challengeCookie(request, realm, token = "", maxAge = 600) {
  return `${realm === "operator" ? "ov_operator_step" : "ov_login_step"}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function createMfaChallenge(
  request,
  principal,
  credentialVersion,
  method,
  env = process.env,
) {
  await setupAuthSecurity(env);
  const realm = principal.startsWith("operator:") ? "operator" : "public",
    token = randomBytes(32).toString("base64url"),
    state = await mfaStatus(principal, env);
  if (!state.enabled)
    throw new ApiError("Two-factor authentication is not enabled.", 409);
  await databasePool(env).query(
    "INSERT INTO ov_auth_challenges(token_hash,principal,realm,credential_version,mfa_version,network_hash,method) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      tokenHash(token),
      principal,
      realm,
      credentialVersion,
      state.version,
      authDigest("network", clientNetwork(request, env), env),
      method,
    ],
  );
  await databasePool(env).query(
    "DELETE FROM ov_auth_challenges WHERE expires_at<NOW()",
  );
  return challengeCookie(request, realm, token);
}
export async function verifyMfaChallenge(
  request,
  realm,
  code,
  env = process.env,
) {
  await setupAuthSecurity(env);
  const cookieName =
      realm === "operator" ? "ov_operator_step" : "ov_login_step",
    token = (request.headers.get("cookie") || "").match(
      new RegExp("(?:^|;\\s*)" + cookieName + "=([^;]+)"),
    )?.[1];
  if (!token || !/^[\w-]{43}$/.test(token))
    throw new ApiError("Your sign-in step expired. Sign in again.", 401);
  const db = await databasePool(env).connect();
  let result, error;
  try {
    await db.query("BEGIN");
    const challenge = (
      await db.query(
        "SELECT *,expires_at>NOW() AS valid FROM ov_auth_challenges WHERE token_hash=$1 AND realm=$2 FOR UPDATE",
        [tokenHash(token), realm],
      )
    ).rows[0];
    if (
      !challenge?.valid ||
      challenge.attempts >= 5 ||
      challenge.network_hash !==
        authDigest("network", clientNetwork(request, env), env)
    )
      throw new ApiError("Your sign-in step expired. Sign in again.", 401);
    await db.query(
      "UPDATE ov_auth_challenges SET attempts=attempts+1 WHERE token_hash=$1",
      [tokenHash(token)],
    );
    const current =
      realm === "operator"
        ? (
            await db.query(
              "SELECT * FROM users WHERE id=$1 AND is_active=TRUE AND is_admin=TRUE",
              [Number(challenge.principal.split(":")[1])],
            )
          ).rows[0]
        : (
            await db.query(
              "SELECT * FROM ov_demo_accounts WHERE id=$1 AND active=TRUE",
              [challenge.principal.slice(7)],
            )
          ).rows[0];
    const state = await mfaStatus(challenge.principal, env, db);
    if (
      !current ||
      !state.enabled ||
      state.version !== challenge.mfa_version ||
      (realm === "public" &&
        current.session_version !== challenge.credential_version)
    )
      throw new ApiError("Your sign-in step expired. Sign in again.", 401);
    try {
      const factor = await consumeMfaFactor(db, challenge.principal, code, env);
      await db.query("DELETE FROM ov_auth_challenges WHERE token_hash=$1", [
        tokenHash(token),
      ]);
      result = {
        row: current,
        principal: challenge.principal,
        method: challenge.method,
        mfaVersion: state.version,
        ...factor,
      };
    } catch (failure) {
      if (failure.status !== 401) throw failure;
      error = failure;
    }
    await db.query("COMMIT");
  } catch (failure) {
    await db.query("ROLLBACK");
    throw failure;
  } finally {
    db.release();
  }
  if (error) throw error;
  return result;
}
export async function challengePrincipal(request, realm, env = process.env) {
  await setupAuthSecurity(env);
  const name = realm === "operator" ? "ov_operator_step" : "ov_login_step",
    token = (request.headers.get("cookie") || "").match(
      new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"),
    )?.[1];
  if (!token || !/^[\w-]{43}$/.test(token)) return "invalid-step";
  return (
    (
      await databasePool(env).query(
        "SELECT principal FROM ov_auth_challenges WHERE token_hash=$1 AND realm=$2 AND expires_at>NOW()",
        [tokenHash(token), realm],
      )
    ).rows[0]?.principal || "invalid-step"
  );
}
export async function cancelMfaChallenge(request, realm, env = process.env) {
  await setupAuthSecurity(env);
  const name = realm === "operator" ? "ov_operator_step" : "ov_login_step",
    token = (request.headers.get("cookie") || "").match(
      new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"),
    )?.[1];
  if (token && /^[\w-]{43}$/.test(token))
    await databasePool(env).query(
      "DELETE FROM ov_auth_challenges WHERE token_hash=$1 AND realm=$2",
      [tokenHash(token), realm],
    );
  return challengeCookie(request, realm, "", 0);
}
