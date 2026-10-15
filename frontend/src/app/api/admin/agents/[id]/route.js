import { NextResponse } from "next/server";
import { verifyToken } from "@/utils/auth";
import { pool } from "@/utils/db";

export async function GET(request, { params }) {
  try {
    const token = request.headers.get("Authorization")?.split(" ")[1];
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { id } = await params;
    const client = await pool.connect();
    try {
      const result = await client.query(
        `
        SELECT 
          agent_id,
          name,
          email,
          phone,
          status,
          created_at
        FROM agents
        WHERE agent_id = $1
      `,
        [id],
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }

      return NextResponse.json(result.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error fetching agent details:", error);
    return NextResponse.json(
      { error: "Failed to fetch agent details" },
      { status: 500 },
    );
  }
}
