// Explicit real database audit using a disposable schema and synthetic accounts only.
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  databasePool,
  setSupportPoolForTests,
} from "../src/lib/server/support-store.mjs";
import {
  setupDemoDatabase,
  resetDemoDatabaseForTests,
  reserveDemo,
  demoAllowance,
  protectDemoOperation,
} from "../src/lib/server/demo-protection.mjs";
import { changeVoiceAllowance } from "../src/lib/server/voice-allowance.mjs";
const env = {
  ...process.env,
  ...dotenv.parse(fs.readFileSync(".env.local")),
  PUBLIC_APP_URL: "http://localhost:3000",
  NETLIFY: "true",
  DEMO_SITE_DAILY_LIMIT: "100",
  ELEVENLABS_API_KEY: "",
};
const root = databasePool(env),
  schema = "test_admin_minutes_" + randomUUID().replaceAll("-", "");
let pool;
const admin = randomUUID(),
  user = randomUUID(),
  req = new Request("https://app.test", {
    headers: { "x-nf-client-connection-ip": "192.0.2.20" },
  }),
  member = { id: user, email_verified: true };
async function action(body) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const r = await changeVoiceAllowance(db, admin, { id: user, ...body });
    await db.query("COMMIT");
    return r;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
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
  resetDemoDatabaseForTests();
  await setupDemoDatabase(env);
  await pool.query(
    "ALTER TABLE ov_demo_accounts ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE; CREATE TABLE ov_admin_events(id BIGSERIAL PRIMARY KEY,actor UUID,target UUID,action TEXT,details JSONB,created_at TIMESTAMPTZ DEFAULT clock_timestamp())",
  );
  for (const [id, name] of [
    [admin, "Synthetic administrator"],
    [user, "Synthetic member"],
  ])
    await pool.query(
      "INSERT INTO ov_demo_accounts(id,name,email,email_verified,is_admin) VALUES($1,$2,$3,TRUE,$4)",
      [id, name, id + "@example.com", id === admin],
    );
  // Recreate pre-change defaults and a deliberate admin-assigned ten-minute budget.
  const legacy = randomUUID(),
    custom = randomUUID();
  for (const id of [legacy, custom])
    await pool.query(
      "INSERT INTO ov_demo_accounts(id,name,email,email_verified,voice_budget_seconds) VALUES($1,$2,$3,TRUE,600)",
      [id, id, id + "@example.com"],
    );
  await pool.query(
    "INSERT INTO ov_admin_events(actor,target,action,details) VALUES($1,$2,'set_minutes','{}')",
    [admin, custom],
  );
  await pool.query(
    "DELETE FROM ov_demo_migrations WHERE name='free-five-minutes-v1'",
  );
  resetDemoDatabaseForTests();
  await setupDemoDatabase(env);
  const migrated = (
    await pool.query(
      "SELECT id,voice_budget_seconds FROM ov_demo_accounts WHERE id=ANY($1::uuid[])",
      [[legacy, custom]],
    )
  ).rows;
  assert.equal(migrated.find((a) => a.id === legacy).voice_budget_seconds, 300);
  assert.equal(migrated.find((a) => a.id === custom).voice_budget_seconds, 600);
  await pool.query(
    "UPDATE ov_demo_accounts SET voice_budget_seconds=600 WHERE id=$1",
    [legacy],
  );
  resetDemoDatabaseForTests();
  await setupDemoDatabase(env);
  assert.equal(
    (
      await pool.query(
        "SELECT voice_budget_seconds FROM ov_demo_accounts WHERE id=$1",
        [legacy],
      )
    ).rows[0].voice_budget_seconds,
    600,
  );
  console.log(
    "PASS: one-time default migration changes legacy free budgets, preserves explicit admin allowances and does not repeat",
  );
  const original = await demoAllowance(req, "browser-a", env, member);
  assert.equal(original.max_seconds, 300);
  await pool.query(
    "INSERT INTO ov_demo_sessions(id,account_id,ip_hash,browser_hash,duration_seconds,settled,created_at) VALUES($1,$2,'ip','browser',480,TRUE,clock_timestamp()-INTERVAL '1 hour')",
    [randomUUID(), user],
  );
  assert.equal(
    (await demoAllowance(req, "browser-b", env, member)).max_seconds,
    0,
  );
  await action({ action: "set_minutes", minutes: 30 });
  const increased = await demoAllowance(req, "browser-b", env, member);
  assert.equal(increased.budget_seconds, 1800);
  assert.equal(increased.used_seconds, 480);
  assert.equal(increased.max_seconds, 1320);
  console.log(
    "PASS: free users default to 5 minutes; increasing allowance preserves usage and is enforced server-side",
  );
  const reservation = await reserveDemo(
    req,
    "browser-b",
    env,
    member,
    "synthetic-agent",
  );
  assert.equal(reservation.max_seconds, 600);
  await action({ action: "reset_minutes" });
  const reset = await demoAllowance(req, "browser-b", env, member);
  assert.equal(reset.used_seconds, 0);
  assert.equal(reset.pending_seconds, 600);
  assert.equal(reset.max_seconds, 1200);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT SUM(duration_seconds) AS total FROM ov_demo_sessions WHERE account_id=$1 AND settled",
          [user],
        )
      ).rows[0].total,
    ),
    480,
  );
  await assert.rejects(
    () => reserveDemo(req, "browser-b", env, member, "synthetic-agent"),
    (error) => error.status === 409,
  );
  await protectDemoOperation(req, "browser-b", "agent", 0, env, member);
  console.log(
    "PASS: reset restores consumed allowance, keeps pending calls reserved and preserves confirmed history; publication uses new balance",
  );
  await pool.query(
    "UPDATE ov_demo_sessions SET settled=TRUE,duration_seconds=120 WHERE id=$1",
    [reservation.reservation_id],
  );
  assert.equal(
    (await demoAllowance(req, "browser-b", env, member)).max_seconds,
    1800,
  );
  await action({ action: "set_minutes", minutes: 1 });
  await pool.query(
    "INSERT INTO ov_demo_sessions(id,account_id,ip_hash,browser_hash,duration_seconds,settled) VALUES($1,$2,'ip','browser',60,TRUE)",
    [randomUUID(), user],
  );
  await assert.rejects(
    () => reserveDemo(req, "browser-b", env, member, "synthetic-agent-next"),
    (error) => error.status === 429,
  );
  await action({ action: "reset_minutes" });
  assert.equal(
    (
      await reserveDemo(
        req,
        "browser-b",
        env,
        member,
        "synthetic-agent-after-reset",
      )
    ).max_seconds,
    60,
  );
  console.log(
    "PASS: lowered limits block further spending; reset restores the configured allowance; each call is capped at 10 minutes",
  );
  const before = (
    await pool.query(
      "SELECT voice_budget_seconds,voice_reset_at FROM ov_demo_accounts WHERE id=$1",
      [user],
    )
  ).rows[0];
  await assert.rejects(
    () => action({ action: "set_minutes", minutes: 10000 }),
    (error) => error.status === 422,
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT voice_budget_seconds,voice_reset_at FROM ov_demo_accounts WHERE id=$1",
        [user],
      )
    ).rows[0],
    before,
  );
  const audit = (
    await pool.query(
      "SELECT action,details FROM ov_admin_events WHERE target=$1",
      [user],
    )
  ).rows;
  assert.equal(audit.length, 4);
  assert.ok(
    audit.every(
      (e) => e.details.previous_budget_seconds && e.details.budget_seconds,
    ),
  );
  assert.equal(
    (
      await pool.query("SELECT is_admin FROM ov_demo_accounts WHERE id=$1", [
        user,
      ])
    ).rows[0].is_admin,
    false,
  );
  console.log(
    "PASS: strict validation, immutable user role, and transactional audit history for allowance edits and resets",
  );
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      name: error.name,
      code: error.code,
      status: error.status,
      message:
        error instanceof assert.AssertionError ? error.message : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
  await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  await root.end();
}
