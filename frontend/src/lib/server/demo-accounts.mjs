import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getToken } from "next-auth/jwt";
import { hash, compare } from "bcryptjs";
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
const dummyHash =
  "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
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
      if (token?.accountId)
        return accountView(
          await accountRecord(token.accountId, token.accountVersion, env),
        );
    }
    const token = cookie.match(/(?:^|;\s*)ov_account=([^;]+)/)?.[1];
    if (!token) return null;
    const { payload } = await jwtVerify(token, key(env), {
      algorithms: ["HS256"],
      issuer: "omnivoice",
      audience: "demo-account",
    });
    return accountView(
      await accountRecord(payload.sub, payload.version ?? 0, env),
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
async function sessionCookie(row, request, env) {
  const token = await new SignJWT({ version: row.session_version })
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
export async function handleDemoAccount(request, action, env = process.env) {
  const reply = (body, status = 200, cookies = []) => {
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    if (status === 429) headers.set("Retry-After", "120");
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
      ].includes(action)
    )
      throw new ApiError("Not found", 404);
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
    const body = JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 4096)),
    );
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError("Invalid request", 400);
    if (["verify-email", "reset-password"].includes(action)) {
      if (typeof body.token !== "string" || !/^[\w-]{43}$/.test(body.token))
        throw new ApiError("This link is invalid or expired.", 400);
      if (action === "reset-password" && !validAccountPassword(body.password))
        throw new ApiError(
          "Use a password of at least 12 characters and at most 72 bytes.",
          422,
        );
      const passwordHash =
        action === "reset-password" ? await hash(body.password, 12) : null;
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
        const updated =
          action === "verify-email"
            ? await db.query(
                "UPDATE ov_demo_accounts SET email_verified=TRUE WHERE id=$1 AND active=TRUE RETURNING id",
                [result.rows[0].account_id],
              )
            : await db.query(
                "UPDATE ov_demo_accounts SET password_hash=$2,email_verified=TRUE,session_version=session_version+1 WHERE id=$1 AND active=TRUE AND password_hash IS NOT NULL RETURNING id",
                [result.rows[0].account_id, passwordHash],
              );
        if (!updated.rowCount)
          throw new ApiError("This link is invalid or expired.", 400);
        await db.query("DELETE FROM ov_account_tokens WHERE expires_at<NOW()");
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
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
        if (!account.email_verified)
          await sendAccountLink(account, "verify", env);
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
          Buffer.byteLength(body.current_password) > 72
        )
          throw new ApiError(
            "Use a password of at least 12 characters and at most 72 bytes.",
            422,
          );
        const current = (
          await databasePool(env).query(
            "SELECT * FROM ov_demo_accounts WHERE id=$1 AND active=TRUE",
            [account.id],
          )
        ).rows[0];
        const valid = await compare(
          body.current_password,
          current?.password_hash || dummyHash,
        );
        if (!current?.password_hash || !valid)
          throw new ApiError("Current password is incorrect.", 401);
        row = (
          await databasePool(env).query(
            "UPDATE ov_demo_accounts SET password_hash=$2,session_version=session_version+1 WHERE id=$1 AND password_hash=$3 RETURNING *",
            [account.id, await hash(body.password, 12), current.password_hash],
          )
        ).rows[0];
        if (!row)
          throw new ApiError(
            "Your account changed. Sign in and try again.",
            409,
          );
      }
      if (!row) throw new ApiError("Account unavailable.", 401);
      return reply(
        { account: accountView(row) },
        200,
        action === "password"
          ? [
              await sessionCookie(row, request, env),
              ...clearAccountCookies(request, false),
            ]
          : [],
      );
    }
    const email = normalizeAccountEmail(body.email);
    if (!email) throw new ApiError("Enter a valid email address.", 422);
    await rateLimit(email, "account-" + action, 5, env);
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
          await sendAccountLink(row, "reset", env);
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
    if (!validAccountPassword(body.password))
      throw new ApiError(
        "Use a password of at least 12 characters and at most 72 bytes.",
        422,
      );
    let row,
      verification_sent = false;
    if (action === "register") {
      await protectDemoOperation(request, session.owner, "account", 0, env);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2 || name.length > 100)
        throw new ApiError("Enter your name (2–100 characters).", 422);
      const result = await databasePool(env).query(
        "INSERT INTO ov_demo_accounts(id,name,email,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *",
        [randomUUID(), name, email, await hash(body.password, 12)],
      );
      if (!result.rowCount)
        throw new ApiError(
          "Unable to create an account with those details. Try your original sign-in method.",
          409,
        );
      row = result.rows[0];
      if (accountMailEnabled(env)) {
        try {
          await sendAccountLink(row, "verify", env);
          verification_sent = true;
        } catch {
          /* Account remains usable; settings offers an explicit retry. */
        }
      }
    } else {
      const candidate = (
        await databasePool(env).query(
          "SELECT * FROM ov_demo_accounts WHERE LOWER(email)=$1 AND active=TRUE",
          [email],
        )
      ).rows[0];
      const valid = await compare(
        body.password,
        candidate?.password_hash || dummyHash,
      );
      if (!candidate?.password_hash || !valid)
        throw new ApiError("Invalid email or password.", 401);
      row = candidate;
      await databasePool(env).query(
        "UPDATE ov_demo_accounts SET last_login_at=NOW() WHERE id=$1",
        [row.id],
      );
    }
    return reply({ account: accountView(row), verification_sent }, 200, [
      await sessionCookie(row, request, env),
      ...clearAccountCookies(request, false),
      ...(session.cookie ? [session.cookie] : []),
    ]);
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
    );
  }
}
