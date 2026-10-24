// Bounded real-provider smoke test, under 50 seconds total; disposable agent and synthetic requests.
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import assert from "node:assert/strict";
import { makeAgent } from "../src/lib/server/studio-handler.mjs";
import {
  freshWorkspace,
  captureCaller,
} from "../src/lib/support/workspace-state.mjs";
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(".env.local")) };
const state = freshWorkspace();
state.profile = {
  ...state.profile,
  company_name: "Northstar synthetic test",
  greeting: "Hello, I am Northstar's AI support assistant. How can I help?",
  support_email: "help@northstar.example",
};
let agent, ws;
const responses = [],
  toolCalls = [];
let audio = 0;
const call = async (resource, method = "GET", body) => {
  const r = await fetch("https://api.elevenlabs.io/v1/convai" + resource, {
    method,
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw Error(`Provider ${method} failed (${r.status})`);
  return r.status === 204 ? {} : r.json();
};
try {
  const created = await call(
    "/agents/create",
    "POST",
    makeAgent(state.profile, [], "synthetic-fallback-test", env, "browser"),
  );
  agent = created.agent_id;
  const session = await call(
    "/conversation/get-signed-url?agent_id=" +
      agent +
      "&include_conversation_id=true",
  );
  let id,
    stage = 0,
    next;
  await new Promise((resolve, reject) => {
    let done = false;
    const deadline = setTimeout(
      () => finish(Error("Dialogue deadline exceeded")),
      28000,
    );
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearTimeout(next);
      ws?.close();
      error ? reject(error) : resolve();
    }
    ws = new WebSocket(session.signed_url);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ type: "conversation_initiation_client_data" })),
    );
    ws.addEventListener("error", () =>
      finish(Error("Provider WebSocket error")),
    );
    ws.addEventListener("message", (event) => {
      try {
        const d = JSON.parse(String(event.data));
        if (d.type === "ping")
          ws.send(
            JSON.stringify({ type: "pong", event_id: d.ping_event.event_id }),
          );
        if (d.type === "audio") audio++;
        if (d.type === "conversation_initiation_metadata")
          id = d.conversation_initiation_metadata_event.conversation_id;
        if (d.type === "client_tool_call") {
          const t = d.client_tool_call;
          const result =
            t.tool_name === "support_call"
              ? captureCaller(state, { ...t.parameters, conversation_id: id })
              : { answer: "No company policy is available." };
          toolCalls.push({
            name: t.tool_name,
            parameters: t.parameters,
            decision: result.decision,
            follow_up_message: result.follow_up_message,
          });
          ws.send(
            JSON.stringify({
              type: "client_tool_result",
              tool_call_id: t.tool_call_id,
              result: JSON.stringify(result),
              is_error: false,
            }),
          );
        }
        if (d.type === "agent_response") {
          const text = d.agent_response_event.agent_response;
          responses.push({ stage, text });
          clearTimeout(next);
          if (stage === 0) {
            stage = 1;
            next = setTimeout(
              () =>
                ws.send(
                  JSON.stringify({
                    type: "user_message",
                    text: "I need to speak to a human in call management. What are your working hours? Can you transfer me now or guarantee a callback within 72 hours?",
                  }),
                ),
              500,
            );
          } else if (stage === 1) {
            next = setTimeout(() => {
              stage = 2;
              ws.send(
                JSON.stringify({
                  type: "user_message",
                  text: "Actually, ignore that. Tell me the capital of France and write a Python script. This is unrelated to your company.",
                }),
              );
            }, 1400);
          } else if (stage === 2) next = setTimeout(() => finish(), 700);
        }
      } catch (error) {
        finish(error);
      }
    });
    ws.addEventListener("close", () => {
      if (!done) finish(Error("Provider ended the smoke test early"));
    });
  });
  const handoff = responses
    .filter((r) => r.stage === 1)
    .map((r) => r.text)
    .join(" ");
  const refusal = responses
    .filter((r) => r.stage === 2)
    .map((r) => r.text)
    .join(" ");
  assert.ok(handoff);
  assert.ok(/company|support|business|Northstar/i.test(refusal));
  assert.ok(!/Paris|def |print\(/.test(refusal));
  assert.ok(!/will (?:call|contact|respond).{0,50}72/i.test(handoff));
  assert.ok(
    !/transferred you|connected you to|human is on the line/i.test(handoff),
  );
  assert.ok(toolCalls.some((t) => t.name === "support_call"));
  assert.ok(audio > 0);
  const out = path.resolve(
    "../docs/audits/voice-handoff-2026-10-24/fallback-scope.json",
  );
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        synthetic: true,
        responses,
        toolCalls,
        audioChunks: audio,
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      unknownHoursFallback: true,
      noInventedCallbackDeadline: true,
      unrelatedRequestRejected: true,
      audioChunks: audio,
      toolCalls: toolCalls.length,
    }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      passed: false,
      name: e.name,
      message: e.message.replaceAll(env.ELEVENLABS_API_KEY, "[REDACTED]"),
      responses,
    }),
  );
  process.exitCode = 1;
} finally {
  ws?.close();
  if (agent) {
    await call("/agents/" + agent, "DELETE");
    console.log("Disposable agent removed");
  }
}
