import { sameOrigin, boundedBody } from "@/lib/request-security.mjs";
import { loginLimit } from "@/lib/login-limit";
import { NextResponse } from "next/server";
import * as db from "../../../../lib/db";
import { compare } from "bcrypt";
import { signAuthToken } from "@/lib/auth";

export async function POST(request) {
  if (!process.env.DATABASE_URL && !process.env.NEON_DB_CONNECTION_STRING)
    return NextResponse.json(
      { message: "Accounts are not connected. Use the local workspace." },
      { status: 503 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  try {
    const raw = await boundedBody(request, 16 * 1024);
    const { email, password } = JSON.parse(new TextDecoder().decode(raw));

    // Validate input
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email ||
      !password ||
      email.length > 254 ||
      Buffer.byteLength(password) > 72
    ) {
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400 },
      );
    }

    if (!(await loginLimit(request, email)))
      return NextResponse.json(
        { message: "Too many sign-in attempts. Try again in a minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    // Find user in database
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    const user = result.rows[0];

    // If user doesn't exist
    if (!user || user.is_active === false) {
      return NextResponse.json(
        { message: "Invalid email or password" },
        { status: 401 },
      );
    }

    // Verify password
    try {
      const isValidUser = await compare(password, user.password);

      if (!isValidUser) {
        return NextResponse.json(
          { message: "Invalid email or password" },
          { status: 401 },
        );
      }

      // Update last login time
      try {
        await db.query(
          `UPDATE users SET 
           last_login = NOW() AT TIME ZONE 'Asia/Kolkata', 
           login_count = login_count + 1 
           WHERE email = $1`,
          [email],
        );
      } catch (updateError) {
        console.error("Login metadata update failed", {
          code: updateError.code,
        });
        // Continue with login process even if update fails
      }

      // Create a session token
      const token = await signAuthToken(user);

      // Create the success response first
      const response = NextResponse.json({
        success: true,
        token: token,
      });

      // Set the cookie on the response object
      response.cookies.set("auth_token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24, // 24 hours
        path: "/",
      });

      // Return the response with the cookie attached
      return response;
    } catch (error) {
      console.error("Authentication failed internally");
      return NextResponse.json(
        { message: "Authentication error" },
        { status: 500 },
      );
    }
  } catch (error) {
    if (error.message === "Request too large")
      return NextResponse.json(
        { message: "Request too large" },
        { status: 413 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json({ message: "Invalid request" }, { status: 400 });
    return NextResponse.json(
      { message: "An error occurred during login" },
      { status: 500 },
    );
  }
}
