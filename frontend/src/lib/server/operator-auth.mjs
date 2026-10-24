import { ADMIN_EMAIL } from "./admin-policy.mjs";
import { SignJWT, jwtVerify } from "jose";
import { assertDatabaseManagedRoles } from "./account-role-policy.mjs";
import { databasePool, rateLimit } from "./support-store.mjs";
import { sameOrigin, boundedBody } from "../request-security.mjs";
import { normalizeEmail } from "./auth-email.mjs";
import { verifyPassword } from "./auth-password.mjs";
import {
  beginAuthAttempt,
  finishAuthAttempt,
  guardIdentities,
  setupAuthSecurity,
} from "./auth-guard.mjs";
import {
  mfaStatus,
  createMfaChallenge,
  verifyMfaChallenge,
  challengePrincipal,
  challengeCookie,
  cancelMfaChallenge,
} from "./auth-mfa.mjs";
import { manageMfa } from "./auth-mfa-management.mjs";
import { ApiError } from "./provider.mjs";
export const operatorMfaRequired = (env = process.env) =>
  env.OPERATOR_MFA_REQUIRED === "true" ||
  (env.NODE_ENV === "production" && env.OPERATOR_MFA_REQUIRED !== "false");
async function recordLogin(row, env) {
  try {
    await databasePool(env).query(
      "UPDATE users SET last_login=NOW(),login_count=COALESCE(login_count,0)+1 WHERE id=$1",
      [row.id],
    );
  } catch {
    /* Optional legacy metadata never changes authentication. */
  }
}
const key = (env) => {
  if (
    !env.JWT_SECRET ||
    env.JWT_SECRET.length < 32 ||
    /change-me|replace-with|example/i.test(env.JWT_SECRET)
  )
    throw new ApiError("Operator authentication is not configured.", 503);
  return new TextEncoder().encode(env.JWT_SECRET);
};
export async function operatorCookie(
  row,
  request,
  env = process.env,
  proof = {},
) {
  const token = await new SignJWT({
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin === true,
    authVersion: proof.version || 0,
    enrollmentOnly: proof.enrollmentOnly === true,
    mfaVerified: proof.verified === true,
    auth_time: Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key(env));
  return `auth_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function operatorSession(request, env = process.env) {
  const token = (request.headers.get("cookie") || "").match(
    /(?:^|;\s*)auth_token=([^;]+)/,
  )?.[1];
  if (!token) return null;
  let claims;
  try {
    claims = (await jwtVerify(token, key(env), { algorithms: ["HS256"] }))
      .payload;
  } catch {
    return null;
  }
  if (
    !Number.isSafeInteger(claims.id) ||
    claims.id < 1 ||
    claims.isAdmin !== true
  )
    return null;
  await setupAuthSecurity(env);
  const row = (
    await databasePool(env).query(
      "SELECT * FROM users WHERE id=$1 AND is_active=TRUE AND is_admin=TRUE",
      [claims.id],
    )
  ).rows[0];
  if (!row || row.email?.toLowerCase() !== ADMIN_EMAIL) return null;
  const state = await mfaStatus("operator:" + row.id, env);
  if (
    (claims.authVersion || 0) !== state.version ||
    (state.enabled && claims.mfaVerified !== true)
  )
    return null;
  return { row, state, authenticated_at: claims.auth_time || 0 };
}
const reply = (body, status = 200, cookies = [], retry = 60) => {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  if (status === 429) headers.set("Retry-After", String(retry));
  return Response.json(body, { status, headers });
};
export async function handleOperatorLogin(request, env = process.env) {
  try {
    if (!request.headers.get("origin") || !sameOrigin(request, env))
      throw new ApiError("A same-origin request is required.", 403);
    const raw = await boundedBody(request, 4096),
      body = JSON.parse(new TextDecoder().decode(raw));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError("Invalid request.", 400);
    assertDatabaseManagedRoles(body);
    if (body.action === "mfa-cancel")
      return reply({ ok: true }, 200, [
        await cancelMfaChallenge(request, "operator", env),
      ]);
    if (body.action === "mfa-verify") {
      const principal = await challengePrincipal(request, "operator", env),
        ids = await beginAuthAttempt(request, principal, "operator-mfa", env);
      let success = false;
      try {
        const result = await verifyMfaChallenge(
          request,
          "operator",
          body.code,
          env,
        );
        success = true;
        await recordLogin(result.row, env);
        await finishAuthAttempt(
          guardIdentities(request, result.row.email, "operator", env),
          true,
          env,
        );
        return reply({ success: true }, 200, [
          await operatorCookie(result.row, request, env, {
            version: result.mfaVersion,
            verified: true,
          }),
          challengeCookie(request, "operator", "", 0),
        ]);
      } finally {
        await finishAuthAttempt(ids, success, env);
      }
    }
    const email = normalizeEmail(body.email);
    if (!email) throw new ApiError("Enter a valid email address.", 422);
    const ids = await beginAuthAttempt(request, email, "operator", env);
    let success = false;
    try {
      const row = (
        await databasePool(env).query(
          "SELECT * FROM users WHERE LOWER(email)=$1",
          [email],
        )
      ).rows[0];
      const valid = await verifyPassword(body.password, row?.password);
      if (
        !row ||
        row.email?.toLowerCase() !== ADMIN_EMAIL ||
        row.is_active !== true ||
        row.is_admin !== true ||
        !valid
      )
        throw new ApiError("Invalid email or password.", 401);
      const state = await mfaStatus("operator:" + row.id, env);
      if (state.enabled)
        return reply({ mfa_required: true }, 200, [
          await createMfaChallenge(
            request,
            "operator:" + row.id,
            state.version,
            "password",
            env,
          ),
          `auth_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
        ]);
      success = true;
      await recordLogin(row, env);
      const setupRequired = operatorMfaRequired(env) && !state.enabled;
      return reply({ success: true, setup_required: setupRequired }, 200, [
        await operatorCookie(row, request, env, {
          version: state.version,
          enrollmentOnly: setupRequired,
        }),
      ]);
    } finally {
      await finishAuthAttempt(ids, success, env);
    }
  } catch (error) {
    return reply(
      {
        message:
          error instanceof ApiError
            ? error.message
            : "Operator sign-in is temporarily unavailable.",
      },
      error.status ||
        (error instanceof SyntaxError
          ? 400
          : error.message === "Request too large"
            ? 413
            : 503),
      [],
      error.retryAfter || 60,
    );
  }
}
export async function handleOperatorSecurity(
  request,
  action,
  env = process.env,
) {
  try {
    const session = await operatorSession(request, env);
    if (!session) throw new ApiError("Administrator sign-in required.", 401);
    const principal = "operator:" + session.row.id;
    if (action === "mfa-status" && request.method === "GET")
      return reply({
        mfa: session.state,
        has_password: true,
        required: operatorMfaRequired(env),
      });
    if (request.method !== "POST")
      throw new ApiError("Method not allowed.", 405);
    if (!request.headers.get("origin") || !sameOrigin(request, env))
      throw new ApiError("A same-origin request is required.", 403);
    await rateLimit(principal, "operator-security", 10, env);
    if (
      !["mfa-start", "mfa-enable", "mfa-disable", "mfa-recovery"].includes(
        action,
      )
    )
      throw new ApiError("Not found", 404);
    const body = JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 4096)),
    );
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError("Invalid request.", 400);
    assertDatabaseManagedRoles(body);
    const result = await manageMfa(
      request,
      action,
      body,
      {
        ...session.row,
        password_hash: session.row.password,
        email_verified: true,
        principal,
        authenticated_at: session.authenticated_at,
      },
      env,
    );
    return reply(
      result,
      200,
      action === "mfa-start"
        ? []
        : [
            await operatorCookie(session.row, request, env, {
              version: result.mfa.version,
              verified: result.mfa.enabled,
              enrollmentOnly: operatorMfaRequired(env) && !result.mfa.enabled,
            }),
          ],
    );
  } catch (error) {
    return reply(
      {
        error:
          error instanceof ApiError
            ? error.message
            : "Security settings are temporarily unavailable.",
      },
      error.status || (error instanceof SyntaxError ? 400 : 503),
      [],
      error.retryAfter || 60,
    );
  }
}
