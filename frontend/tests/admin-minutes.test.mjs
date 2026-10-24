import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  VoiceAllowanceAction,
  voiceUsageView,
  changeVoiceAllowance,
} from "../src/lib/server/voice-allowance.mjs";
import { allowanceFromUsage } from "../src/lib/server/demo-protection.mjs";
import { handleProductAdmin } from "../src/lib/server/product-admin.mjs";
import {
  isProductAdmin,
  ADMIN_EMAIL,
} from "../src/lib/server/admin-policy.mjs";
test("only bounded, whole-minute, strict admin commands are accepted", () => {
  const id = randomUUID();
  for (const body of [
    { id, action: "set_minutes", minutes: 1 },
    { id, action: "set_minutes", minutes: 240 },
    { id, action: "reset_minutes" },
  ])
    assert.equal(VoiceAllowanceAction.safeParse(body).success, true);
  for (const body of [
    { id, action: "set_minutes", minutes: 0 },
    { id, action: "set_minutes", minutes: 241 },
    { id, action: "set_minutes", minutes: 1.5 },
    { id, action: "set_minutes", minutes: "30" },
    { id, action: "set_minutes", minutes: Infinity },
    { id, action: "reset_minutes", minutes: 20 },
    { id, action: "set_minutes", minutes: 30, is_admin: true },
    { id, action: "reset_minutes", voice_budget_seconds: 999999 },
    { id: "other", action: "reset_minutes" },
  ])
    assert.equal(VoiceAllowanceAction.safeParse(body).success, false);
});
test("usage view separates consumed, pending and available minutes", () => {
  assert.deepEqual(
    voiceUsageView(
      { voice_budget_seconds: 1800 },
      { used_seconds: 300, pending_seconds: 600 },
    ),
    {
      budget_seconds: 1800,
      used_seconds: 300,
      pending_seconds: 600,
      remaining_seconds: 900,
      reset_at: null,
    },
  );
  assert.equal(
    voiceUsageView(
      { voice_budget_seconds: 60 },
      { used_seconds: 120, pending_seconds: 600 },
    ).remaining_seconds,
    0,
  );
  const a = allowanceFromUsage(
    { used_seconds: 900, pending_seconds: 600 },
    {
      id: randomUUID(),
      email_verified: true,
      active: true,
      voice_budget_seconds: 1800,
    },
  );
  assert.equal(a.budget_seconds, 1800);
  assert.equal(a.used_seconds, 300);
  assert.equal(a.pending_seconds, 600);
  assert.equal(a.max_seconds, 900);
  assert.equal(
    allowanceFromUsage(
      {},
      {
        id: randomUUID(),
        email_verified: true,
        active: false,
        voice_budget_seconds: 1800,
      },
    ).available,
    false,
  );
});
test("invalid minute commands do not reach the database", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      changeVoiceAllowance(
        {
          query: async () => {
            calls++;
          },
        },
        randomUUID(),
        { id: randomUUID(), action: "set_minutes", minutes: 999999 },
      ),
    (e) => e.status === 422,
  );
  assert.equal(calls, 0);
});
test("canonical verified database-admin policy protects all minute operations", async () => {
  assert.equal(
    isProductAdmin({
      email: ADMIN_EMAIL,
      email_verified: true,
      is_admin: true,
    }),
    true,
  );
  for (const account of [
    { email: ADMIN_EMAIL, email_verified: true },
    { email: "forged@example.com", email_verified: true, is_admin: true },
    { email: ADMIN_EMAIL, email_verified: false, is_admin: true },
  ])
    assert.equal(isProductAdmin(account), false);
  for (const action of ["set_minutes", "reset_minutes"]) {
    const r = await handleProductAdmin(
      new Request("http://localhost:3000/api/admin/accounts", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: randomUUID(), action, minutes: 30 }),
      }),
      "accounts",
      {},
    );
    assert.equal(r.status, 401);
  }
});

test("free default is five minutes while the separate maximum call length stays ten", async () => {
  const { ACCOUNT_DEMO_SECONDS, MAX_DEMO_CALL_SECONDS } =
    await import("../src/lib/demo-limits.mjs");
  assert.equal(ACCOUNT_DEMO_SECONDS, 300);
  assert.equal(MAX_DEMO_CALL_SECONDS, 600);
  assert.equal(
    allowanceFromUsage({}, { id: randomUUID(), email_verified: true })
      .max_seconds,
    300,
  );
});
