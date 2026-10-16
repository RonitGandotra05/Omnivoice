"use client";
import { useState, useRef } from "react";
import { studioRequest } from "@/lib/support/studio-client.mjs";
export default function CallTranscript({ call }) {
  const [rows, setRows] = useState(call.transcript || []);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(!call.transcript_deferred);
  const pending = useRef(false);
  return (
    <details
      onToggle={async (event) => {
        if (!event.currentTarget.open || loaded || pending.current) return;
        pending.current = true;
        try {
          const data = await studioRequest(`conversations/${call.id}`);
          setRows(data.transcript);
          setLoaded(true);
        } catch (error) {
          setError(error.message);
        } finally {
          pending.current = false;
        }
      }}
    >
      <summary>Transcript</summary>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <pre>
          {loaded
            ? rows.map((t) => `${t.role}: ${t.message || ""}`).join("\n")
            : "Loading transcript…"}
        </pre>
      )}
    </details>
  );
}
