import { removeCompanySamples } from "../support/company-draft.mjs";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import pg from "pg";
import {
  freshWorkspace,
  workspaceAction,
} from "../support/workspace-state.mjs";
import { ApiError } from "./provider.mjs";
let pool;
let ready;
export function postgresEnabled(env = process.env) {
  return env.SUPPORT_STORAGE === "postgres";
}
function encryptionKey(env) {
  const raw = env.SUPPORT_DATA_KEY;
  if (!raw)
    throw new ApiError(
      "Configure SUPPORT_DATA_KEY before using server-side workspace storage",
      503,
    );
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new ApiError("SUPPORT_DATA_KEY must encode 32 random bytes", 503);
  return key;
}
export function encryptState(value, tenant, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  cipher.setAAD(Buffer.from("omnivoice-workspace-v1:" + tenant));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptState(value, tenant, env = process.env) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw new ApiError("Invalid encrypted workspace", 503);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(env),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from("omnivoice-workspace-v1:" + tenant));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(data, "base64url")),
        decipher.final(),
      ]).toString(),
    );
  } catch {
    throw new ApiError("Workspace could not be decrypted", 503);
  }
}
export function databasePool(env = process.env) {
  if (!pool) {
    const connectionString = env.DATABASE_URL || env.NEON_DB_CONNECTION_STRING;
    if (!connectionString)
      throw new ApiError("PostgreSQL is not configured", 503);
    const url = new URL(connectionString);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    for (const k of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
      url.searchParams.delete(k);
    pool = new pg.Pool({
      connectionString: url.toString(),
      ssl: local ? false : { rejectUnauthorized: true },
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
  }
  return pool;
}
async function setup(env) {
  ready ||= databasePool(env)
    .query(
      "CREATE TABLE IF NOT EXISTS ov_workspaces (tenant TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS ov_request_limits (key TEXT NOT NULL,bucket BIGINT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key,bucket))",
    )
    .catch((e) => {
      ready = null;
      throw e;
    });
  await ready;
}
export async function transactServer(tenant, operation, env = process.env) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(tenant || ""))
    throw new ApiError("Configure SUPPORT_TENANT_ID", 503);
  encryptionKey(env);
  await setup(env);
  const db = await databasePool(env).connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO ov_workspaces (tenant,payload) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [tenant, encryptState(freshWorkspace(), tenant, env)],
    );
    const row = await db.query(
      "SELECT payload FROM ov_workspaces WHERE tenant=$1 FOR UPDATE",
      [tenant],
    );
    const state = decryptState(row.rows[0].payload, tenant, env);
    const cleaned = removeCompanySamples(state);
    const result = operation(state);
    if (cleaned && result?.profile && Array.isArray(result?.documents))
      result.sample_content_removed = true;
    if (result?.then)
      throw new Error(
        "Transactions must contain synchronous domain operations",
      );
    await db.query(
      "UPDATE ov_workspaces SET payload=$2,updated_at=NOW() WHERE tenant=$1",
      [tenant, encryptState(state, tenant, env)],
    );
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export const serverAction = (
  tenant,
  path,
  method,
  body,
  env = process.env,
  options = {},
) =>
  transactServer(
    tenant,
    (state) =>
      workspaceAction(state, path, method, body, {
        storage: "postgres",
        channel: "phone",
        ...options,
      }),
    env,
  );
const buckets = new Map();
export async function rateLimit(identity, scope, limit, env = process.env) {
  const key = createHash("sha256")
    .update(scope + ":" + identity)
    .digest("hex");
  const bucket = Math.floor(Date.now() / 60000);
  let allowed;
  if (env.DATABASE_URL || env.NEON_DB_CONNECTION_STRING) {
    await setup(env);
    const result = await databasePool(env).query(
      "INSERT INTO ov_request_limits (key,bucket,count) VALUES ($1,$2,1) ON CONFLICT (key,bucket) DO UPDATE SET count=ov_request_limits.count+1 WHERE ov_request_limits.count<$3 RETURNING count",
      [key, bucket, limit],
    );
    allowed = !!result.rowCount;
    await databasePool(env).query(
      "DELETE FROM ov_request_limits WHERE bucket<$1",
      [bucket - 2],
    );
  } else {
    for (const [k, v] of buckets) if (v.bucket !== bucket) buckets.delete(k);
    if (buckets.size >= 10000 && !buckets.has(key))
      throw new ApiError("Request protection is busy", 503);
    const value = buckets.get(key) || { bucket, count: 0 };
    value.count++;
    buckets.set(key, value);
    allowed = value.count <= limit;
  }
  if (!allowed)
    throw new ApiError("Too many requests. Retry in a minute.", 429);
}
export function resetRateLimitsForTests() {
  buckets.clear();
}

export function setSupportPoolForTests(value) {
  pool = value;
  ready = null;
}
