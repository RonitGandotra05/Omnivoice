import test from "node:test";
import assert from "node:assert/strict";
import { readAdminJson } from "../src/lib/server/product-admin.mjs";
import {
  adminRequest,
  replaceConfirmedAccount,
} from "../src/lib/admin-dashboard.mjs";
import {
  providerUsage,
  normalizeProviderUsage,
  resetProviderUsageCacheForTests,
} from "../src/lib/server/provider-usage.mjs";
import {
  listAdminAccounts,
  readAdminActivity,
} from "../src/lib/server/admin-accounts.mjs";
const request = (body, type = "application/json") =>
  new Request("http://localhost/api/admin/accounts", {
    method: "POST",
    headers: { "content-type": type },
    body,
  });
test("admin JSON stream preserves mutations and rejects malformed, empty and oversized bodies", async () => {
  const body = { id: "123", action: "set_minutes", minutes: 20 };
  assert.deepEqual(await readAdminJson(request(JSON.stringify(body))), body);
  for (const [raw, status] of [
    ["", 400],
    ["{", 400],
    ["[]", 422],
    ["null", 422],
  ])
    await assert.rejects(
      readAdminJson(request(raw)),
      (e) => e.status === status,
    );
  await assert.rejects(
    readAdminJson(request("{}", "text/plain")),
    (e) => e.status === 415,
  );
  await assert.rejects(
    readAdminJson(request("x".repeat(4097))),
    /Request too large/,
  );
});
test("client sends a mutation once and uses the confirmed balance", async () => {
  let calls = 0;
  const updated = {
    id: "user",
    voice_usage: {
      budget_seconds: 1200,
      used_seconds: 222,
      remaining_seconds: 978,
    },
  };
  const body = JSON.stringify({ action: "set_minutes", minutes: 20 });
  const result = await adminRequest(
    "accounts",
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
    async (url, opts) => {
      calls++;
      assert.equal(url, "/api/admin/accounts");
      assert.equal(opts.body, body);
      assert.equal(opts.credentials, "same-origin");
      return Response.json({ account: updated });
    },
  );
  assert.equal(calls, 1);
  assert.equal(
    replaceConfirmedAccount({ accounts: [{ id: "user" }] }, result.account)
      .accounts[0].voice_usage.remaining_seconds,
    978,
  );
});
test("client handles empty or non-JSON server responses without exposing raw HTML", async () => {
  for (const response of [
    new Response("<secret>private</secret>", { status: 502 }),
    new Response(""),
  ])
    await assert.rejects(
      adminRequest("accounts", {}, async () => response),
      (e) => !e.message.includes("private") && /server/i.test(e.message),
    );
});
test("provider credits never become an invented remaining-minute balance", () => {
  const v = normalizeProviderUsage({
    tier: "free",
    character_count: 123,
    character_limit: 10000,
  });
  assert.equal(v.credits_remaining, 9877);
  assert.equal(v.remaining_call_minutes, null);
  assert.equal(v.published_free_plan.included_minutes, 15);
  assert.throws(() =>
    normalizeProviderUsage({
      tier: "free",
      character_count: -1,
      character_limit: 100,
    }),
  );
});
test("provider failures are sanitized and cached without leaking credentials", async () => {
  resetProviderUsageCacheForTests();
  let calls = 0;
  const mock = async () => {
    calls++;
    return new Response("secret provider diagnostics", { status: 401 });
  };
  const env = { ELEVENLABS_USAGE_API_KEY: "synthetic-test-key" };
  const a = await providerUsage(env, mock),
    b = await providerUsage(env, mock);
  assert.equal(a.status, "permission_required");
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(a).includes("synthetic-test-key"));
  resetProviderUsageCacheForTests();
  assert.equal(
    (
      await providerUsage(env, async () => {
        throw Error("private");
      })
    ).status,
    "unavailable",
  );
  assert.equal((await providerUsage({}, mock)).status, "not_configured");
});
test("filters and history identifiers are validated before any SQL", async () => {
  const db = {
    query: () => {
      throw Error("must not query");
    },
  };
  await assert.rejects(
    listAdminAccounts(db, { sort: "name; DROP TABLE accounts" }),
    (e) => e.status === 422,
  );
  await assert.rejects(
    listAdminAccounts(db, { status: "invalid" }),
    (e) => e.status === 422,
  );
  await assert.rejects(
    listAdminAccounts(db, { sort: "__proto__" }),
    (e) => e.status === 422,
  );
  await assert.rejects(
    readAdminActivity(db, "invalid"),
    (e) => e.status === 422,
  );
});
