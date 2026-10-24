import { randomUUID } from "node:crypto";
import { databasePool } from "./support-store.mjs";
import { ApiError } from "./provider.mjs";
export function positive(env, key, fallback, max = 10000000) {
  const value = Number(env[key] ?? fallback);
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > max ||
    (!key.includes("USD") && !Number.isInteger(value))
  )
    throw new ApiError("Company assistant limits are misconfigured", 503);
  return value;
}
let ready;
export async function setupAssistantBudget(env) {
  ready ||= databasePool(env)
    .query(
      `
    CREATE TABLE IF NOT EXISTS ov_company_ai_requests (
      id UUID PRIMARY KEY, subject TEXT NOT NULL, network TEXT NOT NULL,
      request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      lease_until TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp()+INTERVAL '90 seconds'),
      finished BOOLEAN NOT NULL DEFAULT FALSE, status TEXT NOT NULL DEFAULT 'reserved',
      reserved_tokens INTEGER NOT NULL, reserved_usd NUMERIC NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_usd NUMERIC NOT NULL DEFAULT 0,
      UNIQUE(subject, request_key)
    );
    CREATE INDEX IF NOT EXISTS ov_company_ai_created ON ov_company_ai_requests(created_at);
    CREATE INDEX IF NOT EXISTS ov_company_ai_subject ON ov_company_ai_requests(subject,created_at);
    CREATE INDEX IF NOT EXISTS ov_company_ai_network ON ov_company_ai_requests(network,created_at);
  `,
    )
    .catch((error) => {
      ready = null;
      throw error;
    });
  await ready;
}
function limited(message, retryAfter = 60) {
  const error = new ApiError(message, 429);
  error.retryAfter = Math.max(1, Math.ceil(retryAfter));
  return error;
}
export async function reserveAssistant(
  { subject, network, requestId, fingerprint },
  env,
) {
  await setupAssistantBudget(env);
  const db = await databasePool(env).connect();
  const tokens = 40000; // Conservative bound: <=32 KiB request + trusted prompt/schema + <=3072 output tokens.
  const usd =
    (tokens * positive(env, "COMPANY_AI_INPUT_USD_PER_MILLION", 0.3)) / 1e6 +
    (3072 * positive(env, "COMPANY_AI_OUTPUT_USD_PER_MILLION", 2.5)) / 1e6;
  const id = randomUUID();
  try {
    await db.query("BEGIN");
    await db.query(
      "SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '5s'",
    );
    // Short global reservation lock makes all user/network/site checks atomic across instances.
    await db.query("SELECT pg_advisory_xact_lock(724169034)");
    await db.query(
      "DELETE FROM ov_company_ai_requests WHERE created_at<clock_timestamp()-INTERVAL '8 days'",
    );
    const rows = (
      await db.query(`SELECT *, EXTRACT(EPOCH FROM(clock_timestamp()-created_at)) AS age,
      EXTRACT(EPOCH FROM(lease_until-clock_timestamp())) AS lease FROM ov_company_ai_requests
      WHERE created_at>clock_timestamp()-INTERVAL '1 day'`)
    ).rows;
    const user = rows.filter((r) => r.subject === subject),
      ip = rows.filter((r) => r.network === network);
    if (
      user.some(
        (r) =>
          r.request_key === requestId ||
          (r.fingerprint === fingerprint && Number(r.age) < 60),
      )
    )
      throw limited(
        "This request was already submitted. Review its result before sending again.",
      );
    const active = user.find((r) => !r.finished && Number(r.lease) > 0);
    if (active)
      throw limited(
        "Your company assistant is still working. Please wait.",
        Math.min(25, Number(active.lease)),
      );
    const recent = user.filter((r) => Number(r.age) < 60);
    const perMinute = positive(env, "COMPANY_AI_REQUESTS_PER_MINUTE", 3);
    if (recent.length >= perMinute)
      throw limited(
        `You can send ${perMinute} company requests per minute. Please wait a moment.`,
        60 - Math.max(...recent.map((r) => Number(r.age))),
      );
    if (
      ip.filter((r) => Number(r.age) < 60).length >=
      positive(env, "COMPANY_AI_IP_PER_MINUTE", 15)
    )
      throw limited(
        "This network has reached the company assistant limit. Please try shortly.",
      );
    if (
      user.length >= positive(env, "COMPANY_AI_USER_DAILY", 30) ||
      ip.length >= positive(env, "COMPANY_AI_IP_DAILY", 150)
    )
      throw limited(
        "Today's company assistant allowance has been reached. You can still edit your form manually.",
        86400,
      );
    if (
      user.reduce((sum, r) => sum + r.reserved_tokens, 0) + tokens >
      positive(env, "COMPANY_AI_USER_DAILY_TOKENS", 250000)
    )
      throw limited(
        "Today's company assistant token allowance has been reached. You can still edit your form manually.",
        86400,
      );
    if (
      rows.filter((r) => !r.finished && Number(r.lease) > 0).length >=
      positive(env, "COMPANY_AI_SITE_CONCURRENCY", 10)
    )
      throw limited("The company assistant is busy. Please try shortly.", 25);
    const totalTokens = rows.reduce((n, r) => n + r.reserved_tokens, 0);
    const totalUSD = rows.reduce((n, r) => n + Number(r.reserved_usd), 0);
    if (
      rows.length >= positive(env, "COMPANY_AI_SITE_DAILY", 500) ||
      totalTokens + tokens >
        positive(env, "COMPANY_AI_SITE_DAILY_TOKENS", 2000000) ||
      totalUSD + usd > positive(env, "COMPANY_AI_SITE_DAILY_USD", 5)
    )
      throw limited(
        "The company assistant's daily allowance has been reached. Please use the form or try tomorrow.",
        86400,
      );
    await db.query(
      "INSERT INTO ov_company_ai_requests(id,subject,network,request_key,fingerprint,reserved_tokens,reserved_usd) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, subject, network, requestId, fingerprint, tokens, usd],
    );
    await db.query("COMMIT");
    return id;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function finishAssistant(id, status, usage, env) {
  const knownUsage =
    Number.isInteger(usage?.promptTokenCount) &&
    usage.promptTokenCount >= 0 &&
    Number.isInteger(usage?.candidatesTokenCount) &&
    usage.candidatesTokenCount >= 0 &&
    (usage.thoughtsTokenCount === undefined ||
      (Number.isInteger(usage.thoughtsTokenCount) &&
        usage.thoughtsTokenCount >= 0));
  const input = knownUsage ? usage.promptTokenCount : 0;
  const output = knownUsage
    ? usage.candidatesTokenCount + (usage.thoughtsTokenCount || 0)
    : 0;
  const cost =
    (input * positive(env, "COMPANY_AI_INPUT_USD_PER_MILLION", 0.3) +
      output * positive(env, "COMPANY_AI_OUTPUT_USD_PER_MILLION", 2.5)) /
    1e6;
  // Never release worst-case reservations on provider failures: billing may have occurred.
  await databasePool(env).query(
    `UPDATE ov_company_ai_requests SET finished=$6,status=$2,input_tokens=$3,output_tokens=$4,estimated_usd=$5,
    reserved_tokens=CASE WHEN $6 THEN $3::integer+$4::integer ELSE reserved_tokens END,
    reserved_usd=CASE WHEN $6 THEN $5 ELSE reserved_usd END WHERE id=$1`,
    [id, status, input, output, cost, knownUsage],
  );
}
