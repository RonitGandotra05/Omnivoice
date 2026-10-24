import {
  readAdminAccount,
  listAdminAccounts,
  readAdminActivity,
} from "./admin-accounts.mjs";
import { providerUsage } from "./provider-usage.mjs";
import { changeVoiceAllowance } from "./voice-allowance.mjs";
import { setupDemoDatabase } from "./demo-protection.mjs";
import { demoAccount } from "./demo-accounts.mjs";
import { isProductAdmin } from "./admin-policy.mjs";
import { databasePool, rateLimit } from "./support-store.mjs";
import { ApiError } from "./provider.mjs";
import { boundedBody, sameOrigin } from "../request-security.mjs";
import { assertDatabaseManagedRoles } from "./account-role-policy.mjs";

export async function requireProductAdmin(request, env = process.env) {
  const account = await demoAccount(request, env);
  if (!account)
    throw new ApiError("Sign in with your administrator Google account.", 401);
  if (!isProductAdmin(account))
    throw new ApiError("Administrator access required.", 403);
  return account;
}
export async function handleProductAdmin(request, section, env = process.env) {
  const reply = (body, status = 200) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(status === 429 ? { "Retry-After": "60" } : {}),
      },
    });
  try {
    const admin = await requireProductAdmin(request, env);
    await rateLimit(
      admin.id,
      "admin-" + request.method,
      request.method === "GET" ? 120 : 20,
      env,
    );
    await setupDemoDatabase(env);
    const pool = databasePool(env);
    await pool.query(
      "ALTER TABLE ov_admin_events ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb",
    );
    if (request.method === "GET" && section === "overview") {
      const [
        accounts,
        sessions,
        activity,
        security,
        operations,
        audit,
        provider,
      ] = await Promise.all([
        pool.query(
          "SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE active)::int AS active, COUNT(*) FILTER(WHERE email_verified)::int AS verified FROM ov_demo_accounts",
        ),
        pool.query(
          "SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE created_at>NOW()-INTERVAL '24 hours')::int AS today, COUNT(*) FILTER(WHERE NOT settled AND expires_at>NOW())::int AS pending, COALESCE(SUM(duration_seconds) FILTER(WHERE settled),0)::bigint AS confirmed_seconds, COALESCE(SUM(duration_seconds) FILTER(WHERE NOT settled AND expires_at>NOW()),0)::bigint AS reserved_seconds FROM ov_demo_sessions",
        ),
        pool.query(
          "SELECT d.day::date::text AS day,COUNT(s.id)::int AS sessions,COALESCE(SUM(s.duration_seconds) FILTER(WHERE s.settled),0)::int AS seconds FROM generate_series(((NOW() AT TIME ZONE 'UTC')::date-6)::timestamp,((NOW() AT TIME ZONE 'UTC')::date)::timestamp,INTERVAL '1 day') d(day) LEFT JOIN ov_demo_sessions s ON s.created_at>=d.day AT TIME ZONE 'UTC' AND s.created_at<(d.day+INTERVAL '1 day') AT TIME ZONE 'UTC' GROUP BY d.day ORDER BY d.day",
        ),
        pool.query(
          "SELECT event,COUNT(*)::int AS count FROM ov_auth_events WHERE created_at>NOW()-INTERVAL '24 hours' GROUP BY event ORDER BY count DESC",
        ),
        pool.query(
          "SELECT operation,SUM(count)::bigint AS count,SUM(characters)::bigint AS characters FROM ov_demo_operations WHERE day>=CURRENT_DATE-2 GROUP BY operation ORDER BY operation",
        ),
        pool.query(
          "SELECT e.action,e.details,e.created_at,a.email AS target_email FROM ov_admin_events e LEFT JOIN ov_demo_accounts a ON a.id=e.target ORDER BY e.created_at DESC,e.id DESC LIMIT 30",
        ),
        providerUsage(env),
      ]);
      return reply({
        provider_usage: provider,
        accounts: accounts.rows[0],
        sessions: sessions.rows[0],
        activity: activity.rows,
        security: security.rows,
        operations: operations.rows,
        audit: audit.rows,
        integrations: {
          database: "reachable",
          voice: env.ELEVENLABS_API_KEY ? "configured" : "missing",
          google:
            env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
              ? "configured"
              : "missing",
          storage:
            env.SUPPORT_STORAGE === "postgres" ? "connected" : "browser-local",
          email: env.EMAIL_ENABLED === "true" ? "enabled" : "disabled",
          phone: env.NATIVE_CALLS_ENABLED === "true" ? "enabled" : "disabled",
        },
        generated_at: new Date().toISOString(),
      });
    }
    if (request.method === "GET" && section === "accounts") {
      const url = new URL(request.url);
      const page = Math.min(
        10000,
        Math.max(1, Number.parseInt(url.searchParams.get("page"), 10) || 1),
      );
      const search = (url.searchParams.get("search") || "")
        .trim()
        .slice(0, 100);
      if (url.searchParams.has("id"))
        return reply(
          await readAdminActivity(pool, url.searchParams.get("id"), page),
        );
      return reply(
        await listAdminAccounts(pool, {
          page,
          search,
          status: url.searchParams.get("status") || "all",
          sort: url.searchParams.get("sort") || "newest",
        }),
      );
    }
    if (request.method === "POST" && section === "accounts") {
      if (!request.headers.get("origin") || !sameOrigin(request, env))
        throw new ApiError("A same-origin request is required.", 403);
      const body = await readAdminJson(request);
      assertDatabaseManagedRoles(body);
      if (["set_minutes", "reset_minutes"].includes(body?.action)) {
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          const result = await changeVoiceAllowance(db, admin.id, body);
          const updatedAccount = await readAdminAccount(db, body.id);
          await db.query("COMMIT");
          return reply({
            ok: true,
            ...result,
            account: updatedAccount,
            updated_at: new Date().toISOString(),
          });
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        } finally {
          db.release();
        }
      }
      if (
        !body ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.id,
        ) ||
        !["suspend", "restore", "revoke"].includes(body.action) ||
        Object.keys(body).some((k) => !["id", "action"].includes(k))
      )
        throw new ApiError("Choose a valid account and action.", 422);
      if (body.id === admin.id)
        throw new ApiError("Administrator self-modification is disabled.", 403);
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const target = (
          await db.query(
            "SELECT id,is_admin FROM ov_demo_accounts WHERE id=$1 FOR UPDATE",
            [body.id],
          )
        ).rows[0];
        if (!target) throw new ApiError("Account not found.", 404);
        if (target.is_admin)
          throw new ApiError("Administrator modification is disabled.", 403);
        await db.query(
          "UPDATE ov_demo_accounts SET active=CASE WHEN $2='suspend' THEN FALSE WHEN $2='restore' THEN TRUE ELSE active END,session_version=session_version+1 WHERE id=$1",
          [body.id, body.action],
        );
        await db.query("DELETE FROM ov_auth_challenges WHERE principal=$1", [
          "public:" + body.id,
        ]);
        await db.query(
          "INSERT INTO ov_admin_events(actor,target,action) VALUES($1,$2,$3)",
          [admin.id, body.id, body.action],
        );
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally {
        db.release();
      }
      return reply({ ok: true });
    }
    throw new ApiError("Not found.", 404);
  } catch (error) {
    console.error("Admin request failed", {
      status: error.status || 503,
      code: error.code,
    });
    return reply(
      {
        error:
          error instanceof ApiError
            ? error.message
            : error instanceof SyntaxError
              ? "Invalid JSON request."
              : "Administration is temporarily unavailable.",
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

export async function readAdminJson(request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  )
    throw new ApiError("Send account updates as JSON.", 415);
  const raw = await boundedBody(request, 4096, { timeoutMs: 8000 });
  if (!raw?.byteLength)
    throw new ApiError(
      "The account update arrived without a body. Refresh the page and submit it again.",
      400,
    );
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ApiError(
      "The account update is not valid JSON. Refresh the page and submit it again.",
      400,
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiError("Choose a valid account action.", 422);
  return body;
}
