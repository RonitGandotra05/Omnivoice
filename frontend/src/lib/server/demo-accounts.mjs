import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { hash, compare } from "bcryptjs";
import { databasePool, rateLimit } from "./support-store.mjs";
import {
  setupDemoDatabase,
  demoIdentities,
  protectDemoOperation,
} from "./demo-protection.mjs";
import { boundedBody, sameOrigin } from "../request-security.mjs";
import { browserOwner, ApiError } from "./provider.mjs";
const key = (env) => {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32)
    throw new ApiError("Accounts are not configured", 503);
  return new TextEncoder().encode(env.JWT_SECRET);
};
export async function demoAccount(request, env = process.env) {
  const token = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)ov_account=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(env), {
      algorithms: ["HS256"],
      issuer: "omnivoice",
      audience: "demo-account",
    });
    await setupDemoDatabase(env);
    const r = await databasePool(env).query(
      "SELECT id,name,email,extended_access FROM ov_demo_accounts WHERE id=$1 AND active=TRUE",
      [payload.sub],
    );
    return r.rows[0] || null;
  } catch (error) {
    if (error.code?.startsWith("ERR_JWT") || error.code?.startsWith("ERR_JWS"))
      return null;
    throw new ApiError("Account verification is temporarily unavailable", 503);
  }
}
export async function handleDemoAccount(request, action, env = process.env) {
  const reply = (body, status = 200, headers = {}) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store", ...headers },
    });
  try {
    if (action === "session" && request.method === "GET")
      return reply({ account: await demoAccount(request, env) });
    if (request.method !== "POST")
      throw new ApiError("Method not allowed", 405);
    if (!request.headers.get("origin") || !sameOrigin(request))
      throw new ApiError("A same-origin request is required", 403);
    if (action === "logout")
      return reply({ ok: true }, 200, {
        "Set-Cookie":
          "ov_account=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure",
      });
    if (!["register", "login"].includes(action))
      throw new ApiError("Not found", 404);
    key(env);
    await setupDemoDatabase(env);
    const session = browserOwner(request, env);
    const identity = demoIdentities(request, session.owner, env);
    await rateLimit(
      identity.ip,
      "account-" + action,
      action === "register" ? 3 : 10,
      env,
    );
    const body = JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 4096)),
    );
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      typeof password !== "string" ||
      password.length < 12 ||
      Buffer.byteLength(password) > 72
    )
      throw new ApiError(
        "Use a valid email and a password of 12–72 bytes.",
        422,
      );
    await rateLimit(email, "account-" + action, 5, env);
    let account;
    if (action === "register") {
      await protectDemoOperation(request, session.owner, "account", 0, env);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2 || name.length > 100)
        throw new ApiError("Enter your name (2–100 characters).", 422);
      // Registration never accepts role, entitlement or active status from the browser.
      const result = await databasePool(env).query(
        "INSERT INTO ov_demo_accounts (id,name,email,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,name,email,extended_access",
        [randomUUID(), name, email, await hash(password, 12)],
      );
      if (!result.rowCount)
        throw new ApiError(
          "Unable to create an account with those details. Try signing in.",
          409,
        );
      account = result.rows[0];
    } else {
      const result = await databasePool(env).query(
        "SELECT * FROM ov_demo_accounts WHERE email=$1 AND active=TRUE",
        [email],
      );
      const candidate = result.rows[0];
      // A fixed valid bcrypt hash keeps absent-account checks comparably expensive.
      const valid = await compare(
        password,
        candidate?.password_hash ||
          "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
      );
      if (!candidate || !valid)
        throw new ApiError("Invalid email or password.", 401);
      account = {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        extended_access: candidate.extended_access,
      };
    }
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(account.id)
      .setIssuer("omnivoice")
      .setAudience("demo-account")
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(key(env));
    return reply({ account }, 200, {
      "Set-Cookie": `ov_account=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    });
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
