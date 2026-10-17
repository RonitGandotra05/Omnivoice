"use client";
import { useEffect, useRef, useState } from "react";
import { ACCOUNT_DEMO_SECONDS } from "@/lib/demo-limits.mjs";
import { createVoiceStartGuard } from "@/lib/voice-start.mjs";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import {
  studioRequest,
  runVoiceTool,
  searchVoiceKnowledge,
  recordVoiceTranscript,
} from "@/lib/support/studio-client.mjs";
import VoiceOrb from "@/components/VoiceOrb";
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

function VoiceSession({ enabled, unavailableReason, companyName, onPrepare }) {
  const [error, setError] = useState("");
  const [allowance, setAllowance] = useState(null);
  const [remaining, setRemaining] = useState(ACCOUNT_DEMO_SECONDS);
  const maxSeconds = useRef(ACCOUNT_DEMO_SECONDS);
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
    live.current = { id: "", transcript: [], started: 0, recorded: false };
    setTranscript([]);
    setConversationId("");
    setCaller(null);
    setTrackingError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Use a browser with microphone support over HTTPS or localhost.",
        );
      const permission = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      permission.getTracks().forEach((track) => track.stop());
      if (!guard.current.current(attempt)) return;
      await onPrepare?.(attempt.controller.signal);
      if (!guard.current.current(attempt)) return;
      const data = await studioRequest("voice/session", {
        method: "POST",
        signal: attempt.controller.signal,
      });
      if (!guard.current.current(attempt)) return;
      maxSeconds.current = data.max_seconds || ACCOUNT_DEMO_SECONDS;
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
      if (!guard.current.current(attempt)) await conversation.endSession();
    } catch (err) {
      refreshAllowance();
      if (guard.current.current(attempt))
        setError(
          err.name === "TimeoutError"
            ? "The voice connection timed out. Please try again."
            : err.name === "NotAllowedError"
              ? "Microphone access was blocked. Allow it in your browser settings and try again."
              : err.message,
        );
    } finally {
      if (guard.current.current(attempt)) setStarting(false);
      guard.current.finish(attempt);
    }
  };
  const connected = conversation.status === "connected";
  const state = connected
    ? conversation.isSpeaking
      ? "speaking"
      : "listening"
    : starting || conversation.status === "connecting"
      ? "connecting"
      : "idle";
  const label =
    state === "speaking"
      ? "Your agent is speaking"
      : state === "listening"
        ? "Listening to you"
        : state === "connecting"
          ? "Preparing your conversation…"
          : "Hear your company’s voice";
  return (
    <section
      className="voice-test-card live-voice-card"
      aria-label="Live voice demo"
    >
      <div className="live-voice-heading">
        <p className="eyebrow">A REAL CONVERSATION</p>
        <h3>{companyName || "Your support agent"}</h3>
        <p>No script to fill in. Just start talking.</p>
      </div>
      <VoiceOrb conversation={conversation} state={state}>
        <button
          type="button"
          className="voice-orb-button"
          aria-label={
            connected
              ? "End voice conversation"
              : starting
                ? "Preparing voice conversation"
                : "Start voice conversation"
          }
          disabled={
            !connected &&
            (!enabled ||
              !allowance?.available ||
              starting ||
              conversation.status !== "disconnected")
          }
          onClick={connected ? () => conversation.endSession() : start}
        >
          <Icon name={connected ? "phone" : "play"} />
        </button>
      </VoiceOrb>
      <div className="voice-live-status" role="status" aria-live="polite">
        <strong>{label}</strong>
        <span>
          {connected
            ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining · Select the phone to end`
            : "Microphone required · Up to 10 minutes daily"}
        </span>
      </div>
      {(starting || conversation.status === "connecting") && (
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
      {!enabled &&
        !starting &&
        !connected &&
        conversation.status !== "connecting" && (
          <p className="voice-help">
            {unavailableReason || "Voice is unavailable right now."}
          </p>
        )}
      {allowance?.account_required && (
        <Link className="button copper" href="/account">
          Sign in to talk <Icon name="arrow" />
        </Link>
      )}
      {allowance &&
        !allowance.account_required &&
        !allowance.available &&
        !connected &&
        !starting &&
        conversation.status !== "connecting" && (
          <p role="status">
            {allowance.error ||
              (allowance.retry_at
                ? `Your next demo is available ${new Date(allowance.retry_at).toLocaleString()}.`
                : "Your daily demo time has been reserved. Come back tomorrow.")}
          </p>
        )}
      {!connected && !starting && (
        <small>
          Starting shares your reviewed knowledge with your voice agent.
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
    </section>
  );
}
export default function VoiceTest(props) {
  return (
    <ConversationProvider>
      <VoiceSession {...props} />
    </ConversationProvider>
  );
}
