"use client";
import { useState, useRef } from "react";
import { studioRequest } from "@/lib/support/studio-client.mjs";
import CallerDetails from "@/components/CallerDetails";
export default function CallerJourney({
  profile,
  connected,
  dirty,
  local = true,
}) {
  const [fields, setFields] = useState({
    name: "",
    phone: "",
    email: "",
    reason: "",
    consent: false,
    callback_requested: false,
    callback_preference: "",
  });
  const [at, setAt] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const session = useRef(null);
  const active = useRef(false);
  const edit = (field, value) => setFields((f) => ({ ...f, [field]: value }));
  const run = async (action) => {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    session.current ||= `test-${crypto.randomUUID()}`;
    try {
      const body = {
        ...fields,
        name: fields.consent ? fields.name : "",
        phone: fields.consent ? fields.phone : "",
        email: fields.consent && fields.email ? fields.email : null,
        action,
        conversation_id: session.current,
      };
      if (!connected) {
        body.profile = profile;
        if (at) body.at = new Date(at).toISOString();
      }
      const data = await studioRequest(
        connected ? "caller-context" : "preview-caller",
        { method: "POST", body: JSON.stringify(body) },
      );
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return (
    <details className="caller-journey" open>
      <summary>Try the caller journey</summary>
      <p>
        {connected
          ? local
            ? "Save a test caller and follow-up request in this browser. No email is sent or telephone transfer performed."
            : "Save a test intake to your company workspace. Requesting human help creates a real support ticket and may send email."
          : "Use dummy details to preview caller capture and after-hours handling. Nothing is saved to the company database or sent by email."}
      </p>
      <div className="two-columns">
        {[
          ["name", "Caller name"],
          ["phone", "Callback number"],
          ["email", "Caller email"],
        ].map(([field, label]) => (
          <label key={field} className="field">
            {label}
            <input
              maxLength={field === "name" ? 120 : field === "phone" ? 30 : 254}
              type={
                field === "email" ? "email" : field === "phone" ? "tel" : "text"
              }
              value={fields[field]}
              onChange={(e) => edit(field, e.target.value)}
            />
          </label>
        ))}
        {!connected && (
          <label className="field">
            Simulated time (your device timezone)
            <input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
            <small>
              Leave empty to use the server clock. Results use the company
              timezone.
            </small>
          </label>
        )}
      </div>
      <label className="field">
        Reason for calling
        <textarea
          maxLength={2000}
          rows={2}
          value={fields.reason}
          onChange={(e) => edit("reason", e.target.value)}
        />
      </label>
      <label className="caller-consent">
        <input
          type="checkbox"
          checked={fields.consent}
          onChange={(e) => edit("consent", e.target.checked)}
        />{" "}
        Caller gave permission to save contact details
      </label>
      <label className="caller-consent">
        <input
          type="checkbox"
          checked={fields.callback_requested}
          onChange={(e) => edit("callback_requested", e.target.checked)}
        />{" "}
        Caller requested a callback
      </label>
      {fields.callback_requested && (
        <label className="field">
          Preferred callback window
          <input
            maxLength={300}
            value={fields.callback_preference}
            onChange={(e) => edit("callback_preference", e.target.value)}
            placeholder="Tomorrow afternoon, if possible"
          />
        </label>
      )}
      {connected && dirty && (
        <p role="status">
          Save company settings before running a connected caller test.
        </p>
      )}
      <div className="caller-actions">
        <button
          className="button outline small"
          disabled={busy || (connected && dirty)}
          onClick={() => run("capture")}
        >
          {busy
            ? "Working…"
            : connected
              ? "Save caller details"
              : "Preview caller details"}
        </button>
        <button
          className="button dark small"
          disabled={busy || (connected && dirty)}
          onClick={() => run("handoff")}
        >
          {connected ? "Request human help" : "Preview human request"}
        </button>
        <button
          className="text-link"
          disabled={busy}
          onClick={() => {
            session.current = null;
            setResult(null);
            setFields({
              name: "",
              phone: "",
              email: "",
              reason: "",
              consent: false,
              callback_requested: false,
              callback_preference: "",
            });
          }}
        >
          New test caller
        </button>
      </div>
      {error && (
        <p className="error-banner workspace-alert" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <CallerDetails
            caller={result.caller}
            availability={result.availability}
          />
          <small>{result.message}</small>
        </>
      )}
    </details>
  );
}
