import { NextResponse } from "next/server";
import { pool, query } from "../../../../lib/db";
import { verifyAuthToken } from "../../../../lib/auth";

export async function GET(request) {
  try {
    // Verify authentication
    const token = request.headers.get("authorization")?.split(" ")[1];
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await verifyAuthToken(token);
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Connect to the database
    const client = await pool.connect();

    try {
      // Get total calls (conversations)
      const totalCallsQuery = "SELECT COUNT(*) FROM conversations";
      const totalCallsResult = await client.query(totalCallsQuery);
      const totalCalls = parseInt(totalCallsResult.rows[0].count);

      // Get total complaints
      const complaintsQuery = "SELECT COUNT(*) FROM complaints";
      const complaintsResult = await client.query(complaintsQuery);
      const complaints = parseInt(complaintsResult.rows[0].count);

      // Get total bookings
      const bookingsQuery = "SELECT COUNT(*) FROM bookings";
      const bookingsResult = await client.query(bookingsQuery);
      const bookings = parseInt(bookingsResult.rows[0].count);

      // Get inquiries (estimate based on conversation type or query_type)
      const inquiriesQuery =
        "SELECT COUNT(*) FROM conversations WHERE query_type = 'inquiry'";
      const inquiriesResult = await client.query(inquiriesQuery);
      const inquiries = parseInt(inquiriesResult.rows[0].count);

      // Get total feedback
      const feedbackQuery = "SELECT COUNT(*) FROM feedback";
      const feedbackResult = await client.query(feedbackQuery);
      const feedback = parseInt(feedbackResult.rows[0].count);

      // Compile stats
      const stats = {
        totalCalls,
        complaints,
        bookings,
        inquiries,
        feedback,
      };

      return NextResponse.json(stats);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
