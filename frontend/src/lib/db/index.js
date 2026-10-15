import { Pool } from "pg";

// Use the connection string from the environment variables
export const pool = new Pool({
  connectionString: process.env.NEON_DB_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false, // Required for some PostgreSQL providers
  },
});

// Helper function to execute SQL queries
export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log("Executed query", { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error("Error executing query", { text, error });
    throw error;
  }
}
