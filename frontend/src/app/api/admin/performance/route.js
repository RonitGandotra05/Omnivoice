import { NextResponse } from "next/server";
import { verifyToken } from "@/utils/auth";
import { pool } from "@/utils/db";

export async function GET(request) {
  try {
    const token =
      request.cookies?.get("auth_token")?.value ||
      request.headers.get("Authorization")?.split(" ")[1];
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          p.performance_id,
          p.agent_id,
          p.call_handled,
          p.average_handling_time,
          p.first_call_resolution,
          p.customer_satisfaction,
          p.created_at,
          a.name as agent_name
        FROM performance p
        JOIN agents a ON p.agent_id = a.agent_id
        ORDER BY p.created_at DESC
        LIMIT 100
      `);

      return NextResponse.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error fetching performance data:", { code: error.code });
    return NextResponse.json(
      { error: "Failed to fetch performance data" },
      { status: 500 },
    );
  }
}
