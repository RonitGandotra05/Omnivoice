import { accountBudgetFilter, voiceBudgetAccount } from "./voice-allowance.mjs";
import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { databasePool } from "./support-store.mjs";
import { providerRequest, ApiError } from "./provider.mjs";
import { ACCOUNT_DEMO_SECONDS } from "../demo-limits.mjs";

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
    env.NETLIFY === "true" || env.DEPLOYMENT_PLATFORM === "netlify"
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
    ALTER TABLE ov_demo_sessions ADD COLUMN IF NOT EXISTS provider_agent_id TEXT;
    ALTER TABLE ov_demo_sessions ADD COLUMN IF NOT EXISTS conversation_id TEXT;
    ALTER TABLE ov_demo_sessions ADD COLUMN IF NOT EXISTS settled BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS ov_demo_sessions_agent ON ov_demo_sessions(provider_agent_id,expires_at);
    CREATE TABLE IF NOT EXISTS ov_demo_operations (
      subject TEXT NOT NULL, day DATE NOT NULL DEFAULT CURRENT_DATE, operation TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, characters BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY(subject,day,operation));
    CREATE TABLE IF NOT EXISTS ov_demo_accounts (
      id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE, extended_access BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    ALTER TABLE ov_demo_accounts ADD COLUMN IF NOT EXISTS voice_budget_seconds INTEGER NOT NULL DEFAULT 600 CHECK(voice_budget_seconds BETWEEN 60 AND 14400);
    ALTER TABLE ov_demo_accounts ADD COLUMN IF NOT EXISTS voice_reset_at TIMESTAMPTZ;
    ALTER TABLE ov_demo_accounts ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE ov_demo_accounts ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE ov_demo_accounts ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system';
    ALTER TABLE ov_demo_accounts ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ov_demo_accounts ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS ov_demo_accounts_email_normalized ON ov_demo_accounts(LOWER(email));
    CREATE OR REPLACE FUNCTION ov_unique_account_name() RETURNS trigger AS $fn$
    DECLARE base TEXT; candidate TEXT; suffix INTEGER := 1;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('ov-account-names'));
      base := LEFT(TRIM(NEW.name),100); candidate := base;
      WHILE EXISTS(SELECT 1 FROM ov_demo_accounts WHERE LOWER(name)=LOWER(candidate) AND id<>NEW.id) LOOP
        suffix := suffix+1; candidate := LEFT(base,100-LENGTH(suffix::text)-1)||'-'||suffix;
      END LOOP;
      NEW.name := candidate; RETURN NEW;
    END $fn$ LANGUAGE plpgsql;
    DO $migration$ DECLARE entry RECORD; BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('ov-account-names'));
      IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='ov_demo_accounts_name_unique') THEN
        CREATE TRIGGER ov_account_name BEFORE INSERT OR UPDATE OF name ON ov_demo_accounts
          FOR EACH ROW EXECUTE FUNCTION ov_unique_account_name();
        FOR entry IN SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY LOWER(name) ORDER BY created_at,id) AS ordinal FROM ov_demo_accounts) names WHERE ordinal>1 LOOP
          UPDATE ov_demo_accounts SET name=name WHERE id=entry.id;
        END LOOP;
        CREATE UNIQUE INDEX ov_demo_accounts_name_unique ON ov_demo_accounts(LOWER(name));
      END IF;
    END $migration$;
    CREATE TABLE IF NOT EXISTS ov_account_identities (
      provider TEXT NOT NULL, provider_subject TEXT NOT NULL,
      account_id UUID NOT NULL REFERENCES ov_demo_accounts(id) ON DELETE CASCADE,
      PRIMARY KEY(provider,provider_subject), UNIQUE(account_id,provider));
    CREATE TABLE IF NOT EXISTS ov_account_tokens (
      token_hash TEXT PRIMARY KEY, account_id UUID NOT NULL REFERENCES ov_demo_accounts(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(account_id,purpose));
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
  if (!account?.id || account.email_verified !== true)
    return allowanceFromUsage(null, account);
  const identities = demoIdentities(request, owner, env);
  await setupDemoDatabase(env);
  await reconcileDemoUsage(account.id, env);
  const r = await databasePool(env).query(
    `SELECT COALESCE(SUM(duration_seconds),0)::int AS used_seconds, MIN(expires_at) FILTER (WHERE settled AND duration_seconds>0) AS retry_at, COALESCE(SUM(duration_seconds) FILTER (WHERE NOT settled),0)::int AS pending_seconds FROM ov_demo_sessions
    WHERE expires_at>NOW() AND ${accountBudgetFilter}`,
    [identities.ip, identities.browser, account?.id || null],
  );
  return allowanceFromUsage(
    r.rows[0],
    await voiceBudgetAccount(databasePool(env), account.id),
  );
}
export function allowanceFromUsage(usage, account) {
  const budget =
    account?.id && account.email_verified === true && account.active !== false
      ? Number(account.voice_budget_seconds ?? ACCOUNT_DEMO_SECONDS)
      : 0;
  const reserved = Number(usage?.used_seconds) || 0;
  const pending = Number(usage?.pending_seconds) || 0;
  const used = Math.max(0, reserved - pending);
  const remaining = Math.max(0, budget - reserved);
  return {
    available: remaining > 0,
    retry_at:
      !remaining && usage?.retry_at
        ? new Date(usage.retry_at).toISOString()
        : null,
    max_seconds: remaining,
    budget_seconds: budget,
    used_seconds: used,
    pending_seconds: pending,
    verification_required: !!account && !account.email_verified,
    account_required: !account?.id,
  };
}
export async function reserveDemo(
  request,
  owner,
  env = process.env,
  account = null,
  agentId = null,
) {
  if (!account?.id || account.email_verified !== true)
    throw new ApiError("Sign in with a verified account to try the demo.", 401);
  const identities = demoIdentities(request, owner, env);
  await reconcileDemoUsage(account.id, env);
  return locked(env, async (db) => {
    if (agentId) {
      const prior = await db.query(
        "SELECT 1 FROM ov_demo_sessions WHERE provider_agent_id=$1 AND expires_at>NOW() AND NOT settled LIMIT 1",
        [agentId],
      );
      if (prior.rowCount)
        throw new ApiError(
          "Publish your agent again before starting another demo. Your remaining time has not been reserved.",
          409,
        );
    }
    if (account?.email_verified === true)
      await db.query(
        `UPDATE ov_demo_sessions SET account_id=$3 WHERE expires_at>NOW()
         AND account_id IS NULL AND (ip_hash=$1 OR browser_hash=$2)`,
        [identities.ip, identities.browser, account.id],
      );
    const active = await db.query(
      `SELECT COALESCE(SUM(duration_seconds),0)::int AS used_seconds, MIN(expires_at) FILTER (WHERE settled AND duration_seconds>0) AS retry_at, COALESCE(SUM(duration_seconds) FILTER (WHERE NOT settled),0)::int AS pending_seconds FROM ov_demo_sessions WHERE expires_at>NOW()
      AND ${accountBudgetFilter}`,
      [identities.ip, identities.browser, account?.id || null],
    );
    const currentAccount = await voiceBudgetAccount(db, account.id);
    if (!currentAccount?.active)
      throw new ApiError("Account access is unavailable.", 403);
    const allowance = allowanceFromUsage(active.rows[0], currentAccount);
    if (!allowance.available && allowance.pending_seconds > 0)
      throw new ApiError(
        "Your last voice connection is still being verified. Unused minutes will return automatically.",
        409,
      );
    if (!allowance.available)
      throw new ApiError(
        "Your daily voice demo has been used. Please try again after 24 hours.",
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
    const duration = Math.min(ACCOUNT_DEMO_SECONDS, allowance.max_seconds);
    const reservation = randomUUID();
    await db.query(
      "INSERT INTO ov_demo_sessions (id,ip_hash,browser_hash,account_id,duration_seconds,provider_agent_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        reservation,
        identities.ip,
        identities.browser,
        account?.id || null,
        duration,
        agentId,
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
  account = null,
) {
  if (
    operation !== "account" &&
    (!account?.id || account.email_verified !== true)
  )
    throw new ApiError("Sign in with a verified account to try the demo.", 401);
  const identity = demoIdentities(request, owner, env);
  return locked(env, async (db) => {
    // Stop spending on further publication once the free trial has been consumed.
    const used = await db.query(
      `SELECT COALESCE(SUM(duration_seconds),0)::int AS used_seconds FROM ov_demo_sessions WHERE expires_at>NOW() AND ${accountBudgetFilter}`,
      [identity.ip, identity.browser, account?.id || null],
    );
    if (
      !allowanceFromUsage(
        used.rows[0],
        account?.id ? await voiceBudgetAccount(db, account.id) : account,
      ).available &&
      operation !== "account"
    )
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
        operation === "document" ? 100 : operation === "account" ? 3 : 20,
        5000000,
      ],
      [
        identity.browser,
        operation === "document" ? 100 : operation === "account" ? 3 : 20,
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

// Only provider records may reduce a reservation. Client clocks and transcripts
// cannot grant extra time. Reads also reconcile calls closed with the browser.
export async function reconcileDemoUsage(
  accountId,
  env = process.env,
  provider = (path, options = {}) => providerRequest(path, { ...options, env }),
) {
  if (!env.ELEVENLABS_API_KEY) return;
  const db = databasePool(env);
  const pending = await db.query(
    "SELECT * FROM ov_demo_sessions WHERE account_id=$1 AND NOT settled AND expires_at>NOW() ORDER BY created_at LIMIT 10",
    [accountId],
  );
  await Promise.all(
    pending.rows.map(async (row) => {
      if (!row.provider_agent_id) return;
      try {
        let conversationId = row.conversation_id;
        if (!conversationId) {
          const list = await provider(
            "/conversations?agent_id=" +
              encodeURIComponent(row.provider_agent_id),
          );
          conversationId = list.conversations?.[0]?.conversation_id;
        }
        if (conversationId) {
          const call = await provider(
            "/conversations/" + encodeURIComponent(conversationId),
            { allow404: true },
          );
          if (
            !call.conversation_id &&
            Date.now() - new Date(row.created_at).getTime() > 20 * 60 * 1000
          ) {
            await provider(
              "/agents/" + encodeURIComponent(row.provider_agent_id),
              { method: "DELETE", allow404: true },
            );
            await db.query(
              "UPDATE ov_demo_sessions SET duration_seconds=0,settled=TRUE WHERE id=$1 AND NOT settled",
              [row.id],
            );
            return;
          }
          if (call.agent_id !== row.provider_agent_id) return;
          if (!["done", "failed"].includes(call.status)) return;
          const seconds = Number(call.metadata?.call_duration_secs);
          if (!Number.isFinite(seconds) || seconds < 0) return;
          await db.query(
            "UPDATE ov_demo_sessions SET duration_seconds=$2,settled=TRUE,conversation_id=$3 WHERE id=$1 AND NOT settled",
            [
              row.id,
              Math.min(row.duration_seconds, Math.ceil(seconds)),
              conversationId,
            ],
          );
        } else if (
          Date.now() - new Date(row.created_at).getTime() >
          20 * 60 * 1000
        ) {
          // Revoke unused credentials before refunding an abandoned connection.
          await provider(
            "/agents/" + encodeURIComponent(row.provider_agent_id),
            { method: "DELETE", allow404: true },
          );
          await db.query(
            "UPDATE ov_demo_sessions SET duration_seconds=0,settled=TRUE WHERE id=$1 AND NOT settled",
            [row.id],
          );
        }
      } catch {
        /* Retain reservation until the provider can verify the call. */
      }
    }),
  );
}
export async function bindDemoConversation(
  reservation,
  conversationId,
  env = process.env,
) {
  await databasePool(env).query(
    "UPDATE ov_demo_sessions SET conversation_id=$2 WHERE id=$1 AND NOT settled",
    [reservation, conversationId],
  );
}
export async function releaseUnissuedDemo(reservation, env = process.env) {
  await databasePool(env).query(
    "UPDATE ov_demo_sessions SET duration_seconds=0,settled=TRUE WHERE id=$1 AND conversation_id IS NULL",
    [reservation],
  );
}

export async function cancelUnusedDemo(
  reservationId,
  accountId,
  env = process.env,
  provider = (path, options = {}) => providerRequest(path, { ...options, env }),
) {
  if (
    typeof reservationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(reservationId)
  )
    throw new ApiError("Invalid voice reservation", 422);
  const db = databasePool(env);
  const row = (
    await db.query(
      "SELECT * FROM ov_demo_sessions WHERE id=$1 AND account_id=$2 AND NOT settled",
      [reservationId, accountId],
    )
  ).rows[0];
  if (!row?.provider_agent_id) return false;
  const list = await provider(
    "/conversations?agent_id=" + encodeURIComponent(row.provider_agent_id),
  );
  // Never refund a connected call based on a browser's failure report.
  if (!Array.isArray(list.conversations) || list.conversations.length)
    return false;
  await provider("/agents/" + encodeURIComponent(row.provider_agent_id), {
    method: "DELETE",
    allow404: true,
  });
  await db.query(
    "UPDATE ov_demo_sessions SET duration_seconds=0,settled=TRUE WHERE id=$1 AND NOT settled",
    [row.id],
  );
  return true;
}
