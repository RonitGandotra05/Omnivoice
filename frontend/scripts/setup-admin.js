// Provision a legacy administrator without default or hardcoded credentials.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
async function main() {
  const { NEON_DB_CONNECTION_STRING, ADMIN_EMAIL, ADMIN_PASSWORD } =
    process.env;
  if (
    !NEON_DB_CONNECTION_STRING ||
    !ADMIN_EMAIL ||
    !ADMIN_PASSWORD ||
    ADMIN_PASSWORD.length < 12
  )
    throw Error(
      "Set NEON_DB_CONNECTION_STRING, ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in the server environment.",
    );
  const pool = new Pool({ connectionString: NEON_DB_CONNECTION_STRING });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,first_name TEXT,last_name TEXT,phone_number TEXT,is_admin BOOLEAN DEFAULT false,is_active BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT NOW(),updated_at TIMESTAMP DEFAULT NOW(),last_login TIMESTAMP,login_count INTEGER DEFAULT 0)`,
    );
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [
      ADMIN_EMAIL,
    ]);
    if (existing.rows.length) {
      console.log("Account already exists; no credentials changed.");
      return;
    }
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query(
      "INSERT INTO users(email,password,is_admin) VALUES($1,$2,true)",
      [ADMIN_EMAIL, hash],
    );
    console.log("Administrator created.");
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
