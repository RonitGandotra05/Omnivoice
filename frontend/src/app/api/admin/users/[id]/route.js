import { NextResponse } from "next/server";
import { query } from "../../../../../lib/db";
import { verifyAdminSession } from "../../../../../lib/admin-session";
import { normalizeEmail } from "@/lib/server/auth-email.mjs";
import { hashPassword, validNewPassword } from "@/lib/server/auth-password.mjs";
import { assertDatabaseManagedRoles } from "@/lib/server/account-role-policy.mjs";

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
    const body = await request.json();
    assertDatabaseManagedRoles(body);
    const {
      email: rawEmail,
      password,
      firstName,
      lastName,
      phoneNumber,
      isActive,
    } = body;
    const email = normalizeEmail(rawEmail);

    // Validate input
    if (!email || (password && !validNewPassword(password))) {
      return NextResponse.json(
        {
          error:
            "Enter a valid email and a unique password of 15–128 characters.",
        },
        { status: 422 },
      );
    }

    // Check if user exists
    const existingUser = await query("SELECT * FROM users WHERE id = $1", [id]);
    if (existingUser.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build update query dynamically
    let updateFields = [
      "email = $1",
      "first_name = $2",
      "last_name = $3",
      "phone_number = $4",
      "is_active = $5",
      "updated_at = NOW() AT TIME ZONE 'Asia/Kolkata'",
    ];

    let queryParams = [
      email,
      firstName || null,
      lastName || null,
      phoneNumber || null,
      isActive !== undefined ? isActive : true,
    ];

    // Add password update if provided
    if (password) {
      const hashedPassword = await hashPassword(password);
      updateFields.push(`password = $${queryParams.length + 1}`);
      queryParams.push(hashedPassword);
    }

    // Add ID as the final parameter
    queryParams.push(id);

    // Execute update
    const updatedSql = `UPDATE users SET ${updateFields.join(", ")}
       WHERE id = $${queryParams.length}
       RETURNING id, email, first_name, last_name, phone_number, is_admin, is_active, updated_at`;
    // Revoke sessions and outstanding first-factor challenges atomically when
    // an administrator replaces credentials. The enrolled factor is preserved.
    const credentialsChanged =
      !!password || email !== existingUser.rows[0].email;
    const result = await query(
      credentialsChanged
        ? `WITH updated AS (${updatedSql}), revoked AS (INSERT INTO ov_auth_mfa(principal,version) SELECT 'operator:'||id::text,1 FROM updated ON CONFLICT(principal) DO UPDATE SET version=ov_auth_mfa.version+1 RETURNING principal) SELECT * FROM updated`
        : updatedSql,
      queryParams,
    );

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating user:", { code: error.code });
    return NextResponse.json(
      { error: error.status === 403 ? error.message : "Internal server error" },
      { status: error.status === 403 ? 403 : 500 },
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
