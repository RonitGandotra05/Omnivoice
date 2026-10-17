"use client";
import { useEffect, useState } from "react";
export function useAuthCooldown() {
  const [until, setUntil] = useState(0),
    [now, setNow] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);
  const remaining = Math.max(
    0,
    Math.ceil((until - (now || Date.now())) / 1000),
  );
  return {
    remaining,
    limit: (response) => {
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after")) || 60;
        setNow(Date.now());
        setUntil(Date.now() + seconds * 1000);
      }
    },
    label:
      remaining >= 60 ? `${Math.ceil(remaining / 60)} min` : `${remaining}s`,
  };
}
export default function MfaVerify({
  endpoint = "/api/account/mfa-verify",
  onSuccess,
  onCancel,
  operator = false,
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recovery, setRecovery] = useState(false);
  const cooldown = useAuthCooldown();
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const code = new FormData(event.currentTarget).get("code");
    try {
      const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            ...(operator ? { action: "mfa-verify" } : {}),
          }),
        }),
        data = await response.json();
      cooldown.limit(response);
      if (!response.ok)
        throw Error(data.error || data.message || "Verification failed.");
      await onSuccess();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        operator ? endpoint : endpoint.replace(/mfa-verify$/, "mfa-cancel"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operator ? { action: "mfa-cancel" } : {}),
        },
      );
      if (!response.ok)
        throw Error("Could not cancel this sign-in step. Please try again.");
      onCancel();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mfa-verify">
      <p className="eyebrow">ONE MORE STEP</p>
      <h2>Confirm it’s you.</h2>
      <p>
        {recovery
          ? "Enter one of the recovery codes you saved when you enabled two-factor authentication."
          : "Open your authenticator app and enter a fresh six-digit code."}
      </p>
      <form onSubmit={submit}>
        <label className="field">
          {recovery ? "Recovery code" : "Authenticator code"}
          <input
            key={recovery ? "recovery" : "totp"}
            name="code"
            type="text"
            inputMode={recovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            pattern={
              recovery ? "[a-fA-F0-9]{4}(-[a-fA-F0-9]{4}){4}" : "[0-9]{6}"
            }
            minLength={recovery ? 24 : 6}
            maxLength={recovery ? 24 : 6}
            required
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {cooldown.remaining > 0 && (
          <p role="status">Try again in {cooldown.label}.</p>
        )}
        <button
          className="button copper full"
          disabled={busy || cooldown.remaining > 0}
        >
          {busy ? "Verifying…" : "Verify and sign in"}
        </button>
      </form>
      <button
        className="text-link"
        type="button"
        disabled={busy}
        onClick={() => {
          setRecovery(!recovery);
          setError("");
        }}
      >
        {recovery ? "Use an authenticator code" : "Use a recovery code"}
      </button>
      <button
        className="text-link"
        type="button"
        disabled={busy}
        onClick={cancel}
      >
        Start sign-in again
      </button>
    </div>
  );
}
