import { randomUUID } from "node:crypto";
import { assertDatabaseManagedRoles } from "./account-role-policy.mjs";
import { SignJWT, jwtVerify } from "jose";
import { getToken } from "next-auth/jwt";
import { hashPassword, verifyPassword } from "./auth-password.mjs";
import { checkEmailDomain } from "./auth-email.mjs";
import {
  beginAuthAttempt,
  finishAuthAttempt,
  guardIdentities,
} from "./auth-guard.mjs";
import {
  mfaStatus,
  createMfaChallenge,
  verifyMfaChallenge,
  challengeCookie,
  challengePrincipal,
  consumeMfaFactor,
  cancelMfaChallenge,
} from "./auth-mfa.mjs";
import { manageMfa } from "./auth-mfa-management.mjs";
import { sendSecurityNotice } from "./auth-notices.mjs";
import { databasePool, rateLimit } from "./support-store.mjs";
import {
  setupDemoDatabase,
  demoIdentities,
  protectDemoOperation,
  demoAllowance,
} from "./demo-protection.mjs";
import { boundedBody, sameOrigin } from "../request-security.mjs";
import { browserOwner, ApiError } from "./provider.mjs";
import {
  accountProviders,
  accountMailEnabled,
  normalizeAccountEmail,
  validAccountPassword,
  accountView,
} from "./account-config.mjs";
import { accountTokenHash, sendAccountLink } from "./account-mail.mjs";
const key = (env) => {
  if (
    !env.JWT_SECRET ||
    env.JWT_SECRET.length < 32 ||
    /change-me|replace-with|example/i.test(env.JWT_SECRET)
  )
    throw new ApiError("Accounts are not configured", 503);
  return new TextEncoder().encode(env.JWT_SECRET);
};
export async function accountRecord(id, version, env = process.env) {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !Number.isInteger(version)
  )
    return null;
  await setupDemoDatabase(env);
  return (
    (
      await databasePool(env).query(
        "SELECT * FROM ov_demo_accounts WHERE id=$1 AND active=TRUE AND session_version=$2",
        [id, version],
      )
    ).rows[0] || null
  );
}
export async function demoAccount(request, env = process.env) {
  const cookie = request.headers.get("cookie") || "";
  try {
    if (
      env.NEXTAUTH_SECRET &&
      /(?:^|;\s*)(?:__Secure-)?next-auth\.session-token(?:\.\d+)?=/.test(cookie)
    ) {
      const cookies = Object.fromEntries(
        cookie.split(";").map((p) => {
          const i = p.indexOf("=");
          return [p.slice(0, i).trim(), p.slice(i + 1)];
        }),
      );
      const token = await getToken({
        req: { cookies, headers: request.headers },
        secret: env.NEXTAUTH_SECRET,
        secureCookie: (
          env.NEXTAUTH_URL ||
          env.PUBLIC_APP_URL ||
          request.url
        ).startsWith("https://"),
      });
      if (token?.provider !== "google") return null;
      if (token?.accountId)
        return authenticatedView(
          await accountRecord(token.accountId, token.accountVersion, env),
          {
            ...token,
            method: token.provider,
            mfa_verified: token.mfaVerified,
            mfa_version: token.mfaVersion,
            auth_time: token.authTime,
          },
          env,
        );
    }
    const token = cookie.match(/(?:^|;\s*)ov_account=([^;]+)/)?.[1];
    if (!token) return null;
    const { payload } = await jwtVerify(token, key(env), {
      algorithms: ["HS256"],
      issuer: "omnivoice",
      audience: "demo-account",
    });
    if (payload.method !== "google") return null;
    return authenticatedView(
      await accountRecord(payload.sub, payload.version ?? 0, env),
      payload,
      env,
    );
  } catch (error) {
    if (
      error.code?.startsWith("ERR_JWT") ||
      error.code?.startsWith("ERR_JWS") ||
      error.code === "ERR_JOSE_ALG_NOT_ALLOWED"
    )
      return null;
    throw new ApiError("Account verification is temporarily unavailable", 503);
  }
}
const secureSuffix = (request) =>
  new URL(request.url).protocol === "https:" ? "; Secure" : "";
async function authenticatedView(row, claims, env) {
  if (!row) return null;
  const state = await mfaStatus("public:" + row.id, env);
  if (
    state.enabled &&
    (claims.mfa_verified !== true || claims.mfa_version !== state.version)
  )
    return null;
  return {
    ...accountView(row),
    mfa_enabled: state.enabled,
    mfa_recovery_remaining: state.recovery_remaining,
    authenticated_at: Number(claims.auth_time) || 0,
  };
}
export async function sessionCookie(row, request, env, proof = {}) {
  const token = await new SignJWT({
    version: row.session_version,
    auth_time: Math.floor(Date.now() / 1000),
    mfa_verified: proof.mfaVerified === true,
    mfa_version: proof.mfaVersion || 0,
    method: proof.method || "google",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(row.id)
    .setIssuer("omnivoice")
    .setAudience("demo-account")
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key(env));
  return `ov_account=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secureSuffix(request)}`;
}
function clearAccountCookies(request, includeManual = true) {
  const names = new Set([
    "ov_account",
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
  ]);
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const name = part.split("=")[0].trim();
    if (/^(?:__Secure-)?next-auth\.session-token\.\d+$/.test(name))
      names.add(name);
  }
  return [...names]
    .filter((name) => includeManual || name !== "ov_account")
    .map(
      (name) =>
        `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureSuffix(request)}`,
    );
}
export async function handleDemoAccount(
  request,
  action,
  env = process.env,
  services = {},
) {
  const checkDomain = services.checkEmailDomain || checkEmailDomain,
    sendLink = services.sendAccountLink || sendAccountLink;
  const notice = services.sendSecurityNotice || sendSecurityNotice;
  const reply = (body, status = 200, cookies = [], retryAfter = 120) => {
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    if (status === 429) headers.set("Retry-After", String(retryAfter));
    return Response.json(body, { status, headers });
  };
  try {
    if (action === "session" && request.method === "GET") {
      const account = await demoAccount(request, env);
      const session = account ? browserOwner(request, env) : null;
      return reply(
        {
          account,
          providers: accountProviders(env),
          email_available: accountMailEnabled(env),
          allowance: account
            ? await demoAllowance(request, session.owner, env, account)
            : null,
        },
        200,
        session?.cookie ? [session.cookie] : [],
      );
    }
    if (request.method !== "POST")
      throw new ApiError("Method not allowed", 405);
    if (!request.headers.get("origin") || !sameOrigin(request, env))
      throw new ApiError("A same-origin request is required", 403);
    if (
      [
        "register",
        "login",
        "password",
        "send-verification",
        "verify-email",
        "reset-request",
        "reset-password",
        "verification-request",
      ].includes(action)
    )
      throw new ApiError(
        "Use Continue with Google to access your account.",
        410,
      );
    if (action === "logout")
      return reply({ ok: true }, 200, clearAccountCookies(request));
    if (
      ![
        "register",
        "login",
        "settings",
        "password",
        "logout-all",
        "send-verification",
        "verify-email",
        "reset-request",
        "reset-password",
        "verification-request",
        "mfa-verify",
        "mfa-cancel",
        "mfa-start",
        "mfa-enable",
        "mfa-disable",
        "mfa-recovery",
      ].includes(action)
    )
      throw new ApiError("Not found", 404);
    const body = JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 4096)),
    );
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError("Invalid request", 400);
    assertDatabaseManagedRoles(body);
    key(env);
    await setupDemoDatabase(env);
    const session = browserOwner(request, env),
      identity = demoIdentities(request, session.owner, env);
    await rateLimit(
      identity.ip,
      "account-" + action,
      action === "register" ? 3 : 10,
      env,
    );
    if (action === "mfa-cancel")
      return reply({ ok: true }, 200, [
        await cancelMfaChallenge(request, "public", env),
      ]);
    if (action === "mfa-verify") {
      const principal = await challengePrincipal(request, "public", env),
        ids = await beginAuthAttempt(request, principal, "public-mfa", env);
      let success = false;
      try {
        const result = await verifyMfaChallenge(
          request,
          "public",
          body.code,
          env,
        );
        if (result.method !== "google")
          throw new ApiError("Sign in with Google again.", 401);
        success = true;
        await finishAuthAttempt(
          guardIdentities(request, result.row.email, "public", env),
          true,
          env,
        );
        await databasePool(env).query(
          "UPDATE ov_demo_accounts SET last_login_at=NOW() WHERE id=$1",
          [result.row.id],
        );
        if (result.recovery) await notice(result.row, "recovery_used", env);
        return reply({ account: accountView(result.row) }, 200, [
          await sessionCookie(result.row, request, env, {
            mfaVerified: true,
            mfaVersion: result.mfaVersion,
            method: result.method,
          }),
          ...clearAccountCookies(request, false),
          challengeCookie(request, "public", "", 0),
        ]);
      } finally {
        await finishAuthAttempt(ids, success, env);
      }
    }
    if (
      ["mfa-start", "mfa-enable", "mfa-disable", "mfa-recovery"].includes(
        action,
      )
    ) {
      const account = await demoAccount(request, env);
      if (!account)
        throw new ApiError(
          "Please sign in to manage your security settings.",
          401,
        );
      const row = (
        await databasePool(env).query(
          "SELECT * FROM ov_demo_accounts WHERE id=$1 AND active=TRUE",
          [account.id],
        )
      ).rows[0];
      const result = await manageMfa(
        request,
        action,
        body,
        {
          ...row,
          authenticated_at: account.authenticated_at,
          principal: "public:" + row.id,
        },
        env,
        notice,
      );
      if (action === "mfa-start") return reply(result);
      row.session_version = result.session_version;
      return reply(
        { mfa: result.mfa, recovery_codes: result.recovery_codes },
        200,
        [
          await sessionCookie(row, request, env, {
            mfaVerified: result.mfa.enabled,
            mfaVersion: result.mfa.version,
          }),
          ...clearAccountCookies(request, false),
        ],
      );
    }
    if (["verify-email", "reset-password"].includes(action)) {
      if (typeof body.token !== "string" || !/^[\w-]{43}$/.test(body.token))
        throw new ApiError("This link is invalid or expired.", 400);
      if (!validAccountPassword(body.password))
        throw new ApiError(
          "Choose a unique password of 15–128 characters (up to 512 bytes).",
          422,
        );
      await beginAuthAttempt(request, body.token, "account-link", env);
      const passwordHash = await hashPassword(body.password);
      let resetEmail;
      const db = await databasePool(env).connect();
      try {
        await db.query("BEGIN");
        const result = await db.query(
          "DELETE FROM ov_account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>NOW() RETURNING account_id",
          [
            accountTokenHash(body.token),
            action === "verify-email" ? "verify" : "reset",
          ],
        );
        if (!result.rowCount)
          throw new ApiError("This link is invalid or expired.", 400);
        if (action === "reset-password") {
          const status = await mfaStatus(
            "public:" + result.rows[0].account_id,
            env,
            db,
          );
          if (status.enabled)
            await consumeMfaFactor(
              db,
              "public:" + result.rows[0].account_id,
              body.code,
              env,
            );
        }
        const updated =
          action === "verify-email"
            ? await db.query(
                "UPDATE ov_demo_accounts SET email_verified=TRUE,password_hash=$2,session_version=session_version+1 WHERE id=$1 AND active=TRUE AND email_verified=FALSE AND password_hash IS NOT NULL RETURNING id",
                [result.rows[0].account_id, passwordHash],
              )
            : await db.query(
                "UPDATE ov_demo_accounts SET password_hash=$2,email_verified=TRUE,session_version=session_version+1 WHERE id=$1 AND active=TRUE AND password_hash IS NOT NULL RETURNING id,email",
                [result.rows[0].account_id, passwordHash],
              );
        if (!updated.rowCount)
          throw new ApiError("This link is invalid or expired.", 400);
        resetEmail = updated.rows[0]?.email;
        await db.query("DELETE FROM ov_account_tokens WHERE expires_at<NOW()");
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
      if (action === "reset-password" && resetEmail) {
        await finishAuthAttempt(
          guardIdentities(request, resetEmail, "public", env),
          true,
          env,
        );
        await notice({ email: resetEmail }, "password_reset", env);
      }
      return reply(
        { ok: true },
        200,
        action === "reset-password" ? clearAccountCookies(request) : [],
      );
    }
    if (
      ["settings", "password", "logout-all", "send-verification"].includes(
        action,
      )
    ) {
      const account = await demoAccount(request, env);
      if (!account)
        throw new ApiError("Please sign in to manage your account.", 401);
      await rateLimit(account.id, "account-" + action, 5, env);
      if (action === "send-verification") {
        if (!account.email_verified) await sendLink(account, "verify", env);
        return reply({ ok: true });
      }
      if (action === "logout-all") {
        await databasePool(env).query(
          "UPDATE ov_demo_accounts SET session_version=session_version+1 WHERE id=$1",
          [account.id],
        );
        return reply({ ok: true }, 200, clearAccountCookies(request));
      }
      let row;
      if (action === "settings") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (
          name.length < 2 ||
          name.length > 100 ||
          !["system", "light", "dark"].includes(body.theme)
        )
          throw new ApiError(
            "Enter your name and choose a valid appearance.",
            422,
          );
        row = (
          await databasePool(env).query(
            "UPDATE ov_demo_accounts SET name=$2,theme=$3 WHERE id=$1 AND active=TRUE RETURNING *",
            [account.id, name, body.theme],
          )
        ).rows[0];
      } else {
        if (
          !validAccountPassword(body.password) ||
          typeof body.current_password !== "string" ||
          Buffer.byteLength(body.current_password) > 512
        )
          throw new ApiError(
            "Choose a unique password of 15–128 characters (up to 512 bytes).",
            422,
          );
        const current = (
          await databasePool(env).query(
            "SELECT * FROM ov_demo_accounts WHERE id=$1 AND active=TRUE",
            [account.id],
          )
        ).rows[0];
        const attempt = await beginAuthAttempt(
          request,
          account.email,
          "public",
          env,
        );
        let accepted = false;
        try {
          const valid = await verifyPassword(
            body.current_password,
            current?.password_hash,
          );
          if (!current?.password_hash || !valid)
            throw new ApiError("Current password is incorrect.", 401);
          const db = await databasePool(env).connect();
          try {
            await db.query("BEGIN");
            if (account.mfa_enabled)
              await consumeMfaFactor(
                db,
                "public:" + account.id,
                body.code,
                env,
              );
            row = (
              await db.query(
                "UPDATE ov_demo_accounts SET password_hash=$2,session_version=session_version+1 WHERE id=$1 AND password_hash=$3 RETURNING *",
                [
                  account.id,
                  await hashPassword(body.password),
                  current.password_hash,
                ],
              )
            ).rows[0];
            if (!row)
              throw new ApiError(
                "Your account changed. Sign in and try again.",
                409,
              );
            await db.query("COMMIT");
          } catch (error) {
            await db.query("ROLLBACK");
            throw error;
          } finally {
            db.release();
          }
          accepted = true;
          await notice(row, "password_changed", env);
        } finally {
          await finishAuthAttempt(attempt, accepted, env);
        }
      }
      if (!row) throw new ApiError("Account unavailable.", 401);
      return reply(
        { account: accountView(row) },
        200,
        action === "password"
          ? [
              await sessionCookie(row, request, env, {
                mfaVerified: account.mfa_enabled,
                mfaVersion: (await mfaStatus("public:" + account.id, env))
                  .version,
              }),
              ...clearAccountCookies(request, false),
            ]
          : [],
      );
    }
    const email = normalizeAccountEmail(body.email);
    if (!email) throw new ApiError("Enter a valid email address.", 422);
    if (action !== "login") await rateLimit(email, "account-" + action, 5, env);
    if (action === "reset-request") {
      if (!accountMailEnabled(env))
        throw new ApiError("Password reset email is not available yet.", 503);
      const row = (
        await databasePool(env).query(
          "SELECT * FROM ov_demo_accounts WHERE LOWER(email)=$1 AND active=TRUE AND password_hash IS NOT NULL",
          [email],
        )
      ).rows[0];
      if (row) {
        try {
          await sendLink(row, "reset", env);
        } catch {
          /* Uniform response prevents account enumeration. */
        }
      }
      return reply({
        ok: true,
        message:
          "If this email has a password account, a reset link will arrive shortly.",
      });
    }
    if (action === "verification-request") {
      if (!accountMailEnabled(env))
        throw new ApiError(
          "Verification email is temporarily unavailable.",
          503,
        );
      const row = (
        await databasePool(env).query(
          "SELECT * FROM ov_demo_accounts WHERE LOWER(email)=$1 AND active=TRUE AND email_verified=FALSE",
          [email],
        )
      ).rows[0];
      if (row) {
        try {
          await sendLink(row, "verify", env);
        } catch {}
      }
      return reply(
        {
          verification_required: true,
          message:
            "If this address can be verified, you will receive an email shortly.",
        },
        202,
      );
    }
    if (action === "register") {
      if (!validAccountPassword(body.password))
        throw new ApiError(
          "Choose a unique password of 15–128 characters (up to 512 bytes). Avoid common passwords.",
          422,
        );
      if (!accountMailEnabled(env))
        throw new ApiError(
          "Email registration is temporarily unavailable. Please use an available sign-in provider or try again later.",
          503,
        );
      await protectDemoOperation(request, session.owner, "account", 0, env);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2 || name.length > 100)
        throw new ApiError("Enter your name (2–100 characters).", 422);
      await checkDomain(email);
      const result = await databasePool(env).query(
        "INSERT INTO ov_demo_accounts(id,name,email,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *",
        [randomUUID(), name, email, await hashPassword(body.password)],
      );
      let row = result.rows[0];
      if (!row)
        row = (
          await databasePool(env).query(
            "SELECT * FROM ov_demo_accounts WHERE LOWER(email)=$1 AND email_verified=FALSE AND active=TRUE",
            [email],
          )
        ).rows[0];
      if (row) {
        try {
          await sendLink(row, "verify", env);
        } catch {}
      }
      return reply(
        {
          verification_required: true,
          message:
            "Check your inbox. If this email can be registered, you will receive a verification link. Already registered? Use your original sign-in method.",
        },
        202,
      );
    }
    const ids = await beginAuthAttempt(request, email, "public", env);
    let success = false;
    try {
      const row = (
        await databasePool(env).query(
          "SELECT * FROM ov_demo_accounts WHERE LOWER(email)=$1 AND active=TRUE",
          [email],
        )
      ).rows[0];
      const valid = await verifyPassword(body.password, row?.password_hash);
      if (!row?.password_hash || !valid)
        throw new ApiError("Invalid email or password.", 401);
      if (!row.email_verified)
        throw new ApiError(
          "Verify your email before signing in. You can request a new verification email.",
          403,
        );
      const state = await mfaStatus("public:" + row.id, env);
      if (state.enabled) {
        const cookie = await createMfaChallenge(
          request,
          "public:" + row.id,
          row.session_version,
          "password",
          env,
        );
        return reply({ mfa_required: true }, 200, [
          cookie,
          ...clearAccountCookies(request),
        ]);
      }
      success = true;
      await databasePool(env).query(
        "UPDATE ov_demo_accounts SET last_login_at=NOW() WHERE id=$1",
        [row.id],
      );
      return reply({ account: accountView(row) }, 200, [
        await sessionCookie(row, request, env),
        ...clearAccountCookies(request, false),
        ...(session.cookie ? [session.cookie] : []),
      ]);
    } finally {
      await finishAuthAttempt(ids, success, env);
    }
  } catch (error) {
    return reply(
      {
        error:
          error instanceof ApiError
            ? error.message
            : "Account service is temporarily unavailable",
      },
      error.status ||
        (error instanceof SyntaxError
          ? 400
          : error.message === "Request too large"
            ? 413
            : 503),
      [],
      error.retryAfter || 120,
    );
  }
}
