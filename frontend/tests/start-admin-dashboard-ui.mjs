// Real dashboard/routes/middleware/auth against an isolated disposable schema.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setSupportPoolForTests } from "../src/lib/server/support-store.mjs";
import {
  setupDemoDatabase,
  resetDemoDatabaseForTests,
} from "../src/lib/server/demo-protection.mjs";
import { setupAuthSecurity } from "../src/lib/server/auth-guard.mjs";
import { sessionCookie } from "../src/lib/server/demo-accounts.mjs";
import { ADMIN_EMAIL } from "../src/lib/server/admin-policy.mjs";
const source = process.cwd(),
  local = dotenv.parse(fs.readFileSync(".env.local")),
  schema = "test_admin_ui_" + randomBytes(8).toString("hex");
const url = new URL(local.DATABASE_URL || local.NEON_DB_CONNECTION_STRING);
url.hostname = url.hostname.replace("-pooler.", ".");
for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
  url.searchParams.delete(key);
const root = new pg.Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 8000,
});
await root.query(`CREATE SCHEMA ${schema}`);
url.searchParams.set("options", "-c search_path=" + schema);
const pool = new pg.Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 2,
});
setSupportPoolForTests(pool);
resetDemoDatabaseForTests();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnivoice-admin-ui-")),
  secret = randomBytes(48).toString("base64url");
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: "development",
  DATABASE_URL: url.toString(),
  PUBLIC_APP_URL: "http://127.0.0.1:3112",
  NEXTAUTH_URL: "http://127.0.0.1:3112",
  JWT_SECRET: secret,
  NEXTAUTH_SECRET: secret,
  STUDIO_SESSION_SECRET: secret,
  NETLIFY: "false",
  DEMO_PROTECTION_ENABLED: "true",
  ELEVENLABS_API_KEY: "",
};
await setupDemoDatabase(env);
await setupAuthSecurity(env);
await pool.query(
  "ALTER TABLE ov_demo_accounts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;CREATE TABLE ov_admin_events(id BIGSERIAL PRIMARY KEY,actor UUID NOT NULL,target UUID NOT NULL,action TEXT NOT NULL,details JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
);
const adminId = randomUUID(),
  userId = randomUUID();
let admin, user;
for (const [id, name, email, isAdmin] of [
  [adminId, "Synthetic admin", ADMIN_EMAIL, true],
  [userId, "Jamie Example", "jamie.synthetic@example.com", false],
]) {
  const row = (
    await pool.query(
      "INSERT INTO ov_demo_accounts(id,name,email,email_verified,is_admin,voice_budget_seconds) VALUES($1,$2,$3,TRUE,$4,600) RETURNING *",
      [id, name, email, isAdmin],
    )
  ).rows[0];
  if (isAdmin) admin = row;
  else user = row;
}
await pool.query(
  "INSERT INTO ov_demo_sessions(id,account_id,ip_hash,browser_hash,duration_seconds,settled,created_at) VALUES($1,$2,'synthetic','synthetic',222,TRUE,clock_timestamp()-INTERVAL '1 hour')",
  [randomUUID(), userId],
);
const cookie = (
    await sessionCookie(admin, new Request(env.PUBLIC_APP_URL), env)
  ).split(";")[0],
  userCookie = (
    await sessionCookie(user, new Request(env.PUBLIC_APP_URL), env)
  ).split(";")[0];
fs.writeFileSync(
  "/tmp/omnivoice-admin-ui-state.json",
  JSON.stringify({
    root: env.PUBLIC_APP_URL,
    cookie,
    userCookie,
    userId,
    adminId,
    schema,
  }),
  { mode: 0o600 },
);
fs.symlinkSync(
  path.join(source, "node_modules"),
  path.join(dir, "node_modules"),
  "dir",
);
fs.mkdirSync(path.join(dir, "src"));
for (const name of ["components", "lib"])
  fs.symlinkSync(
    path.join(source, "src", name),
    path.join(dir, "src", name),
    "dir",
  );
function write(name, text) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
write(
  "package.json",
  JSON.stringify({
    private: true,
    dependencies: { next: "*", react: "*", "react-dom": "*" },
  }),
);
write(
  "jsconfig.json",
  JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
);
write(
  "next.config.mjs",
  `export default{devIndicators:false,experimental:{externalDir:true},webpack(config){config.resolve.alias['@']=${JSON.stringify(path.join(dir, "src"))};return config;}};`,
);
write(
  "src/app/layout.js",
  `import ${JSON.stringify(path.join(source, "src/app/globals.css"))};export default function Layout({children}){return <html lang="en"><body>{children}</body></html>}`,
);
write(
  "src/app/admin/dashboard/page.js",
  fs.readFileSync(path.join(source, "src/app/admin/dashboard/page.js"), "utf8"),
);
for (const route of ["overview", "accounts"])
  write(
    `src/app/api/admin/${route}/route.js`,
    fs.readFileSync(
      path.join(source, `src/app/api/admin/${route}/route.js`),
      "utf8",
    ),
  );
write(
  "middleware.js",
  fs.readFileSync(path.join(source, "middleware.js"), "utf8"),
);
const child = spawn(
  process.execPath,
  [
    path.join(source, "node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3112",
  ],
  { cwd: dir, env, stdio: "inherit" },
);
console.log(
  "Disposable dashboard starting on port 3112. Synthetic credentials stay in a private temporary file.",
);
let cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  await pool.end();
  await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await root.end();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync("/tmp/omnivoice-admin-ui-state.json", { force: true });
}
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", async () => {
  await cleanup();
  console.log("Disposable schema and credentials removed.");
  process.exit(0);
});
