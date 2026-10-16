import { NextResponse } from "next/server";
import { verifyAdminSession } from "../../../../lib/admin-session";
import { pool } from "../../../../lib/db";

export async function GET(request) {
  try {
    const token =
      request.cookies?.get("auth_token")?.value ||
      request.headers.get("Authorization")?.split(" ")[1];
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await verifyAdminSession(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          c.conversation_id,
          c.customer_name,
          c.phone_number,
          c.query_type,
          c.interaction_date,
          c.source_id,
          c.service,
          c.summary,
          c.transcript
        FROM conversations c
        ORDER BY c.interaction_date DESC
        LIMIT 100
      `);

      return NextResponse.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error fetching conversations:", { code: error.code });
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}
