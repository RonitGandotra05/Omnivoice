import { getContext } from "@netlify/functions";
import { voiceConfiguration } from "./voice-config.mjs";
// Region changes speech style, never authentication, entitlement, language, or company facts.
// Only the trusted runtime context is consulted: client country/timezone headers and
// request JSON are deliberately ignored. VPNs may reflect their exit-node country.
export function trustedVoiceCountry(
  env = process.env,
  contextProvider = getContext,
) {
  if (env.NETLIFY !== "true") return null;
  try {
    const code = contextProvider()?.geo?.country?.code;
    return typeof code === "string" && /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}
export function regionalVoiceSelection(country, env = process.env) {
  const defaults = {
    US: { id: "cjVigY5qzO86Huf0OWal", name: "Eric · US English" },
    GB: { id: "JBFqnCBsd6RMkjVDRZzb", name: "George · UK English" },
    AU: { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie · Australian English" },
  };
  const code =
    typeof country === "string" && /^[A-Z]{2}$/.test(country) ? country : null;
  const configured = code ? env[`ELEVENLABS_VOICE_ID_${code}`] : null;
  const regional = configured
    ? {
        id: configured,
        name: code === "IN" ? "Indian English" : `${code} regional voice`,
      }
    : defaults[code];
  const enabled = env.VOICE_REGIONAL_ENABLED !== "false";
  return {
    configuration: voiceConfiguration({
      ...env,
      ...(enabled && regional ? { ELEVENLABS_VOICE_ID: regional.id } : {}),
    }),
    label: enabled && regional ? regional.name : "Default support voice",
    regional: !!(enabled && regional),
  };
}
