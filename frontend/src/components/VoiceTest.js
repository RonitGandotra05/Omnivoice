"use client";
import { useEffect, useRef, useState } from "react";
import { createVoiceStartGuard } from "@/lib/voice-start.mjs";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import {
  studioRequest,
  runVoiceTool,
  searchVoiceKnowledge,
  recordVoiceTranscript,
} from "@/lib/support/studio-client.mjs";
import CallerDetails from "@/components/CallerDetails";
import Icon from "@/components/ui/Icon";
import Link from "next/link";
import { serverRequest } from "@/lib/support/studio-client.mjs";

function saveTranscriptSnapshot(value) {
  if (!value.id || value.recorded) return;
  value.recorded = true;
  recordVoiceTranscript(
    value.id,
    value.transcript,
    Math.round((Date.now() - value.started) / 1000),
  ).catch(() => {
    value.recorded = false;
  });
}

function VoiceSession({ enabled }) {
  const [error, setError] = useState("");
  const [allowance, setAllowance] = useState(null);
  const [remaining, setRemaining] = useState(60);
  const maxSeconds = useRef(60);
  const refreshAllowance = () =>
    serverRequest("demo/allowance", null, { method: "GET" })
      .then(setAllowance)
      .catch(() =>
        setAllowance({
          available: false,
          error:
            "Voice demo availability could not be verified. Please try again shortly.",
        }),
      );
  useEffect(() => {
    refreshAllowance();
  }, []);
  const [starting, setStarting] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [conversationId, setConversationId] = useState("");
  const [caller, setCaller] = useState(null);
  const [trackingError, setTrackingError] = useState("");
  const live = useRef({ id: "", transcript: [], started: 0, recorded: false });
  const guard = useRef(null);
  if (!guard.current) guard.current = createVoiceStartGuard();
  useEffect(
    () => () => {
      guard.current.cancel();
      saveTranscriptSnapshot(live.current);
    },
    [],
  );
  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      live.current = {
        id: conversationId,
        transcript: [],
        started: Date.now(),
        recorded: false,
      };
      setConversationId(conversationId);
    },
    onDisconnect: () => {
      saveTranscriptSnapshot(live.current);
      refreshAllowance();
    },
    onMessage: (message) => {
      const entry = { role: message.source, text: message.message };
      live.current.transcript = [...live.current.transcript, entry].slice(-100);
      setTranscript(live.current.transcript);
    },
    onError: () =>
      setError(
        "Voice connection failed. Check the company agent, browser microphone access, and provider configuration.",
      ),
  });
  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    let timer;
    let failures = 0;
    const poll = async () => {
      try {
        const data = await studioRequest(
          `callers/${encodeURIComponent(conversationId)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setCaller(data.caller);
        setTrackingError("");
        failures = 0;
      } catch {
        if (controller.signal.aborted) return;
        failures += 1;
        setTrackingError(
          "Caller details could not be refreshed. The conversation can continue.",
        );
      }
      if (!controller.signal.aborted && conversation.status === "connected")
        timer = setTimeout(poll, Math.min(15000, 2000 * 2 ** failures));
    };
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [conversationId, conversation.status]);
  const { status: voiceStatus, endSession } = conversation;
  useEffect(() => {
    if (voiceStatus !== "connected") return;
    const tick = () => {
      const left = Math.max(
        0,
        maxSeconds.current -
          Math.floor((Date.now() - live.current.started) / 1000),
      );
      setRemaining(left);
      if (!left) endSession();
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [voiceStatus, endSession]);
  const start = async () => {
    if (
      !enabled ||
      !allowance?.available ||
      conversation.status !== "disconnected"
    )
      return;
    const attempt = guard.current.begin();
    if (!attempt) return;
    setStarting(true);
    setError("");
    setTranscript([]);
    setConversationId("");
    setCaller(null);
    setTrackingError("");
    try {
      const data = await studioRequest("voice/session", {
        method: "POST",
        signal: attempt.controller.signal,
      });
      if (!guard.current.current(attempt)) return;
      maxSeconds.current = data.max_seconds || 60;
      setRemaining(maxSeconds.current);
      setAllowance((previous) => ({ ...previous, available: false }));
      await conversation.startSession({
        signedUrl: data.signed_url,
        connectionType: "websocket",
        clientTools: {
          support_call: async (values) =>
            JSON.stringify(await runVoiceTool(values, live.current.id)),
          search_company_knowledge: async (values) =>
            JSON.stringify(await searchVoiceKnowledge(values.query)),
        },
      });
    } catch (err) {
      refreshAllowance();
      if (guard.current.current(attempt))
        setError(
          err.name === "TimeoutError"
            ? "The voice connection timed out. Please try again."
            : err.message,
        );
    } finally {
      if (guard.current.current(attempt)) setStarting(false);
      guard.current.finish(attempt);
    }
  };
  return (
    <div className="voice-test-card">
      <div className="document-heading">
        <h3>
          <Icon name="phone" /> Voice conversation test
        </h3>
        <span className="tag">{conversation.status}</span>
      </div>
      <p>
        Speak with your configured company agent. This free demo uses your
        microphone and sends audio to the voice platform.
      </p>
      <div className="demo-limit-note">
        <strong>
          {allowance?.budget_seconds === 600
            ? "10-minute account demo"
            : "One-minute voice demo"}
        </strong>
        <p>
          {allowance?.budget_seconds === 600
            ? "Up to 10 minutes per account, network and browser every 24 hours. "
            : "One minute per network and browser every 24 hours. Verify an account for up to 10 minutes. "}
          Time is reserved when a conversation starts. This simulates a support
          phone call using your microphone; no phone number is required.
        </p>
        <Link
          className="text-link"
          href={allowance?.signed_in ? "/account/settings" : "/account"}
        >
          {allowance?.signed_in
            ? "Account settings"
            : "Create an account / sign in"}
        </Link>
      </div>
      {allowance &&
        !allowance.available &&
        conversation.status !== "connected" && (
          <p role="status">
            {allowance.error ||
              (allowance.retry_at
                ? `Your next demo is available ${new Date(allowance.retry_at).toLocaleString()}.`
                : "The daily voice allowance has been reserved. Please try again after 24 hours.")}{" "}
            You can still explore the text preview and company setup.
          </p>
        )}
      {conversation.status === "connected" ? (
        <>
          <p role="status">
            {conversation.isSpeaking ? "Agent speaking…" : "Listening…"} ·{" "}
            {remaining}s remaining
          </p>
          <button
            className="button dark small"
            onClick={() => conversation.endSession()}
          >
            End conversation
          </button>
        </>
      ) : (
        <button
          className="button outline small"
          disabled={
            !enabled ||
            !allowance?.available ||
            starting ||
            conversation.status !== "disconnected"
          }
          onClick={start}
        >
          {starting ? "Connecting…" : "Start voice conversation"}
          <Icon name="phone" />
        </button>
      )}
      {starting && (
        <button
          type="button"
          className="text-link"
          onClick={() => {
            guard.current.cancel();
            setStarting(false);
            conversation.endSession();
          }}
        >
          Cancel connection
        </button>
      )}
      {!enabled && (
        <small>
          Save and publish your workspace, then configure voice to enable this
          test.
        </small>
      )}
      {error && (
        <p className="error-banner workspace-alert" role="alert">
          {error}
        </p>
      )}
      {conversationId && (
        <>
          <CallerDetails
            caller={caller}
            availability={caller?.availability_at_request}
          />
          <small>
            Updates appear when the agent saves confirmed details using its
            connected support tool.
          </small>
        </>
      )}
      {trackingError && <p role="status">{trackingError}</p>}
      {transcript.length > 0 && (
        <details>
          <summary>Live voice transcript</summary>
          <div aria-live="polite">
            {transcript.map((m, i) => (
              <p key={i}>
                <strong>{m.role}:</strong> {m.text}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
export default function VoiceTest(props) {
  return (
    <ConversationProvider>
      <VoiceSession {...props} />
    </ConversationProvider>
  );
}
