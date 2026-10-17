import { Pool } from "pg";

// Verify remote database certificates; local development can use plain loopback.
const configuredUrl =
  process.env.DATABASE_URL || process.env.NEON_DB_CONNECTION_STRING;
let connectionString = configuredUrl;
let ssl = { rejectUnauthorized: true };
if (configuredUrl) {
  const parsed = new URL(configuredUrl);
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) ssl = false;
  // pg otherwise lets URL sslmode overwrite the verified TLS configuration.
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    parsed.searchParams.delete(name);
  connectionString = parsed.toString();
}
export const pool = new Pool({
  connectionString,
  ssl,
  max: 3,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// Helper function to execute SQL queries
export async function query(text, params) {
  if (!configuredUrl) throw new Error("Account database is not configured");
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log("Executed query", { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error("Database query failed", { code: error.code });
    throw error;
  }
}
