import fs from "node:fs";
import assert from "node:assert/strict";
const { root, cookie, userCookie, userId } = JSON.parse(
  fs.readFileSync("/tmp/omnivoice-admin-ui-state.json"),
);
let checks = 0;
async function req(
  path = "",
  {
    status = 200,
    method = "GET",
    data,
    raw,
    auth = cookie,
    origin = root,
  } = {},
) {
  const r = await fetch(root + "/api/admin/" + path, {
    method,
    headers: { cookie: auth, origin, "content-type": "application/json" },
    body: raw ?? (data ? JSON.stringify(data) : undefined),
    signal: AbortSignal.timeout(20000),
  });
  const body = await r.json();
  assert.equal(r.status, status, JSON.stringify(body));
  checks++;
  return body;
}
let users = await req("accounts");
let user = users.accounts.find((a) => a.id === userId);
assert.equal(user.voice_usage.remaining_seconds, 378);
const saved = await req("accounts", {
  method: "POST",
  data: { id: userId, action: "set_minutes", minutes: 20 },
});
assert.equal(saved.account.voice_usage.remaining_seconds, 978);
assert.equal(saved.account.voice_usage.budget_seconds, 1200);
users = await req("accounts?search=jamie&status=active&sort=usage");
assert.equal(users.accounts.length, 1);
assert.equal(users.accounts[0].voice_usage.remaining_seconds, 978);
let history = await req("accounts?id=" + userId);
assert.equal(history.sessions.length, 1);
assert.equal(history.sessions[0].duration_seconds, 222);
let reset = await req("accounts", {
  method: "POST",
  data: { id: userId, action: "reset_minutes" },
});
assert.equal(reset.account.voice_usage.remaining_seconds, 1200);
history = await req("accounts?id=" + userId);
assert.equal(history.sessions.length, 1);
assert.equal(history.account.retained_seconds, 222);
await req("accounts", { method: "POST", raw: "{", status: 400 });
await req("accounts", { method: "POST", raw: "", status: 400 });
await req("accounts", { method: "POST", raw: "x".repeat(4097), status: 413 });
await req("accounts", {
  method: "POST",
  data: { id: userId, action: "set_minutes", minutes: 20, is_admin: true },
  status: 403,
});
await req("accounts", {
  method: "POST",
  data: { id: userId, action: "reset_minutes" },
  origin: "https://other.invalid",
  status: 403,
});
await req("accounts", { auth: userCookie, status: 403 });
await req("accounts", { auth: "", status: 401 });
await req("accounts?status=invalid", { status: 422 });
const overview = await req("overview");
assert.equal(overview.provider_usage.status, "not_configured");
console.log(
  JSON.stringify({
    http_checks: checks,
    allowance: "10→20 minutes: 6.3→16.3 available",
    reset: "20 minutes available; call history preserved",
    authorization:
      "non-admin, unauthenticated, cross-origin, role escalation blocked",
  }),
);
