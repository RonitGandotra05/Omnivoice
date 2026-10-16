import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const keyFor = (env) =>
  env.STUDIO_SESSION_SECRET ||
  env.ELEVENLABS_API_KEY ||
  (env.NODE_ENV !== "production" ? "local-disabled-voice-workspace-only" : "");
export function signGrant(payload, env = process.env, seconds = 86400) {
  if (env.STUDIO_SESSION_SECRET && env.STUDIO_SESSION_SECRET.length < 32)
    throw new ApiError(
      "STUDIO_SESSION_SECRET must contain at least 32 characters",
      503,
    );
  const key = keyFor(env);
  if (!key)
    throw new ApiError(
      "Configure the server voice key before starting a voice session",
      503,
    );
  const data = Buffer.from(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + seconds,
    }),
  ).toString("base64url");
  return (
    data +
    "." +
    createHmac("sha256", key)
      .update("omnivoice-grant-v1:" + data)
      .digest("base64url")
  );
}
export function readGrant(token, kind, owner, env = process.env) {
  if (typeof token !== "string" || token.length > 64000)
    throw new ApiError("Invalid session grant", 401);
  const [data, signature, ...extra] = token.split(".");
  if (extra.length || !data || !signature)
    throw new ApiError("Invalid session grant", 401);
  if (env.STUDIO_SESSION_SECRET && env.STUDIO_SESSION_SECRET.length < 32)
    throw new ApiError(
      "STUDIO_SESSION_SECRET must contain at least 32 characters",
      503,
    );
  const key = keyFor(env);
  if (!key) throw new ApiError("Voice session is unavailable", 503);
  const expected = createHmac("sha256", key)
    .update("omnivoice-grant-v1:" + data)
    .digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    throw new ApiError("Invalid session grant", 401);
  }
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new ApiError("Invalid session grant", 401);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    throw new ApiError("Invalid session grant", 401);
  }
  if (
    payload.kind !== kind ||
    payload.exp <= Date.now() / 1000 ||
    (owner && payload.owner !== owner)
  )
    throw new ApiError(
      "Session expired or belongs to a different browser",
      401,
    );
  return payload;
}
export function browserOwner(request, env = process.env) {
  const cookie = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)ov_workspace=([^;]+)/)?.[1];
  if (cookie) {
    try {
      const grant = readGrant(cookie, "owner", null, env);
      if (typeof grant.owner === "string" && /^[\w-]{36}$/.test(grant.owner))
        return { owner: grant.owner };
    } catch {}
  }
  const owner = randomUUID();
  return {
    owner,
    cookie: `ov_workspace=${signGrant({ kind: "owner", owner }, env, 30 * 86400)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  };
}
export async function providerRequest(
  path,
  {
    method = "GET",
    body,
    allow404 = false,
    fetchImpl = fetch,
    env = process.env,
  } = {},
) {
  if (!env.ELEVENLABS_API_KEY)
    throw new ApiError(
      "Voice is not configured. Add the server API key to enable it.",
      503,
    );
  if (!/^\/[a-zA-Z0-9_/?=&.%-]+$/.test(path) || path.includes(".."))
    throw new ApiError("Invalid provider operation");
  const response = await fetchImpl(
    "https://api.elevenlabs.io/v1/convai" + path,
    {
      method,
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (allow404 && response.status === 404) return {};
  if (!response.ok)
    throw new ApiError(
      response.status === 429
        ? "Voice platform is busy. Retry shortly."
        : "Voice operation failed. Check the server API key, account permissions and configuration.",
      response.status === 429 ? 429 : 502,
    );
  if (response.status === 204) return {};
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024)
    throw new ApiError("Provider response exceeds the limit", 502);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError("Invalid provider response", 502);
  }
}
export function verifyWebhook(raw, header, secret, now = Date.now()) {
  if (!secret) throw new ApiError("Webhook secret is not configured", 503);
  const values = (header || "").split(",").map((v) => v.trim().split("="));
  const timestamp = values.find((v) => v[0] === "t")?.[1];
  if (
    !/^\d+$/.test(timestamp || "") ||
    Math.abs(now / 1000 - Number(timestamp)) > 1800
  )
    throw new ApiError("Invalid webhook signature", 401);
  const expected = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(raw)
    .digest();
  const valid = values
    .filter((v) => v[0] === "v0")
    .some((v) => {
      const actual = Buffer.from(v[1] || "", "hex");
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    });
  if (!valid) throw new ApiError("Invalid webhook signature", 401);
  try {
    return JSON.parse(Buffer.from(raw).toString());
  } catch {
    throw new ApiError("Invalid webhook payload", 422);
  }
}
