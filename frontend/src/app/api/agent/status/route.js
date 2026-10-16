export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    {
      provider: "OmniVoice",
      configured: !!process.env.ELEVENLABS_API_KEY,
      phone_configured: !!process.env.ELEVENLABS_PHONE_NUMBER_ID,
      live_calls_enabled: process.env.NATIVE_CALLS_ENABLED === "true",
      simulation_available: true,
      backend_available: true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
