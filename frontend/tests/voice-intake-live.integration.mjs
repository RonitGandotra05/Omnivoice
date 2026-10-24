// Explicit live ElevenLabs test: synthetic dialogue, disposable agents, no calls/messages to real people.
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { makeAgent } from "../src/lib/server/studio-handler.mjs";
import {
  localAction,
  readWorkspace,
  updateWorkspace,
} from "../src/lib/support/indexed-store.mjs";
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(".env.local")) };
globalThis.indexedDB = indexedDB;
const output = path.resolve("../docs/audits/voice-handoff-2026-10-24");
fs.mkdirSync(output, { recursive: true });
const profile = {
  company_name: "Northstar synthetic support test",
  greeting: "Hello, I'm Northstar's AI support assistant. How may I help you?",
  instructions: "Be calm, warm and concise. Ask only one question at a time.",
  support_email: "help@northstar.example",
  timezone: "UTC",
  hours_enabled: false,
  office_hours: [],
  holidays: [],
  human_phone: "",
  routes: [],
};
async function provider(resource, method = "GET", body) {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/convai" + resource,
    {
      method,
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Provider ${method} ${resource.split("?")[0]} returned ${response.status}`,
    );
  return response.status === 204 ? {} : response.json();
}
async function dialogue(agent, refuses) {
  const session = await provider(
    "/conversation/get-signed-url?agent_id=" +
      agent +
      "&include_conversation_id=true",
  );
  const log = [],
    tools = [];
  let conversationId = "",
    audio = 0,
    step = 0,
    timer,
    next,
    settled = false,
    pendingMessage = false;
  let ws;
  const answers = {
    permission: false,
    name: false,
    phone: false,
    email: false,
    time: false,
  };
  const done = await new Promise((resolve, reject) => {
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(next);
      ws?.close();
      error ? reject(error) : resolve();
    }
    timer = setTimeout(
      () => finish(new Error("Live dialogue deadline exceeded")),
      110000,
    );
    function send(text) {
      if (settled || ws.readyState !== 1) return;
      log.push({ role: "user", text });
      ws.send(JSON.stringify({ type: "user_message", text }));
      pendingMessage = true;
    }
    function answer(text) {
      if (settled) return;
      if (++step > 16)
        return finish(new Error("Live dialogue exceeded turn budget"));
      if (step === 1)
        return send(
          "I need a human callback about an invoice correction, please.",
        );
      if (refuses) {
        if (step === 2)
          return send(
            "No, I do not give permission to save my name, phone or email. Please just record that I asked for a person.",
          );
        return send("I do not want to share any personal details. Thank you.");
      }
      const lower = text.toLowerCase();
      if (
        !answers.permission &&
        /permission|may i (?:save|collect)|can i (?:save|collect)|okay|ok to|consent|collect.*details|save.*details/.test(
          lower,
        )
      ) {
        answers.permission = true;
        return send(
          "Yes, you have my permission to save my name and contact details for this callback request.",
        );
      }
      if (!answers.name && /name|what should i call|who am i/.test(lower)) {
        answers.name = true;
        return send(
          "My name is Jamie Test. You have permission to save it for the callback.",
        );
      }
      if (!answers.phone && /number|phone|contact you|reach you/.test(lower)) {
        answers.phone = true;
        return send(
          "My confirmed callback phone number is plus one, two zero two, five five five, zero one zero zero. That is +12025550100, including the country code. Please save it.",
        );
      }
      if (!answers.email && /email|e-mail/.test(lower)) {
        answers.email = true;
        return send(
          "My confirmed email address is jamie@example.com. That is j a m i e at example dot com. You may save it.",
        );
      }
      if (!answers.time && /time|when|prefer|availability/.test(lower)) {
        answers.time = true;
        return send(
          "My preferred callback window is tomorrow after 2 PM UTC. Please save that preference for my invoice correction request.",
        );
      }
      if (/correct|confirm|right|did i|is that/.test(lower))
        return send(
          "Yes, that is correct. Please save the confirmed details for the callback.",
        );
      if (!answers.permission) {
        answers.permission = true;
        return send(
          "Yes, I consent to saving my contact details for this callback.",
        );
      }
      if (!answers.name) {
        answers.name = true;
        return send("My name is Jamie Test.");
      }
      if (!answers.phone) {
        answers.phone = true;
        return send("My confirmed callback number is +12025550100.");
      }
      if (!answers.email) {
        answers.email = true;
        return send("My confirmed email is jamie@example.com.");
      }
      if (!answers.time) {
        answers.time = true;
        return send(
          "Please save my preferred callback window: tomorrow after 2 PM UTC.",
        );
      }
      return send(
        "Please save my confirmed name Jamie Test, phone +12025550100, email jamie@example.com and callback preference tomorrow after 2 PM UTC. I consent to saving these contacts for my invoice correction request.",
      );
    }
    ws = new WebSocket(session.signed_url);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ type: "conversation_initiation_client_data" })),
    );
    ws.addEventListener("error", () =>
      finish(new Error("Provider WebSocket error")),
    );
    ws.addEventListener("close", () => {
      if (!settled)
        finish(new Error("Provider ended before intake assertions"));
    });
    ws.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === "ping")
          ws.send(
            JSON.stringify({
              type: "pong",
              event_id: data.ping_event.event_id,
            }),
          );
        if (data.type === "conversation_initiation_metadata")
          conversationId =
            data.conversation_initiation_metadata_event.conversation_id;
        if (data.type === "audio") audio++;
        if (data.type === "agent_response") {
          if (refuses && step >= 2 && conversationId) {
            const saved = (
              await localAction("callers/" + conversationId, "GET")
            ).caller;
            if (
              saved?.human_requested &&
              !saved.consent &&
              !saved.name &&
              !saved.phone &&
              !saved.email
            )
              return finish();
          }
          const text = data.agent_response_event.agent_response;
          log.push({ role: "agent", text });
          pendingMessage = false;
          clearTimeout(next);
          next = setTimeout(() => answer(text), 1000);
        }
        if (data.type === "client_tool_call") {
          clearTimeout(next);
          const tool = data.client_tool_call;
          let result;
          if (tool.tool_name === "support_call") {
            result = await localAction("caller-context", "POST", {
              ...tool.parameters,
              conversation_id: conversationId,
            });
            tools.push({
              name: tool.tool_name,
              parameters: tool.parameters,
              result: {
                caller: result.caller,
                ticketId: result.ticket?.id,
                decision: result.decision,
              },
            });
          } else
            result = {
              answer:
                "No company policy is available. Offer a human callback request.",
            };
          if (ws.readyState === 1)
            ws.send(
              JSON.stringify({
                type: "client_tool_result",
                tool_call_id: tool.tool_call_id,
                result: JSON.stringify(result),
                is_error: false,
              }),
            );
          const caller = result.caller;
          if (
            refuses &&
            step >= 2 &&
            caller &&
            !caller.consent &&
            !caller.name &&
            !caller.phone &&
            !caller.email &&
            caller.human_requested
          )
            return finish();
          if (
            !refuses &&
            caller?.name === "Jamie Test" &&
            caller.phone === "+12025550100" &&
            caller.email === "jamie@example.com" &&
            /2|two/i.test(caller.callback_preference || "")
          )
            return finish();
        }
      } catch (error) {
        finish(error);
      }
    });
  });
  void done;
  assert.ok(conversationId);
  const saved = (await localAction("callers/" + conversationId, "GET")).caller;
  assert.ok(saved?.human_requested);
  assert.equal(saved.callback_booked, false);
  assert.ok(saved.ticket_id);
  assert.equal(
    (await readWorkspace()).tickets.filter((t) => t.id === saved.ticket_id)
      .length,
    1,
  );
  if (refuses) {
    assert.equal(saved.name, "");
    assert.equal(saved.phone, "");
    assert.equal(saved.email, null);
    assert.equal(saved.consent, false);
  } else {
    assert.equal(saved.name, "Jamie Test");
    assert.equal(saved.phone, "+12025550100");
    assert.equal(saved.email, "jamie@example.com");
    assert.equal(saved.consent, true);
    assert.equal(saved.handoff, "callback_requested");
    assert.ok(tools.length >= 3);
    assert.ok(!tools[0].parameters.name && !tools[0].parameters.phone);
  }
  assert.ok(
    audio > 0,
    "Provider must produce audio for the selected voice/model",
  );
  fs.writeFileSync(
    path.join(
      output,
      refuses ? "refused-consent.json" : "callback-intake.json",
    ),
    JSON.stringify(
      {
        synthetic: true,
        voice: "Eric",
        model: "eleven_v4_turbo",
        log,
        tools,
        assertionsPassed: true,
        audioChunks: audio,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      scenario: refuses ? "refused-consent" : "incremental-callback-intake",
      passed: true,
      audioChunks: audio,
      toolCalls: tools.length,
      persistedContactFields: refuses ? 0 : 3,
      singleTicket: true,
    }),
  );
}
let agent;
try {
  await updateWorkspace((s) => {
    s.profile = profile;
    s.documents = [];
  });
  const configuration = makeAgent(
    profile,
    [],
    "disposable-intake-audit",
    env,
    "browser",
  );
  configuration.name = "OmniVoice disposable voice and intake audit";
  configuration.conversation_config.conversation.max_duration_seconds = 120;
  const created = await provider("/agents/create", "POST", configuration);
  agent = created.agent_id;
  assert.ok(agent);
  await dialogue(agent, false);
  await dialogue(agent, true);
  console.log(
    JSON.stringify({ liveProvider: true, syntheticOnly: true, passed: true }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      name: error.name,
      message: error.message?.replaceAll(env.ELEVENLABS_API_KEY, "[REDACTED]"),
    }),
  );
  process.exitCode = 1;
} finally {
  if (agent) {
    try {
      await provider("/agents/" + agent, "DELETE");
      console.log("Disposable agent removed");
    } catch {
      console.error("Disposable agent cleanup failed");
      process.exitCode = 1;
    }
  }
}
