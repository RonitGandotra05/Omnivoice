import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import {
  localAction,
  readWorkspace,
  updateWorkspace,
  resetDBHandleForTests,
} from "../src/lib/support/indexed-store.mjs";
globalThis.indexedDB = indexedDB;
globalThis.localStorage = { getItem: () => null };
resetDBHandleForTests();
test("IndexedDB reloads without a server or localStorage", async () => {
  const initial = await readWorkspace();
  await localAction("profile", "PUT", {
    ...initial.profile,
    company_name: "Browser Company",
  });
  assert.equal((await readWorkspace()).profile.company_name, "Browser Company");
});
test("35 concurrent document writes are serialized without loss", async () => {
  await updateWorkspace((s) => {
    s.documents = [];
  });
  await Promise.all(
    Array.from({ length: 35 }, (_, i) =>
      localAction("documents", "POST", {
        name: `doc-${i}.txt`,
        content: `Unique support document number ${i}.`,
        fingerprint: String(i),
      }),
    ),
  );
  assert.equal((await readWorkspace()).documents.length, 35);
});
test("failed mutations roll back without losing records", async () => {
  const before = await readWorkspace();
  await assert.rejects(localAction("profile", "PUT", { company_name: "x" }));
  assert.deepEqual((await readWorkspace()).documents, before.documents);
});
test("concurrent callback retries create one queue item", async () => {
  const body = {
    conversation_id: "test-call",
    name: "Alex",
    phone: "+14155550101",
    consent: true,
    action: "handoff",
    callback_requested: true,
  };
  await Promise.all([
    localAction("caller-context", "POST", body),
    localAction("caller-context", "POST", body),
  ]);
  assert.equal(
    (await localAction("callers/test-call", "GET")).caller.name,
    "Alex",
  );
  assert.equal((await readWorkspace()).tickets.length, 1);
});
test("workspace and caller reads do not rewrite the database or increment revision", async () => {
  const before = await readWorkspace();
  await Promise.all(Array.from({ length: 20 }, () => readWorkspace()));
  await localAction("callers/test-call", "GET");
  const after = await readWorkspace();
  assert.equal(after.revision, before.revision);
});
