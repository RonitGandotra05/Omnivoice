import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
test("secret scanner rejects untracked source without printing the credential", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const fixture = path.join(
    root,
    "ov-secret-scan-fixture-" + randomUUID() + ".txt",
  );
  const secret = ["sk", "a".repeat(40)].join("_");
  try {
    fs.writeFileSync(fixture, secret, { mode: 0o600 });
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [path.join(root, "frontend/scripts/check-secrets.mjs")],
          { cwd: root, stdio: "pipe" },
        ),
      (error) => {
        const output = String(error.stderr) + String(error.stdout);
        assert.equal(error.status, 1);
        assert.ok(output.includes(path.basename(fixture)));
        assert.ok(!output.includes(secret));
        return true;
      },
    );
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});
