// Create a regular account. Elevation is available only through a manual DB edit.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

async function main() {
  const { hashPassword, validNewPassword } =
    await import("../src/lib/server/auth-password.mjs");
  const { normalizeEmail } = await import("../src/lib/server/auth-email.mjs");
  const { NEON_DB_CONNECTION_STRING, USER_EMAIL, USER_PASSWORD } = process.env;
  if (
    !NEON_DB_CONNECTION_STRING ||
    !USER_EMAIL ||
    !USER_PASSWORD ||
    !validNewPassword(USER_PASSWORD) ||
    !normalizeEmail(USER_EMAIL)
  )
    throw Error(
      "Set NEON_DB_CONNECTION_STRING, USER_EMAIL and USER_PASSWORD (a unique passphrase of 15–128 characters) in the server environment.",
    );
  const url = new URL(NEON_DB_CONNECTION_STRING);
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(key);
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: ["127.0.0.1", "localhost"].includes(url.hostname)
      ? false
      : { rejectUnauthorized: true },
    max: 1,
  });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,first_name TEXT,last_name TEXT,phone_number TEXT,is_admin BOOLEAN NOT NULL DEFAULT false,is_active BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT NOW(),updated_at TIMESTAMP DEFAULT NOW(),last_login TIMESTAMP,login_count INTEGER DEFAULT 0)`,
    );
    const existing = await pool.query(
      "SELECT id FROM users WHERE LOWER(email)=$1",
      [normalizeEmail(USER_EMAIL)],
    );
    if (existing.rows.length) {
      console.log("Account already exists; no credentials changed.");
      return;
    }
    const hash = await hashPassword(USER_PASSWORD);
    await pool.query(
      "INSERT INTO users(email,password,is_admin) VALUES($1,$2,FALSE)",
      [normalizeEmail(USER_EMAIL), hash],
    );
    console.log(
      "Regular user created. Roles can only be changed directly in the database.",
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
