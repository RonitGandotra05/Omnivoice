// Inspect Git blobs and browser assets without printing credential values.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
const root = fileURLToPath(new URL("../..", import.meta.url));
const local = path.join(root, "frontend/.env.local");
const env = fs.existsSync(local)
  ? dotenv.parse(fs.readFileSync(local))
  : process.env;
const values = Object.entries(env)
  .filter(
    ([k, v]) =>
      /(KEY|SECRET|PASSWORD|DATABASE_URL|CONNECTION_STRING)$/.test(k) &&
      typeof v === "string" &&
      v.length >= 24,
  )
  .map(([, v]) => v);
const suspicious =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk_[a-zA-Z0-9]{28,}|postgres(?:ql)?:\/\/[^\s:'"/]+:[^\s@'"]+@[^\s'"<>]+/;
const failures = [];
const inspect = (name, bytes) => {
  const text = bytes.toString();
  if (values.some((x) => text.includes(x)) || suspicious.test(text))
    failures.push(name);
};
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter(Boolean);
for (const file of files) {
  // Read the index: unstaged local files must not accidentally certify unsafe blobs.
  inspect(
    "git:" + file,
    execFileSync("git", ["show", ":" + file], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else inspect("browser:" + path.relative(root, full), fs.readFileSync(full));
  }
}
walk(path.join(root, "frontend/.next/static"));
if (failures.length) {
  console.error("Potential secrets detected in: " + failures.join(", "));
  process.exitCode = 1;
} else
  console.log(
    `Secret check passed: ${files.length} Git files and available browser assets. Values were not printed.`,
  );
