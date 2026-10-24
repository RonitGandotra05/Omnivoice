// Explicit integration run only. Creates and drops an isolated schema in the configured PostgreSQL database.
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import {
  databasePool,
  setSupportPoolForTests,
  serverAction,
} from "../src/lib/server/support-store.mjs";
import {
  reserveAssistant,
  finishAssistant,
} from "../src/lib/server/company-assistant-budget.mjs";
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(".env.local")) };
const root = databasePool(env),
  schema = "test_company_ai_" + randomUUID().replaceAll("-", "");
let pool;
const input = (subject = "user-a", network = "network-a") => ({
  subject,
  network,
  requestId: randomUUID(),
  fingerprint: randomUUID(),
});
const usage = { promptTokenCount: 100, candidatesTokenCount: 40 };
async function clear() {
  await pool.query("TRUNCATE ov_company_ai_requests");
}
try {
  await root.query(`CREATE SCHEMA ${schema}`);
  const direct = new URL(root.options.connectionString);
  direct.hostname = direct.hostname.replace("-pooler.", ".");
  pool = new pg.Pool({
    ...root.options,
    connectionString: direct.toString(),
    options: `-c search_path=${schema}`,
  });
  setSupportPoolForTests(pool);
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => reserveAssistant(input(), env)),
  );
  for (const r of results)
    if (r.status === "rejected" && r.reason.status !== 429)
      console.log({ code: r.reason.code, message: r.reason.message });
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(
    results
      .filter((r) => r.status === "rejected")
      .every((r) => r.reason.status === 429),
  );
  await finishAssistant(
    results.find((r) => r.status === "fulfilled").value,
    "success",
    usage,
    env,
  );
  console.log(
    "PASS: six simultaneous reservations across pool connections allow one active request",
  );
  await clear();
  for (let i = 0; i < 3; i++) {
    const id = await reserveAssistant(input(), env);
    await finishAssistant(id, "success", usage, env);
  }
  await assert.rejects(
    () => reserveAssistant(input(), env),
    (e) => e.status === 429 && e.retryAfter > 0,
  );
  await pool.query(
    "UPDATE ov_company_ai_requests SET created_at=clock_timestamp()-INTERVAL '59 seconds'",
  );
  await assert.rejects(
    () => reserveAssistant(input(), env),
    (e) => e.status === 429 && e.retryAfter <= 2,
  );
  await pool.query(
    "UPDATE ov_company_ai_requests SET created_at=clock_timestamp()-INTERVAL '61 seconds'",
  );
  const next = await reserveAssistant(input(), env);
  await finishAssistant(next, "success", usage, env);
  console.log("PASS: rolling 60-second limit, boundary and Retry-After");
  await clear();
  const original = input();
  const id = await reserveAssistant(original, env);
  await finishAssistant(id, "success", usage, env);
  await assert.rejects(
    () => reserveAssistant(original, env),
    (e) => e.status === 429,
  );
  await assert.rejects(
    () => reserveAssistant({ ...original, requestId: randomUUID() }, env),
    (e) => e.status === 429,
  );
  console.log("PASS: idempotency and identical-payload duplicate protection");
  await clear();
  for (let i = 0; i < 2; i++) {
    const r = await reserveAssistant(input("user-" + i, "shared-network"), env);
    await finishAssistant(r, "success", usage, env);
  }
  await assert.rejects(
    () =>
      reserveAssistant(input("user-new", "shared-network"), {
        ...env,
        COMPANY_AI_IP_PER_MINUTE: 2,
      }),
    (e) => e.status === 429,
  );
  await assert.rejects(
    () =>
      reserveAssistant(input("other", "other-network"), {
        ...env,
        COMPANY_AI_SITE_DAILY: 2,
      }),
    (e) => e.status === 429,
  );
  await assert.rejects(
    () =>
      reserveAssistant(input("user-0", "fresh-network"), {
        ...env,
        COMPANY_AI_USER_DAILY: 1,
      }),
    (e) => e.status === 429,
  );
  console.log("PASS: shared-network, per-user daily and site-wide protection");
  await clear();
  await assert.rejects(
    () =>
      reserveAssistant(input(), { ...env, COMPANY_AI_SITE_DAILY_TOKENS: 100 }),
    (e) => e.status === 429,
  );
  await assert.rejects(
    () =>
      reserveAssistant(input(), { ...env, COMPANY_AI_SITE_DAILY_USD: 0.001 }),
    (e) => e.status === 429,
  );
  const reservation = await reserveAssistant(input(), env);
  await finishAssistant(reservation, "error", undefined, env);
  let row = (await pool.query("SELECT * FROM ov_company_ai_requests")).rows[0];
  assert.equal(row.reserved_tokens, 36000);
  assert.equal(row.finished, false);
  await finishAssistant(reservation, "error", {}, env);
  assert.equal(
    (
      await pool.query(
        "SELECT finished FROM ov_company_ai_requests WHERE id=$1",
        [reservation],
      )
    ).rows[0].finished,
    false,
  );
  await finishAssistant(reservation, "success", usage, env);
  row = (await pool.query("SELECT * FROM ov_company_ai_requests")).rows[0];
  assert.equal(row.input_tokens, 100);
  assert.equal(row.output_tokens, 40);
  assert.equal(row.reserved_tokens, 140);
  assert.equal(row.finished, true);
  console.log(
    "PASS: token/cost circuit breakers, conservative failures and actual usage accounting",
  );
  await clear();
  const crashed = await reserveAssistant(input(), env);
  await finishAssistant(crashed, "error", undefined, env);
  await assert.rejects(
    () => reserveAssistant(input(), env),
    (error) => error.status === 429,
  );
  await pool.query(
    "UPDATE ov_company_ai_requests SET lease_until=clock_timestamp()-INTERVAL '1 second'",
  );
  const recovered = await reserveAssistant(input(), env);
  await finishAssistant(recovered, "success", usage, env);
  await assert.rejects(
    () =>
      reserveAssistant(input("another", "network-a"), {
        ...env,
        COMPANY_AI_IP_DAILY: 2,
      }),
    (error) => error.status === 429,
  );
  console.log(
    "PASS: unknown provider failures retain active protection; expired leases recover without releasing usage budgets",
  );
  const tenant = "isolated-company";
  const storageEnv = {
    ...env,
    SUPPORT_STORAGE: "postgres",
    SUPPORT_DATA_KEY: randomBytes(32).toString("base64"),
  };
  const before = await serverAction(tenant, "workspace", "GET", {}, storageEnv);
  const { mergeProposal, validateExtraction } =
    await import("../src/lib/support/assistant-schema.mjs");
  const nextProfile = mergeProposal(
    before.profile,
    before.profile,
    { company_name: "Reviewed company" },
    ["company_name"],
  );
  await serverAction(tenant, "profile", "PUT", nextProfile, storageEnv);
  const saved = await serverAction(tenant, "workspace", "GET", {}, storageEnv);
  assert.equal(saved.profile.company_name, "Reviewed company");
  assert.deepEqual(saved.profile.office_hours, before.profile.office_hours);
  const payload = (
    await pool.query("SELECT payload FROM ov_workspaces WHERE tenant=$1", [
      tenant,
    ])
  ).rows[0].payload;
  assert.ok(!payload.includes("Reviewed company"));
  assert.throws(() =>
    validateExtraction(
      { in_scope: true, updates: { tenant_id: "victim" }, evidence: {} },
      "anything",
    ),
  );
  assert.equal(
    (
      await pool.query("SELECT payload FROM ov_workspaces WHERE tenant=$1", [
        tenant,
      ])
    ).rows[0].payload,
    payload,
  );
  console.log(
    "PASS: reviewed proposal persists via existing encrypted workspace store; invalid output cannot mutate records",
  );
} catch (e) {
  console.error("PostgreSQL integration failed", {
    name: e.name,
    code: e.code,
    detail: e.message,
    status: e.status,
    assertion: e instanceof assert.AssertionError ? e.message : undefined,
  });
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
  await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  await root.end();
}
