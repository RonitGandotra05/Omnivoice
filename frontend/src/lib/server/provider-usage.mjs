import { createHash } from "node:crypto";
export const publishedFreePlan = {
  included_minutes: 15,
  concurrent_calls: 4,
  checked_on: "2026-10-24",
  source: "https://elevenlabs.io/pricing/agents",
};
const cache = new Map();
export function normalizeProviderUsage(data) {
  if (
    typeof data?.tier !== "string" ||
    !Number.isSafeInteger(data.character_count) ||
    !Number.isSafeInteger(data.character_limit) ||
    data.character_count < 0 ||
    data.character_limit < 0
  )
    throw Error("Invalid subscription data");
  return {
    status: "connected",
    plan: data.tier,
    credits_used: data.character_count,
    credits_limit: data.character_limit,
    credits_remaining: Math.max(0, data.character_limit - data.character_count),
    reset_at:
      Number.isFinite(data.next_character_count_reset_unix) &&
      data.next_character_count_reset_unix > 0
        ? new Date(data.next_character_count_reset_unix * 1000).toISOString()
        : null,
    remaining_call_minutes: null,
    message:
      "The subscription API reports credits, not an authoritative remaining Agents-minute balance. Credits are not converted into call minutes.",
    checked_at: new Date().toISOString(),
    published_free_plan: publishedFreePlan,
  };
}
export async function providerUsage(env = process.env, fetchImpl = fetch) {
  const key = env.ELEVENLABS_USAGE_API_KEY || env.ELEVENLABS_API_KEY;
  if (!key)
    return {
      status: "not_configured",
      remaining_call_minutes: null,
      message:
        "Add a server-side ElevenLabs usage key with user_read permission to view account usage.",
      published_free_plan: publishedFreePlan,
    };
  const id = createHash("sha256").update(key).digest("hex");
  const old = cache.get(id);
  if (old && old.expires > Date.now()) return old.promise;
  const promise = (async () => {
    try {
      const r = await fetchImpl(
        "https://api.elevenlabs.io/v1/user/subscription",
        {
          headers: { "xi-api-key": key },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        },
      );
      if (r.status === 401 || r.status === 403)
        return {
          status: "permission_required",
          remaining_call_minutes: null,
          message:
            "The configured key cannot read subscription usage. In ElevenLabs, enable user_read on a server usage key, then set ELEVENLABS_USAGE_API_KEY. No billing or key permissions were changed.",
          checked_at: new Date().toISOString(),
          published_free_plan: publishedFreePlan,
        };
      if (!r.ok) throw Error("Provider unavailable");
      return normalizeProviderUsage(await r.json());
    } catch {
      return {
        status: "unavailable",
        remaining_call_minutes: null,
        message:
          "ElevenLabs usage could not be verified. Check the provider dashboard; the app's user balances remain available.",
        checked_at: new Date().toISOString(),
        published_free_plan: publishedFreePlan,
      };
    }
  })();
  if (cache.size > 10) cache.clear();
  cache.set(id, { expires: Date.now() + 60000, promise });
  return promise;
}
export function resetProviderUsageCacheForTests() {
  cache.clear();
}
