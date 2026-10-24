"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACCOUNT_DEMO_SECONDS } from "@/lib/demo-limits.mjs";
import {
  createVoiceStartGuard,
  waitForVoiceConnection,
  canStartVoice,
} from "@/lib/voice-start.mjs";
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
  const allowanceRequest = useRef(null);
  const mounted = useRef(true);
  const refreshAllowance = useCallback(() => {
    if (!mounted.current) return Promise.resolve();
    if (allowanceRequest.current) return allowanceRequest.current;
    allowanceRequest.current = serverRequest("demo/allowance", null, {
      method: "GET",
    })
      .then((value) => {
        if (mounted.current) setAllowance(value);
      })
      .catch(() => {
        if (mounted.current)
          setAllowance({
            available: false,
            error:
              "Voice demo availability could not be verified. Please try again shortly.",
          });
      })
      .finally(() => {
        allowanceRequest.current = null;
      });
    return allowanceRequest.current;
  }, []);
  useEffect(() => {
    mounted.current = true;
    let timer;
    const poll = async () => {
      await refreshAllowance();
      if (mounted.current) timer = setTimeout(poll, 15000);
    };
    poll();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [refreshAllowance]);
  const [starting, setStarting] = useState(false);
  const [phase, setPhase] = useState("");
  const [ending, setEnding] = useState(false);
  const readiness = useRef(null);
  const intentionalEnd = useRef(false);
  const endLock = useRef(false);
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
      readiness.current?.failed(
        new DOMException("Connection cancelled", "AbortError"),
      );
      saveTranscriptSnapshot(live.current);
    },
    [],
  );
  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      readiness.current?.connected();
      live.current = {
        id: conversationId,
        transcript: [],
        started: Date.now(),
        recorded: false,
      };
      setConversationId(conversationId);
    },
    onDisconnect: (details) => {
      readiness.current?.failed();
      setEnding(false);
      endLock.current = false;
      if (!intentionalEnd.current && details?.reason === "error")
        setError(
          "The connection was interrupted. Check your network and start a new conversation when your allowance refreshes.",
        );
      saveTranscriptSnapshot(live.current);
      refreshAllowance();
    },
    onMessage: (message) => {
      const entry = { role: message.source, text: message.message };
      live.current.transcript = [...live.current.transcript, entry].slice(-100);
      setTranscript(live.current.transcript);
    },
    onError: () => {
      setEnding(false);
      endLock.current = false;
      readiness.current?.failed(
        new Error(
          "Voice connection failed. Check your network and microphone access.",
        ),
      );
      setError(
        "Voice connection failed. Check the company agent, browser microphone access, and provider configuration.",
      );
    },
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
      if (!left && !endLock.current) {
        endLock.current = true;
        intentionalEnd.current = true;
        setEnding(true);
        Promise.resolve(endSession()).catch(() => {
          endLock.current = false;
          setEnding(false);
          setError("The conversation could not be ended. Try again.");
        });
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [voiceStatus, endSession]);
  const start = async () => {
    if (
      !enabled ||
      !allowance?.available ||
      !canStartVoice(conversation.status)
    )
      return;
    const attempt = guard.current.begin();
    if (!attempt) return;
    setStarting(true);
    intentionalEnd.current = false;
    setPhase("Waiting for microphone permission…");
    setError("");
    live.current = { id: "", transcript: [], started: 0, recorded: false };
    setTranscript([]);
    setConversationId("");
    setCaller(null);
    setTrackingError("");
    let reservationId;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Use a browser with microphone support over HTTPS or localhost.",
        );
      const permissionRequest = navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      // Permission prompts cannot be aborted; release tracks even after cancel.
      const released = permissionRequest.then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      const microphoneWait = waitForVoiceConnection(
        attempt.controller.signal,
        30000,
      );
      released.then(microphoneWait.connected, microphoneWait.failed);
      await microphoneWait.promise;
      if (!guard.current.current(attempt)) return;
      setPhase("Preparing your company knowledge…");
      await onPrepare?.(attempt.controller.signal);
      if (!guard.current.current(attempt)) return;
      setPhase("Securing your voice connection…");
      const data = await studioRequest("voice/session", {
        method: "POST",
        signal: attempt.controller.signal,
      });
      reservationId = data.reservation_id;
      if (!guard.current.current(attempt)) {
        if (reservationId)
          await studioRequest("voice/cancel", {
            method: "POST",
            body: { reservation_id: reservationId },
          });
        return;
      }
      maxSeconds.current = data.max_seconds || ACCOUNT_DEMO_SECONDS;
      setRemaining(maxSeconds.current);
      setAllowance((previous) => ({ ...previous, available: false }));
      setPhase("Connecting your microphone to the agent…");
      const ready = waitForVoiceConnection(attempt.controller.signal);
      readiness.current = ready;
      // Attach rejection handling before calling the SDK (which may return void).
      const connectedPromise = ready.promise;
      connectedPromise.catch(() => {});
      try {
        const result = conversation.startSession({
          signedUrl: data.signed_url,
          connectionType: "websocket",
          clientTools: {
            support_call: async (values) => {
              const id = live.current.id;
              const result = await runVoiceTool(values, id);
              if (mounted.current && live.current.id === id && result.caller) {
                setCaller(result.caller);
                setTrackingError("");
              }
              return JSON.stringify(result);
            },
            search_company_knowledge: async (values) =>
              JSON.stringify(await searchVoiceKnowledge(values.query)),
          },
        });
        Promise.resolve(result).catch(ready.failed);
        await connectedPromise;
      } catch (error) {
        ready.failed(error);
        throw error;
      }
    } catch (err) {
      if (guard.current.current(attempt)) {
        intentionalEnd.current = true;
        conversation.endSession();
      }
      if (reservationId) {
        try {
          await studioRequest("voice/cancel", {
            method: "POST",
            body: { reservation_id: reservationId },
          });
        } catch {}
      }
      refreshAllowance();
      if (guard.current.current(attempt) && err.name !== "AbortError")
        setError(
          err.name === "TimeoutError"
            ? "The voice connection timed out. Please try again."
            : err.name === "NotAllowedError"
              ? "Microphone access was blocked. Allow it in your browser settings and try again."
              : err.name === "NotFoundError"
                ? "No microphone was found. Connect a microphone and try again."
                : err.name === "NotReadableError"
                  ? "Your microphone is busy or unavailable. Close other apps using it and try again."
                  : err.message,
        );
    } finally {
      if (guard.current.current(attempt)) {
        setStarting(false);
        readiness.current = null;
      }
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
    ending || conversation.status === "disconnecting"
      ? "Ending your conversation…"
      : state === "speaking"
        ? "Your agent is speaking"
        : state === "listening"
          ? "Listening to you"
          : state === "connecting"
            ? phase || "Preparing your conversation…"
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
            ending ||
            conversation.status === "disconnecting" ||
            (!connected &&
              (!enabled ||
                !allowance?.available ||
                starting ||
                !canStartVoice(conversation.status)))
          }
          onClick={
            connected
              ? () => {
                  if (endLock.current) return;
                  endLock.current = true;
                  intentionalEnd.current = true;
                  setEnding(true);
                  conversation.endSession();
                }
              : start
          }
        >
          <Icon name={connected ? "phone" : "play"} />
        </button>
      </VoiceOrb>
      <div className="voice-live-status" role="status" aria-live="polite">
        <strong>{label}</strong>
        <span>
          {connected
            ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining · Select the phone to end`
            : allowance?.available
              ? `${Math.floor(allowance.max_seconds / 60)}:${String(allowance.max_seconds % 60).padStart(2, "0")} left today · Microphone required`
              : "Microphone required · Up to 10 minutes daily"}
        </span>
      </div>
      {(starting || conversation.status === "connecting") && (
        <button
          type="button"
          className="text-link"
          onClick={() => {
            intentionalEnd.current = true;
            setPhase("Cancelling connection…");
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
              (allowance.pending_seconds > 0
                ? "Checking your last connection. Unused time returns after the voice provider confirms the call ended. This updates automatically."
                : allowance.retry_at
                  ? `Your next demo is available ${new Date(allowance.retry_at).toLocaleString()}.`
                  : "Voice availability is being checked. Please try again shortly.")}
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
