import { randomBytes, scrypt as derive, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { compare } from "bcryptjs";
const scrypt = promisify(derive);
const cost = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const blocked = new Set([
  "passwordpassword",
  "password123456789",
  "123456789012345",
  "1234567890123456",
  "qwertyuiopasdfgh",
  "letmeinletmein123",
  "adminadminadmin",
  "welcome123456789",
  "iloveyouiloveyou",
  "changemechangeme",
  "correct horse battery staple",
]);
export function validLoginPassword(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].length <= 128 &&
    Buffer.byteLength(value) <= 512
  );
}
export function validNewPassword(value) {
  if (!validLoginPassword(value)) return false;
  const normalized = value.normalize("NFC");
  return (
    [...normalized].length >= 15 &&
    !blocked.has(normalized.toLowerCase()) &&
    !/^(.)\1+$/u.test(normalized)
  );
}
export async function hashPassword(value) {
  const salt = randomBytes(16);
  const key = await scrypt(value.normalize("NFC"), salt, 64, cost);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
}
let dummy;
export async function verifyPassword(value, stored) {
  if (!validLoginPassword(value)) return false;
  if (typeof stored === "string" && /^\$2[aby]\$/.test(stored))
    return Buffer.byteLength(value) <= 72 && (await compare(value, stored));
  if (!stored) {
    dummy ||= hashPassword(randomBytes(32).toString("hex"));
    stored = await dummy;
  }
  const parts = stored.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "32768" ||
    parts[2] !== "8" ||
    !["1", "3"].includes(parts[3]) ||
    !/^[a-f0-9]{32}$/.test(parts[4]) ||
    !/^[a-f0-9]{128}$/.test(parts[5])
  )
    return false;
  const actual = await scrypt(
    value.normalize("NFC"),
    Buffer.from(parts[4], "hex"),
    64,
    { ...cost, p: Number(parts[3]) },
  );
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex"));
}
