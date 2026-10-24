import { ApiError } from "./provider.mjs";
export const VOICE_CONFIG_VERSION = "support-intake-expressive-v1";
export function voiceConfiguration(env = process.env) {
  const voice_id = env.ELEVENLABS_VOICE_ID || "cjVigY5qzO86Huf0OWal"; // Eric: conversational, smooth and trustworthy.
  const model_id = env.VOICE_TTS_MODEL || "eleven_v4_turbo";
  if (
    !/^[a-zA-Z0-9_-]{1,120}$/.test(voice_id) ||
    ![
      "eleven_v4_turbo",
      "eleven_v3_conversational",
      "eleven_flash_v2_5",
      "eleven_flash_v2",
    ].includes(model_id)
  )
    throw new ApiError("Voice settings are not configured correctly", 503);
  return {
    voice_id,
    model_id,
    stability: 0.5,
    similarity_boost: 0.75,
    expressive_mode: ["eleven_v4_turbo", "eleven_v3_conversational"].includes(
      model_id,
    ),
  };
}
