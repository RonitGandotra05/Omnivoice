import { z } from "zod";
import { ApiError } from "./provider.mjs";
import { voiceUsageView } from "./voice-allowance.mjs";
const accountSelect = `SELECT a.id,a.name,a.email,a.active,a.email_verified,a.is_admin,a.created_at,a.last_login_at,a.voice_budget_seconds,a.voice_reset_at,COALESCE(m.enabled,FALSE) AS mfa_enabled,
 COALESCE(u.used_seconds,0)::int AS used_seconds,COALESCE(u.pending_seconds,0)::int AS pending_seconds,COALESCE(u.retained_seconds,0)::int AS retained_seconds,COALESCE(u.call_count,0)::int AS call_count,u.last_call_at
 FROM ov_demo_accounts a LEFT JOIN ov_auth_mfa m ON m.principal='public:'||a.id::text
 LEFT JOIN LATERAL(SELECT SUM(duration_seconds) FILTER(WHERE settled AND expires_at>NOW() AND created_at>=COALESCE(a.voice_reset_at,'-infinity'::timestamptz)) AS used_seconds,
 SUM(duration_seconds) FILTER(WHERE NOT settled AND expires_at>NOW()) AS pending_seconds,
 SUM(duration_seconds) FILTER(WHERE settled) AS retained_seconds,COUNT(*) AS call_count,MAX(created_at) AS last_call_at FROM ov_demo_sessions WHERE account_id=a.id) u ON TRUE`;
export const accountViewWithUsage = (row) => ({
  ...row,
  voice_usage: voiceUsageView(row, row),
});
export async function readAdminAccount(db, id) {
  if (!z.uuid().safeParse(id).success)
    throw new ApiError("Choose a valid user.", 422);
  const row = (await db.query(accountSelect + " WHERE a.id=$1", [id])).rows[0];
  if (!row) throw new ApiError("Account not found.", 404);
  return accountViewWithUsage(row);
}
export async function listAdminAccounts(
  db,
  { page = 1, search = "", status = "all", sort = "newest" },
) {
  const orders = {
    newest: "a.created_at DESC,a.id",
    name: "LOWER(a.name),a.id",
    usage: "COALESCE(u.retained_seconds,0) DESC,a.id",
    recent: "u.last_call_at DESC NULLS LAST,a.id",
  };
  const filters = {
    all: "TRUE",
    active: "a.active",
    suspended: "NOT a.active",
    unverified: "NOT a.email_verified",
    exhausted:
      "COALESCE(u.used_seconds,0)+COALESCE(u.pending_seconds,0)>=a.voice_budget_seconds",
  };
  if (!Object.hasOwn(orders, sort) || !Object.hasOwn(filters, status))
    throw new ApiError("Choose a valid user filter.", 422);
  const order = orders[sort],
    where = filters[status];
  const result = await db.query(
    accountSelect +
      ` WHERE ($2='' OR strpos(lower(a.name),lower($2))>0 OR strpos(lower(a.email),lower($2))>0) AND ${where} ORDER BY ${order} LIMIT 26 OFFSET $1`,
    [(page - 1) * 25, search],
  );
  return {
    accounts: result.rows.slice(0, 25).map(accountViewWithUsage),
    has_more: result.rows.length > 25,
    page,
  };
}
export async function readAdminActivity(db, id, page = 1) {
  const account = await readAdminAccount(db, id);
  const calls = await db.query(
    "SELECT id,created_at,expires_at,duration_seconds,settled,conversation_id FROM ov_demo_sessions WHERE account_id=$1 ORDER BY created_at DESC,id LIMIT 26 OFFSET $2",
    [id, (page - 1) * 25],
  );
  return {
    account,
    sessions: calls.rows.slice(0, 25).map((row) => ({
      ...row,
      status: row.settled
        ? "confirmed"
        : new Date(row.expires_at) <= new Date()
          ? "expired"
          : "pending verification",
    })),
    has_more: calls.rows.length > 25,
    page,
    history_note:
      "Recorded calls in retained application history. Earlier records may have expired; this is not a lifetime billing total.",
  };
}
