"use client";
import { useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import Icon from "@/components/ui/Icon";

function VoiceSession({ enabled }) {
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const conversation = useConversation({
    onMessage: (message) =>
      setTranscript((t) =>
        [...t, { role: message.source, text: message.message }].slice(-100),
      ),
    onError: () =>
      setError(
        "Voice connection failed. Check the company agent, browser microphone access, and provider configuration.",
      ),
  });
  const start = async () => {
    if (starting || conversation.status !== "disconnected") return;
    setStarting(true);
    setError("");
    setTranscript([]);
    try {
      const response = await fetch("/api/studio/voice/session", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Voice session unavailable");
      await conversation.startSession({
        signedUrl: data.signed_url,
        connectionType: "websocket",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
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
        Speak with your configured company agent. This uses your microphone and
        sends audio to the voice platform. Calls may use billable provider
        credits.
      </p>
      {conversation.status === "connected" ? (
        <>
          <p role="status">
            {conversation.isSpeaking ? "Agent speaking…" : "Listening…"}
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
            !enabled || starting || conversation.status !== "disconnected"
          }
          onClick={start}
        >
          {starting ? "Connecting…" : "Start voice conversation"}
          <Icon name="phone" />
        </button>
      )}
      {!enabled && (
        <small>
          Load a connected workspace and configure voice to enable voice.
        </small>
      )}
      {error && (
        <p className="error-banner workspace-alert" role="alert">
          {error}
        </p>
      )}
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
