const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });

const connectionString = process.env.NEON_DB_CONNECTION_STRING;

if (!connectionString) {
  console.error(
    "❌ Error: NEON_DB_CONNECTION_STRING not found in environment variables.",
  );
  process.exit(1);
}

async function runMigration() {
  const pool = new Pool({ connectionString });

  try {
    console.log("🚀 Starting multi-tenant migration...\n");

    // Read the SQL file
    const sqlPath = path.join(__dirname, "migrate-multi-tenant.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");

    // Execute the migration
    await pool.query(sql);

    console.log("✅ Migration completed successfully!\n");

    // Verify tables were created
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('companies', 'knowledge_documents', 'company_services', 'interactions', 'call_logs', 'api_keys')
      ORDER BY table_name
    `);

    console.log("📋 Created tables:");
    tablesResult.rows.forEach((row) => {
      console.log(`   • ${row.table_name}`);
    });

    console.log("\n🎉 Multi-tenant schema is ready!");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
