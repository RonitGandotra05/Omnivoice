import fs from "node:fs";
import dotenv from "dotenv";
import { databasePool } from "../src/lib/server/support-store.mjs";
import { ADMIN_EMAIL } from "../src/lib/server/admin-policy.mjs";
const env = {
  ...(fs.existsSync(".env.local")
    ? dotenv.parse(fs.readFileSync(".env.local"))
    : {}),
  ...process.env,
};
const pool = databasePool(env);
const db = await pool.connect();
try {
  await db.query("BEGIN");
  await db.query("LOCK TABLE ov_demo_accounts IN ACCESS EXCLUSIVE MODE");
  const target = await db.query(
    "SELECT id FROM ov_demo_accounts WHERE LOWER(email)=$1 AND active AND email_verified",
    [ADMIN_EMAIL],
  );
  if (target.rowCount !== 1)
    throw Error(
      "Exactly one existing active, verified administrator identity is required; no user was created.",
    );
  await db.query(
    "ALTER TABLE ov_demo_accounts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE",
  );
  await db.query(
    "UPDATE ov_demo_accounts SET is_admin=(id=$1), session_version=session_version+CASE WHEN is_admin<>(id=$1) THEN 1 ELSE 0 END",
    [target.rows[0].id],
  );
  await db.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ov_admin_identity') THEN ALTER TABLE ov_demo_accounts ADD CONSTRAINT ov_admin_identity CHECK (NOT is_admin OR (email='ronitgandotra@gmail.com' AND email_verified AND active)); END IF; END $$`,
  );
  await db.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS ov_single_admin ON ov_demo_accounts(is_admin) WHERE is_admin",
  );
  await db.query(
    "CREATE TABLE IF NOT EXISTS ov_admin_events(id BIGSERIAL PRIMARY KEY,actor UUID NOT NULL, target UUID NOT NULL,action TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS ov_admin_events_created ON ov_admin_events(created_at DESC)",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS ov_demo_sessions_created ON ov_demo_sessions(created_at DESC)",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS ov_demo_accounts_created ON ov_demo_accounts(created_at DESC,id)",
  );
  const admins = await db.query(
    "SELECT email FROM ov_demo_accounts WHERE is_admin",
  );
  if (admins.rowCount !== 1 || admins.rows[0].email !== ADMIN_EMAIL)
    throw Error("Administrator verification failed");
  await db.query("COMMIT");
  console.log(
    JSON.stringify({
      verified: true,
      administrator: admins.rows[0].email,
      count: admins.rowCount,
    }),
  );
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  db.release();
  await pool.end();
}
