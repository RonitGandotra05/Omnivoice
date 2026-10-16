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
          c.complaint_id,
          c.customer_name,
          c.phone_number,
          c.date_of_complaint,
          c.summary,
          c.transcript,
          c.service
        FROM complaints c
        ORDER BY c.date_of_complaint DESC
        LIMIT 100
      `);

      return NextResponse.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error fetching complaints:", { code: error.code });
    return NextResponse.json(
      { error: "Failed to fetch complaints" },
      { status: 500 },
    );
  }
}
