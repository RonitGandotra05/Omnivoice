import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { databasePool } from "./support-store.mjs";
import { ApiError } from "./provider.mjs";

export function protectionEnabled(env = process.env) {
  return (
    env.DEMO_PROTECTION_ENABLED === "true" ||
    env.NETLIFY === "true" ||
    env.NODE_ENV === "production"
  );
}
export function clientNetwork(request, env = process.env) {
  // Trust only Netlify's platform-set header on Netlify, never caller-supplied XFF.
  let ip =
    env.NETLIFY === "true"
      ? request.headers.get("x-nf-client-connection-ip")
      : null;
  if (
    !ip &&
    env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
  )
    ip = "127.0.0.1";
  if (!ip || !isIP(ip))
    throw new ApiError(
      "Unable to verify the demo network. Please try again later.",
      503,
    );
  ip = ip.toLowerCase();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) === 6) {
    // Group privacy-address rotation into one /64; canonicalize equivalent IPv6 spellings.
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [a, b] = canonical.split("::");
    const left = a ? a.split(":") : [],
      right = b ? b.split(":") : [];
    const groups = canonical.includes("::")
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
    return (
      groups
        .slice(0, 4)
        .map((x) => x.padStart(4, "0"))
        .join(":") + "::/64"
    );
  }
  return ip;
}
export function demoIdentities(request, owner, env = process.env) {
  if (!env.STUDIO_SESSION_SECRET || env.STUDIO_SESSION_SECRET.length < 32)
    throw new ApiError("Demo protection is not configured", 503);
  const digest = (kind, value) =>
    createHmac("sha256", env.STUDIO_SESSION_SECRET)
      .update(`demo-v1:${kind}:${value}`)
      .digest("hex");
  return {
    ip: digest("ip", clientNetwork(request, env)),
    browser: digest("browser", owner),
  };
}
let ready;
export async function setupDemoDatabase(env = process.env) {
  if (!env.DATABASE_URL && !env.NEON_DB_CONNECTION_STRING)
    throw new ApiError("Demo protection database is unavailable", 503);
  ready ||= databasePool(env)
    .query(
      `
    CREATE TABLE IF NOT EXISTS ov_demo_sessions (
      id UUID PRIMARY KEY, ip_hash TEXT NOT NULL, browser_hash TEXT NOT NULL,
      account_id UUID, duration_seconds INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()+INTERVAL '24 hours'));
    CREATE INDEX IF NOT EXISTS ov_demo_sessions_expiry ON ov_demo_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS ov_demo_operations (
      subject TEXT NOT NULL, day DATE NOT NULL DEFAULT CURRENT_DATE, operation TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, characters BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY(subject,day,operation));
    CREATE TABLE IF NOT EXISTS ov_demo_accounts (
      id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE, extended_access BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `,
    )
    .catch((e) => {
      ready = null;
      throw e;
    });
  await ready;
}
async function locked(env, operation) {
  await setupDemoDatabase(env);
  const db = await databasePool(env).connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('omnivoice-demo-budget-v1'))",
    );
    const result = await operation(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function demoAllowance(
  request,
  owner,
  env = process.env,
  account = null,
) {
  const identities = demoIdentities(request, owner, env);
  await setupDemoDatabase(env);
  const r = await databasePool(env).query(
    `SELECT MAX(expires_at) AS retry_at FROM ov_demo_sessions
    WHERE expires_at>NOW() AND (ip_hash=$1 OR browser_hash=$2 OR ($3::uuid IS NOT NULL AND account_id=$3))`,
    [identities.ip, identities.browser, account?.id || null],
  );
  const retry = r.rows[0]?.retry_at;
  return {
    available: !retry,
    retry_at: retry ? new Date(retry).toISOString() : null,
    max_seconds: account?.extended_access === true ? 180 : 60,
  };
}
export async function reserveDemo(
  request,
  owner,
  env = process.env,
  account = null,
) {
  const identities = demoIdentities(request, owner, env);
  return locked(env, async (db) => {
    const active = await db.query(
      `SELECT 1 FROM ov_demo_sessions WHERE expires_at>NOW()
      AND (ip_hash=$1 OR browser_hash=$2 OR ($3::uuid IS NOT NULL AND account_id=$3)) LIMIT 1`,
      [identities.ip, identities.browser, account?.id || null],
    );
    if (active.rowCount)
      throw new ApiError(
        "This network or browser has used its daily voice demo. Try again after 24 hours.",
        429,
      );
    const total = await db.query(
      "SELECT COUNT(*)::int AS count FROM ov_demo_sessions WHERE created_at>NOW()-INTERVAL '24 hours'",
    );
    const cap = Math.max(
      1,
      Math.min(100, Number(env.DEMO_SITE_DAILY_LIMIT) || 20),
    );
    if (total.rows[0].count >= cap)
      throw new ApiError(
        "Today’s voice demo capacity has been reached. Please try again tomorrow.",
        429,
      );
    const duration = account?.extended_access === true ? 180 : 60;
    const reservation = randomUUID();
    await db.query(
      "INSERT INTO ov_demo_sessions (id,ip_hash,browser_hash,account_id,duration_seconds) VALUES ($1,$2,$3,$4,$5)",
      [
        reservation,
        identities.ip,
        identities.browser,
        account?.id || null,
        duration,
      ],
    );
    await db.query(
      "DELETE FROM ov_demo_sessions WHERE expires_at<NOW()-INTERVAL '2 days'",
    );
    return { reservation_id: reservation, max_seconds: duration };
  });
}
export async function protectDemoOperation(
  request,
  owner,
  operation,
  characters = 0,
  env = process.env,
) {
  const identity = demoIdentities(request, owner, env);
  return locked(env, async (db) => {
    // Stop spending on further publication once the free trial has been consumed.
    const used = await db.query(
      "SELECT 1 FROM ov_demo_sessions WHERE expires_at>NOW() AND (ip_hash=$1 OR browser_hash=$2) LIMIT 1",
      [identity.ip, identity.browser],
    );
    if (used.rowCount && operation !== "account")
      throw new ApiError(
        "Your daily demo has been used. Publishing is available again after 24 hours.",
        429,
      );
    for (const [subject, countLimit, charLimit] of [
      [
        "site",
        operation === "document" ? 200 : operation === "account" ? 100 : 40,
        10000000,
      ],
      [
        identity.ip,
        operation === "document" ? 100 : operation === "account" ? 3 : 2,
        5000000,
      ],
      [
        identity.browser,
        operation === "document" ? 100 : operation === "account" ? 3 : 2,
        5000000,
      ],
    ]) {
      if (
        !Number.isSafeInteger(characters) ||
        characters < 0 ||
        characters > charLimit
      )
        throw new ApiError("Daily publishing size limit reached.", 429);
      const r = await db.query(
        `INSERT INTO ov_demo_operations (subject,operation,count,characters) VALUES ($1,$2,1,$3)
        ON CONFLICT(subject,day,operation) DO UPDATE SET count=ov_demo_operations.count+1,characters=ov_demo_operations.characters+$3
        WHERE ov_demo_operations.count<$4 AND ov_demo_operations.characters+$3<=$5 RETURNING count`,
        [subject, operation, characters, countLimit, charLimit],
      );
      if (!r.rowCount)
        throw new ApiError(
          "Daily publishing limit reached. Please try again tomorrow.",
          429,
        );
    }
    await db.query("DELETE FROM ov_demo_operations WHERE day<CURRENT_DATE-2");
  });
}
export function resetDemoDatabaseForTests() {
  ready = null;
}
