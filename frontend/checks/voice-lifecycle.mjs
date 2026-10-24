import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceStartGuard } from "../src/lib/voice-start.mjs";

test("duplicate starts share no second signed-url request", () => {
  const guard = createVoiceStartGuard();
  const first = guard.begin();
  assert.ok(first);
  assert.equal(guard.begin(), null);
  guard.finish(first);
  assert.ok(guard.begin());
});

test("unmount or cancel prevents a late token from starting a voice session", async () => {
  const guard = createVoiceStartGuard();
  const first = guard.begin();
  let resolve;
  const token = new Promise((done) => {
    resolve = done;
  });
  let starts = 0;
  const task = token.then(() => {
    if (guard.current(first)) starts++;
  });
  guard.cancel();
  resolve("dummy-signed-url");
  await task;
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(starts, 0);
});

test("a cancelled attempt cannot finish or invalidate a replacement", () => {
  const guard = createVoiceStartGuard();
  const first = guard.begin();
  guard.cancel();
  const next = guard.begin();
  guard.finish(first);
  assert.equal(guard.current(first), false);
  assert.equal(guard.current(next), true);
  assert.equal(guard.begin(), null);
});

import { waitForVoiceConnection } from "../src/lib/voice-start.mjs";
test("SDK readiness waits for onConnect even if startSession returns void", async () => {
  const c = new AbortController(),
    ready = waitForVoiceConnection(c.signal, 1000);
  let connected = false;
  ready.promise.then(() => {
    connected = true;
  });
  await Promise.resolve();
  assert.equal(connected, false);
  ready.connected();
  await ready.promise;
  assert.equal(connected, true);
  ready.failed(new Error("late"));
});
test("voice connection times out and can be retried", async () => {
  const ready = waitForVoiceConnection(new AbortController().signal, 5);
  await assert.rejects(ready.promise, (e) => e.name === "TimeoutError");
  ready.connected();
  const next = waitForVoiceConnection(new AbortController().signal, 50);
  next.connected();
  await next.promise;
});
test("voice cancellation rejects a pending connection and ignores late success", async () => {
  const c = new AbortController(),
    ready = waitForVoiceConnection(c.signal, 1000);
  c.abort();
  ready.connected();
  await assert.rejects(ready.promise, (e) => e.name === "AbortError");
});
test("voice error and pre-connected disconnect reject readiness", async () => {
  const ready = waitForVoiceConnection(new AbortController().signal, 1000);
  ready.failed();
  await assert.rejects(ready.promise, /ended before/);
});
import { canStartVoice } from "../src/lib/voice-start.mjs";
test("SDK error state permits retry but live and pending states do not", () => {
  assert.equal(canStartVoice("error"), true);
  assert.equal(canStartVoice("disconnected"), true);
  for (const status of ["connecting", "connected", "disconnecting"])
    assert.equal(canStartVoice(status), false);
});
