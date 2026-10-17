import { createHmac, randomUUID } from "node:crypto";
import { databasePool, rateLimit } from "./support-store.mjs";
import { clientNetwork } from "./demo-protection.mjs";
import { ApiError } from "./provider.mjs";
let ready;
export function authDigest(kind, value, env = process.env) {
  const key = env.STUDIO_SESSION_SECRET || env.JWT_SECRET;
  if (!key || key.length < 32)
    throw new ApiError("Sign-in protection is not configured", 503);
  return createHmac("sha256", key)
    .update(`auth-v1:${kind}:${value}`)
    .digest("hex");
}
export async function setupAuthSecurity(env = process.env) {
  ready ||= databasePool(env)
    .query(
      `
 CREATE TABLE IF NOT EXISTS ov_auth_guards(subject TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,level INTEGER NOT NULL DEFAULT 0,window_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),locked_until TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS ov_auth_mfa(principal TEXT PRIMARY KEY,secret TEXT,pending_secret TEXT,pending_expires TIMESTAMPTZ,enabled BOOLEAN NOT NULL DEFAULT FALSE,version INTEGER NOT NULL DEFAULT 0,last_step BIGINT NOT NULL DEFAULT -1,recovery_hashes JSONB NOT NULL DEFAULT '[]');
 CREATE TABLE IF NOT EXISTS ov_auth_challenges(token_hash TEXT PRIMARY KEY,principal TEXT NOT NULL,realm TEXT NOT NULL,credential_version INTEGER NOT NULL,mfa_version INTEGER NOT NULL,network_hash TEXT NOT NULL,method TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()+INTERVAL '10 minutes'),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS ov_auth_challenge_expiry ON ov_auth_challenges(expires_at);
 CREATE TABLE IF NOT EXISTS ov_auth_events(id UUID PRIMARY KEY,event TEXT NOT NULL,subject_hash TEXT NOT NULL,network_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS ov_auth_event_expiry ON ov_auth_events(created_at);
 CREATE TABLE IF NOT EXISTS ov_auth_maintenance(id INTEGER PRIMARY KEY CHECK(id=1),checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS ov_auth_mail_budget(subject TEXT NOT NULL,period TEXT NOT NULL,bucket BIGINT NOT NULL,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(subject,period,bucket));
 `,
    )
    .catch((error) => {
      ready = null;
      throw error;
    });
  await ready;
}
export function guardIdentities(request, identity, realm, env = process.env) {
  const network = authDigest("network", clientNetwork(request, env), env);
  return {
    account: authDigest("account", realm + ":" + identity, env),
    network,
    pair: authDigest("pair", realm + ":" + identity + ":" + network, env),
  };
}
export async function auditAuth(
  event,
  identity,
  env = process.env,
  db = databasePool(env),
) {
  await db.query(
    "INSERT INTO ov_auth_events(id,event,subject_hash,network_hash) VALUES($1,$2,$3,$4)",
    [randomUUID(), event, identity.account, identity.network],
  );
}
// Prune outside authentication transactions so housekeeping cannot form a lock
// cycle with concurrent account/network reservations. One worker per minute.
export async function cleanupAuthSecurity(env = process.env) {
  const db = databasePool(env);
  const lease = await db.query(
    "INSERT INTO ov_auth_maintenance(id) VALUES(1) ON CONFLICT(id) DO UPDATE SET checked_at=NOW() WHERE ov_auth_maintenance.checked_at<NOW()-INTERVAL '1 minute' RETURNING id",
  );
  if (!lease.rowCount) return;
  await db.query(
    "DELETE FROM ov_auth_events WHERE created_at<NOW()-INTERVAL '30 days'",
  );
  await db.query(
    "DELETE FROM ov_auth_events WHERE id IN(SELECT id FROM ov_auth_events ORDER BY created_at DESC,id DESC OFFSET 10000)",
  );
  await db.query(
    "DELETE FROM ov_auth_guards WHERE updated_at<NOW()-INTERVAL '2 days'",
  );
  await db.query("DELETE FROM ov_auth_challenges WHERE expires_at<NOW()");
}
function limited(seconds) {
  const error = new ApiError(
    "Too many sign-in attempts. Please wait before trying again.",
    429,
  );
  error.retryAfter = Math.max(1, Math.ceil(seconds));
  return error;
}
export async function beginAuthAttempt(
  request,
  identity,
  realm = "public",
  env = process.env,
) {
  await setupAuthSecurity(env);
  await rateLimit("site", "auth-ingress", 120, env);
  // Retention failures must not invalidate an otherwise valid authentication.
  await cleanupAuthSecurity(env).catch(() => {
    console.error("Authentication retention cleanup failed");
  });
  const ids = guardIdentities(request, identity, realm, env);
  const db = await databasePool(env).connect();
  let blocked;
  try {
    await db.query("BEGIN");
    const limits = [
      [ids.account, 5],
      [ids.pair, 5],
      [ids.network, 30],
    ].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [subject, limit] of limits) {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [subject]);
      const current = (
        await db.query(
          "SELECT *,EXTRACT(EPOCH FROM(locked_until-NOW())) AS wait FROM ov_auth_guards WHERE subject=$1 FOR UPDATE",
          [subject],
        )
      ).rows[0];
      if (Number(current?.wait) > 0) {
        blocked = Math.max(blocked || 0, Number(current.wait));
        continue;
      }
      const now = Date.now();
      const expired =
        !current ||
        now - new Date(current.window_at).getTime() >= 15 * 60000 ||
        !!current.locked_until;
      const attempts = expired ? 1 : current.attempts + 1;
      const level =
        current && now - new Date(current.updated_at).getTime() < 86400000
          ? current.level
          : 0;
      const locks = attempts >= limit;
      const minutes = Math.min(60, 15 * 2 ** Math.min(level, 2));
      await db.query(
        `INSERT INTO ov_auth_guards(subject,attempts,level,window_at,locked_until) VALUES($1,$2,$3,NOW(),CASE WHEN $4::int>0 THEN NOW()+make_interval(secs=>$4) ELSE NULL END) ON CONFLICT(subject) DO UPDATE SET attempts=$2,level=$3,window_at=CASE WHEN $5 THEN NOW() ELSE ov_auth_guards.window_at END,locked_until=CASE WHEN $4::int>0 THEN NOW()+make_interval(secs=>$4) ELSE NULL END,updated_at=NOW()`,
        [
          subject,
          attempts,
          level + (locks ? 1 : 0),
          locks ? minutes * 60 : 0,
          expired,
        ],
      );
    }
    await auditAuth(blocked ? "locked" : "attempt", ids, env, db);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  if (blocked) throw limited(blocked);
  return ids;
}
export async function finishAuthAttempt(ids, success, env = process.env) {
  if (success)
    await databasePool(env).query(
      "DELETE FROM ov_auth_guards WHERE subject=ANY($1::text[])",
      [[ids.account, ids.pair]],
    );
  await auditAuth(success ? "success" : "failure", ids, env);
}
export function resetAuthSecurityForTests() {
  ready = null;
}
