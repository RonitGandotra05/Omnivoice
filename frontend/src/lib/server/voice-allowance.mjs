import { z } from "zod";
import { ApiError } from "./provider.mjs";
import { ACCOUNT_DEMO_SECONDS } from "../demo-limits.mjs";
export const VoiceAllowanceAction = z
  .object({
    id: z.uuid(),
    action: z.enum(["set_minutes", "reset_minutes"]),
    minutes: z.number().int().min(1).max(240).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === "set_minutes") !== (v.minutes !== undefined))
      ctx.addIssue({
        code: "custom",
        message:
          "Set an allowance of 1–240 whole minutes, or reset without an amount.",
      });
  });
export function voiceUsageView(account, usage = {}) {
  const budget = Number(account?.voice_budget_seconds ?? ACCOUNT_DEMO_SECONDS),
    used = Math.max(0, Number(usage.used_seconds) || 0),
    pending = Math.max(0, Number(usage.pending_seconds) || 0);
  return {
    budget_seconds: budget,
    used_seconds: used,
    pending_seconds: pending,
    remaining_seconds: Math.max(0, budget - used - pending),
    reset_at: account?.voice_reset_at || null,
  };
}
export async function voiceBudgetAccount(db, id) {
  return (
    await db.query(
      "SELECT id,active,email_verified,voice_budget_seconds,voice_reset_at FROM ov_demo_accounts WHERE id=$1",
      [id],
    )
  ).rows[0];
}
// Keep pending reservations from before a reset charged until they settle. Reset
// never deletes provider/billing history or bypasses site/network spending guards.
export const accountBudgetFilter = `(account_id=$3 AND (created_at>=COALESCE((SELECT voice_reset_at FROM ov_demo_accounts WHERE id=$3),'-infinity'::timestamptz) OR NOT settled) OR (account_id IS NULL AND (ip_hash=$1 OR browser_hash=$2)))`;
export async function changeVoiceAllowance(db, adminId, body) {
  const parsed = VoiceAllowanceAction.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      "Choose a valid account and an allowance of 1–240 whole minutes.",
      422,
    );
  const v = parsed.data;
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('omnivoice-demo-budget-v1'))",
  );
  const target = (
    await db.query(
      "SELECT id,is_admin,voice_budget_seconds,voice_reset_at FROM ov_demo_accounts WHERE id=$1 FOR UPDATE",
      [v.id],
    )
  ).rows[0];
  if (!target) throw new ApiError("Account not found.", 404);
  // Ronit may manage his own minutes; role, suspension and credentials are unchanged.
  if (target.is_admin && target.id !== adminId)
    throw new ApiError(
      "Another administrator's allowance cannot be changed.",
      403,
    );
  const result = (
    await db.query(
      "UPDATE ov_demo_accounts SET voice_budget_seconds=CASE WHEN $2='set_minutes' THEN $3::integer*60 ELSE voice_budget_seconds END,voice_reset_at=CASE WHEN $2='reset_minutes' THEN clock_timestamp() ELSE voice_reset_at END WHERE id=$1 RETURNING voice_budget_seconds,voice_reset_at",
      [v.id, v.action, v.minutes ?? null],
    )
  ).rows[0];
  await db.query(
    "INSERT INTO ov_admin_events(actor,target,action,details) VALUES($1,$2,$3,$4::jsonb)",
    [
      adminId,
      v.id,
      v.action,
      JSON.stringify({
        previous_budget_seconds: target.voice_budget_seconds,
        budget_seconds: result.voice_budget_seconds,
        previous_reset_at: target.voice_reset_at,
        reset_at: result.voice_reset_at,
      }),
    ],
  );
  return result;
}
