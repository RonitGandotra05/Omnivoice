import test from "node:test";
import assert from "node:assert/strict";
import {
  captureCaller,
  freshWorkspace,
} from "../src/lib/support/workspace-state.mjs";
import { voiceConfiguration } from "../src/lib/server/voice-config.mjs";
import { voiceIntakeInstructions } from "../src/lib/voice-intake.mjs";
const state = () => ({
  ...freshWorkspace(),
  profile: {
    company_name: "Northstar",
    greeting: "Hello from Northstar.",
    support_email: "help@northstar.example",
    instructions: "",
    timezone: "UTC",
    hours_enabled: false,
    office_hours: [],
    holidays: [],
    human_phone: "",
    routes: [],
  },
});
test("handoff saves immediately, each consented answer updates the same caller and ticket", () => {
  const s = state();
  const id = "live-intake";
  let r = captureCaller(s, {
    conversation_id: id,
    action: "handoff",
    human_requested: true,
    callback_requested: true,
    consent: false,
  });
  assert.equal(r.caller.name, "");
  assert.equal(s.tickets.length, 1);
  const ticketId = r.ticket.id;
  r = captureCaller(s, { conversation_id: id, consent: true, name: "Jamie" });
  assert.equal(r.caller.name, "Jamie");
  assert.equal(r.caller.human_requested, true);
  r = captureCaller(s, { conversation_id: id, phone: "+1 (202) 555-0100" });
  assert.equal(r.caller.name, "Jamie");
  assert.equal(r.caller.phone, "+12025550100");
  assert.equal(r.caller.handoff, "callback_requested");
  r = captureCaller(s, {
    conversation_id: id,
    email: "jamie@example.com",
    reason: "An invoice correction",
    callback_preference: "Tomorrow after 2 PM UTC",
  });
  assert.equal(r.caller.phone, "+12025550100");
  assert.equal(r.ticket.customer_email, "jamie@example.com");
  assert.equal(r.ticket.customer_phone, "+12025550100");
  assert.match(r.ticket.summary, /Jamie/);
  assert.equal(r.ticket.id, ticketId);
  assert.equal(s.callers.length, 1);
  assert.equal(s.tickets.length, 1);
  assert.equal(r.caller.callback_booked, false);
  r = captureCaller(s, { conversation_id: id, consent: false });
  assert.equal(r.caller.name, "");
  assert.equal(r.caller.phone, "");
  assert.equal(r.caller.email, null);
  assert.equal(r.ticket.customer_phone, "");
  assert.equal(r.ticket.customer_email, null);
  assert.equal(r.caller.handoff, "follow_up_requested");
  assert.ok(!r.ticket.summary.includes("Jamie"));
});
test("declined permission and invalid contact data never store contacts", () => {
  const s = state();
  captureCaller(s, {
    conversation_id: "no-consent",
    action: "handoff",
    consent: false,
    human_requested: true,
  });
  const before = structuredClone(s);
  assert.throws(() =>
    captureCaller(s, { conversation_id: "no-consent", name: "Unapproved" }),
  );
  assert.deepEqual(s, before);
  assert.throws(() =>
    captureCaller(s, {
      conversation_id: "no-consent",
      phone: "911",
      consent: true,
    }),
  );
  assert.deepEqual(s, before);
  assert.throws(() =>
    captureCaller(s, {
      conversation_id: "no-consent",
      email: "bad email",
      consent: true,
    }),
  );
  assert.deepEqual(s, before);
});
test("a browser human request never claims a telephone transfer", () => {
  const s = state();
  s.profile.human_phone = "+12025550101";
  const r = captureCaller(
    s,
    {
      conversation_id: "browser-human",
      action: "handoff",
      consent: false,
      human_requested: true,
    },
    { channel: "browser" },
  );
  assert.equal(r.decision, "follow_up_requested");
  assert.equal(r.transfer_number, null);
  assert.equal(r.caller.callback_booked, false);
});
test("expressive conversational voice is pinned server-side and configurable", () => {
  const v = voiceConfiguration({});
  assert.equal(v.voice_id, "cjVigY5qzO86Huf0OWal");
  assert.equal(v.model_id, "eleven_v4_turbo");
  assert.equal(v.expressive_mode, true);
  assert.equal(
    voiceConfiguration({ VOICE_TTS_MODEL: "eleven_flash_v2_5" })
      .expressive_mode,
    false,
  );
  assert.throws(() => voiceConfiguration({ VOICE_TTS_MODEL: "arbitrary" }));
  assert.match(voiceIntakeInstructions, /ONE question/);
  assert.match(voiceIntakeInstructions, /after EACH/);
  assert.match(voiceIntakeInstructions, /permission/);
});

test("signed sessions refresh the voice and intake prompt before connecting; other owners cannot patch", async () => {
  const { createStudioHandler } =
    await import("../src/lib/server/studio-handler.mjs");
  const { signGrant } = await import("../src/lib/server/provider.mjs");
  const env = {
    ELEVENLABS_API_KEY: "fake-provider",
    STUDIO_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    PUBLIC_APP_URL: "http://app.test",
  };
  const owner = "11111111-1111-4111-8111-111111111111",
    calls = [];
  const handler = createStudioHandler({
    env,
    limit: async () => {},
    accountForRequest: async () => ({
      id: "verified-user",
      email_verified: true,
    }),
    fetchImpl: async (url, options) => {
      calls.push({
        url,
        method: options.method,
        body: options.body ? JSON.parse(options.body) : null,
      });
      if (options.method === "GET" && url.includes("/agents/"))
        return Response.json({
          conversation_config: {
            agent: {
              prompt: { prompt: "Company-specific support instructions." },
            },
          },
        });
      if (url.includes("get-signed-url"))
        return Response.json({ signed_url: "wss://voice.example/live" });
      return new Response(null, { status: 204 });
    },
  });
  const cookie = "ov_workspace=" + signGrant({ kind: "owner", owner }, env);
  const invoke = (token) =>
    handler(
      new Request("http://app.test/api/studio/voice/session", {
        method: "POST",
        headers: {
          origin: "http://app.test",
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ agent_token: token }),
      }),
      "voice/session",
    );
  const r = await invoke(
    signGrant(
      { kind: "agent", owner, agent_id: "agent-test", documents: [] },
      env,
    ),
  );
  assert.equal(r.status, 200);
  const patch = calls.find((c) => c.method === "PATCH");
  assert.equal(patch.body.conversation_config.tts.model_id, "eleven_v4_turbo");
  assert.match(
    patch.body.conversation_config.agent.prompt.prompt,
    /Company-specific/,
  );
  assert.match(
    patch.body.conversation_config.agent.prompt.prompt,
    /after EACH/,
  );
  const count = calls.length;
  assert.equal(
    (
      await invoke(
        signGrant(
          {
            kind: "agent",
            owner: "22222222-2222-4222-8222-222222222222",
            agent_id: "victim",
            documents: [],
          },
          env,
        ),
      )
    ).status,
    401,
  );
  assert.equal(calls.length, count);
});

test("regional voice selection trusts only runtime country and falls back safely", async () => {
  const { trustedVoiceCountry, regionalVoiceSelection } =
    await import("../src/lib/server/regional-voice.mjs");
  assert.equal(
    trustedVoiceCountry({ NETLIFY: "true" }, () => ({
      geo: { country: { code: "IN" } },
    })),
    "IN",
  );
  assert.equal(
    trustedVoiceCountry({}, () => ({ geo: { country: { code: "IN" } } })),
    null,
  );
  assert.equal(
    trustedVoiceCountry({ NETLIFY: "true" }, () => {
      throw Error("No platform context");
    }),
    null,
  );
  assert.equal(
    trustedVoiceCountry({ NETLIFY: "true" }, () => ({
      geo: { country: { code: "us;arbitrary" } },
    })),
    null,
  );
  assert.equal(
    regionalVoiceSelection("US", {}).configuration.voice_id,
    "cjVigY5qzO86Huf0OWal",
  );
  assert.equal(
    regionalVoiceSelection("GB", {}).configuration.voice_id,
    "JBFqnCBsd6RMkjVDRZzb",
  );
  assert.equal(
    regionalVoiceSelection("AU", {}).configuration.voice_id,
    "IKne3meq5aSn9XLyUdCD",
  );
  assert.equal(regionalVoiceSelection("IN", {}).regional, false);
  assert.equal(
    regionalVoiceSelection("IN", {
      ELEVENLABS_VOICE_ID_IN: "approved-indian-voice",
    }).configuration.voice_id,
    "approved-indian-voice",
  );
  assert.equal(
    regionalVoiceSelection(null, {
      ELEVENLABS_VOICE_ID_IN: "approved-indian-voice",
    }).regional,
    false,
  );
  assert.equal(
    regionalVoiceSelection("IN", {
      ELEVENLABS_VOICE_ID_IN: "approved-indian-voice",
      VOICE_REGIONAL_ENABLED: "false",
    }).regional,
    false,
  );
  assert.throws(() =>
    regionalVoiceSelection("IN", {
      ELEVENLABS_VOICE_ID_IN: "https://arbitrary.example",
    }),
  );
});
test("unknown hours use honest ticket fallback; 72 hours requires an explicit company policy", async () => {
  const { availability } = await import("../src/lib/support/hours.mjs");
  const { voicePrompt, profileError } =
    await import("../src/lib/workspace.mjs");
  const { ProfileSchema } = await import("../src/lib/support/schema.mjs");
  const s = state();
  assert.equal(
    availability({ ...s.profile, hours_enabled: true, office_hours: [] })
      .status,
    "unknown",
  );
  let result = captureCaller(s, {
    conversation_id: "unknown-hours",
    action: "handoff",
    human_requested: true,
    callback_requested: true,
    consent: false,
  });
  assert.equal(result.decision, "follow_up_requested");
  assert.equal(result.callback_response_hours, null);
  assert.match(result.follow_up_message, /May I save/);
  assert.ok(!result.follow_up_message.includes("72"));
  result = captureCaller(s, {
    conversation_id: "unknown-hours",
    consent: true,
    name: "Jamie",
    phone: "+12025550100",
  });
  assert.match(
    result.follow_up_message,
    /don't have a confirmed response timeframe/,
  );
  assert.match(
    result.follow_up_message,
    /cannot confirm the team was notified/,
  );
  s.profile.callback_response_hours = 72;
  result = captureCaller(
    s,
    {
      conversation_id: "unknown-hours",
      action: "capture",
      callback_preference: "Next week",
    },
    { storage: "postgres" },
  );
  assert.equal(result.callback_response_hours, 72);
  assert.match(result.follow_up_message, /target is within 72 hours/);
  assert.match(result.follow_up_message, /not a booked or guaranteed/);
  assert.match(voicePrompt(s.profile), /response target: 72 hours/);
  delete s.profile.callback_response_hours;
  assert.match(voicePrompt(s.profile), /Never invent a deadline/);
  for (const value of [0, -1, 1.5, 721, "72"]) {
    assert.equal(
      ProfileSchema.safeParse({ ...s.profile, callback_response_hours: value })
        .success,
      false,
    );
    assert.ok(profileError({ ...s.profile, callback_response_hours: value }));
  }
});
test("callback policies must be grounded in the company source", async () => {
  const { validateExtraction } =
    await import("../src/lib/support/assistant-schema.mjs");
  assert.equal(
    validateExtraction(
      {
        in_scope: true,
        updates: { callback_response_hours: 72 },
        evidence: {
          callback_response_hours: "Our callback response target is 72 hours.",
        },
      },
      "Our callback response target is 72 hours.",
    ).callback_response_hours,
    72,
  );
  assert.throws(() =>
    validateExtraction(
      {
        in_scope: true,
        updates: { callback_response_hours: 72 },
        evidence: { callback_response_hours: "Please contact us." },
      },
      "Please contact us.",
    ),
  );
});
