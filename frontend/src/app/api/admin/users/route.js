import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { verifyAdminSession } from "../../../../lib/admin-session";
import bcrypt from "bcryptjs";

// GET /api/admin/users - Get all users
export async function GET(request) {
  try {
    // Verify authentication
    const token =
      request.cookies?.get("auth_token")?.value ||
      request.headers.get("authorization")?.split(" ")[1];
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await verifyAdminSession(token);
    if (!user || !user.isAdmin) {
      return NextResponse.json(
        { error: "Unauthorized - Admin privileges required" },
        { status: 403 },
      );
    }

    // Get all users
    const result = await query(`
      SELECT id, email, first_name, last_name, phone_number, is_admin, is_active, 
             created_at, updated_at, last_login, login_count
      FROM users
      ORDER BY created_at DESC
    `);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", { code: error.code });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/admin/users - Create a new user
export async function POST(request) {
  try {
    // Verify authentication
    const token =
      request.cookies?.get("auth_token")?.value ||
      request.headers.get("authorization")?.split(" ")[1];
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authUser = await verifyAdminSession(token);
    if (!authUser || !authUser.isAdmin) {
      return NextResponse.json(
        { error: "Unauthorized - Admin privileges required" },
        { status: 403 },
      );
    }

    // Get request body
    const { email, password, firstName, lastName, phoneNumber, isAdmin } =
      await request.json();

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    // Check if user already exists
    const existingUser = await query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (existingUser.rows.length > 0) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 },
      );
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the new user with IST timezone
    const result = await query(
      `INSERT INTO users (
        email, password, first_name, last_name, phone_number, is_admin,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        NOW() AT TIME ZONE 'Asia/Kolkata', NOW() AT TIME ZONE 'Asia/Kolkata'
      ) RETURNING id, email, first_name, last_name, phone_number, is_admin, created_at`,
      [
        email,
        hashedPassword,
        firstName || null,
        lastName || null,
        phoneNumber || null,
        isAdmin || false,
      ],
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Error creating user:", { code: error.code });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
