import { NextResponse } from "next/server";
import { query } from "../../../../../lib/db";
import { verifyAdminSession } from "../../../../../lib/admin-session";
import bcrypt from "bcryptjs";

// GET /api/admin/users/[id] - Get a specific user
export async function GET(request, { params }) {
  try {
    const { id } = await params;

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

    // Get user by ID
    const result = await query(
      `
      SELECT id, email, first_name, last_name, phone_number, is_admin, is_active, 
             created_at, updated_at, last_login, login_count
      FROM users
      WHERE id = $1
    `,
      [id],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching user:", { code: error.code });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT /api/admin/users/[id] - Update a user
export async function PUT(request, { params }) {
  try {
    const { id } = await params;

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
    const {
      email,
      password,
      firstName,
      lastName,
      phoneNumber,
      isAdmin,
      isActive,
    } = await request.json();

    // Validate input
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Check if user exists
    const existingUser = await query("SELECT * FROM users WHERE id = $1", [id]);
    if (existingUser.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent demoting the last admin
    if (existingUser.rows[0].is_admin && !isAdmin) {
      const adminCount = await query(
        "SELECT COUNT(*) FROM users WHERE is_admin = true",
      );
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return NextResponse.json(
          { error: "Cannot remove admin status from the last admin user" },
          { status: 400 },
        );
      }
    }

    // Build update query dynamically
    let updateFields = [
      "email = $1",
      "first_name = $2",
      "last_name = $3",
      "phone_number = $4",
      "is_admin = $5",
      "is_active = $6",
      "updated_at = NOW() AT TIME ZONE 'Asia/Kolkata'",
    ];

    let queryParams = [
      email,
      firstName || null,
      lastName || null,
      phoneNumber || null,
      isAdmin || false,
      isActive !== undefined ? isActive : true,
    ];

    // Add password update if provided
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push(`password = $${queryParams.length + 1}`);
      queryParams.push(hashedPassword);
    }

    // Add ID as the final parameter
    queryParams.push(id);

    // Execute update
    const result = await query(
      `UPDATE users SET ${updateFields.join(", ")}
       WHERE id = $${queryParams.length}
       RETURNING id, email, first_name, last_name, phone_number, is_admin, is_active, updated_at`,
      queryParams,
    );

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating user:", { code: error.code });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/users/[id] - Delete a user
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

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

    // Check if user exists
    const existingUser = await query("SELECT * FROM users WHERE id = $1", [id]);
    if (existingUser.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent deleting an admin user
    if (existingUser.rows[0].is_admin) {
      return NextResponse.json(
        { error: "Cannot delete admin users" },
        { status: 400 },
      );
    }

    // Delete the user
    await query("DELETE FROM users WHERE id = $1", [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", { code: error.code });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
