import { NextResponse } from "next/server";
import { verifyToken } from "@/utils/auth";
import { pool } from "@/utils/db";

export async function GET(request) {
  try {
    const token = request.headers.get("Authorization")?.split(" ")[1];
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
          agent_id,
          name,
          email,
          phone,
          status,
          created_at
        FROM agents
        ORDER BY created_at DESC
      `);

      return NextResponse.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error fetching agents:", error);
    return NextResponse.json(
      { error: "Failed to fetch agents" },
      { status: 500 },
    );
  }
}
