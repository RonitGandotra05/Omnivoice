import { domainToASCII } from "node:url";
import { Resolver } from "node:dns/promises";
import { ApiError } from "./provider.mjs";
export function normalizeEmail(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const input = value.trim().toLowerCase();
  if (/[\s\x00-\x1f\x7f]/.test(input)) return null;
  const parts = input.split("@");
  if (parts.length !== 2) return null;
  const [local, rawDomain] = parts,
    domain = domainToASCII(rawDomain);
  if (
    !local ||
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  )
    return null;
  if (
    !domain ||
    domain.length > 253 ||
    !domain.includes(".") ||
    domain
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(domain.split(".").at(-1))
  )
    return null;
  return local + "@" + domain;
}
const cache = new Map();
export async function checkEmailDomain(
  email,
  resolver = new Resolver({ timeout: 1500, tries: 1 }),
) {
  const domain = email.split("@")[1];
  if (/\.(test|example|invalid|localhost|local)$/.test(domain))
    throw new ApiError(
      "Use an email address that can receive verification messages.",
      422,
    );
  const hit = cache.get(domain);
  if (hit && hit > Date.now()) return;
  try {
    const records = await resolver.resolveMx(domain);
    if (
      !records.length ||
      records.some((r) => r.exchange === "." || r.exchange === "")
    )
      throw new ApiError(
        "Use an email address that can receive verification messages.",
        422,
      );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (["ENODATA", "ENOTFOUND"].includes(error.code))
      throw new ApiError(
        "Use an email address with a working mail domain.",
        422,
      );
    throw new ApiError(
      "Email domain verification is temporarily unavailable. Try again shortly.",
      503,
    );
  }
  if (cache.size > 1000) cache.clear();
  cache.set(domain, Date.now() + 15 * 60000);
}
