"use client";
import { useEffect, useState } from "react";
import { useAuthCooldown } from "@/components/MfaVerify";
export default function MfaSettings({ operator = false, account, onChanged }) {
  const [status, setStatus] = useState(null),
    [setup, setSetup] = useState(null),
    [codes, setCodes] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const cooldown = useAuthCooldown();
  const endpoint = operator ? "/api/auth/security/" : "/api/account/";
  useEffect(() => {
    if (operator)
      fetch(endpoint + "mfa-status", { cache: "no-store" })
        .then(async (r) => {
          const x = await r.json();
          if (!r.ok) throw Error(x.error || "Sign in to manage your security.");
          setStatus({
            ...x.mfa,
            has_password: x.has_password,
            required: x.required,
          });
        })
        .catch((e) => setError(e.message));
    else
      setStatus({
        enabled: account?.mfa_enabled,
        recovery_remaining: account?.mfa_recovery_remaining,
        has_password: account?.has_password,
      });
  }, [operator, account, endpoint]);
  async function action(kind, form) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint + kind, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        }),
        data = await response.json();
      cooldown.limit(response);
      if (!response.ok)
        throw Error(
          data.error || "Your security settings could not be updated.",
        );
      if (kind === "mfa-start") setSetup(data);
      else {
        setSetup(null);
        setStatus((current) => ({ ...current, ...data.mfa }));
        if (data.recovery_codes) setCodes(data.recovery_codes);
        setNotice(
          kind === "mfa-disable"
            ? "Two-factor authentication is disabled. Other sessions were signed out."
            : "Security settings updated. Other sessions were signed out.",
        );
        form.reset();
        await onChanged?.();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel mfa-settings">
      <p className="eyebrow">AN EXTRA LAYER</p>
      <h2>Two-factor authentication.</h2>
      <p>
        A password protects your account. An authenticator code adds a second
        check. Keep your recovery codes somewhere private.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-banner" role="status">
          {notice}
        </p>
      )}
      {cooldown.remaining > 0 && (
        <p role="status">Try again in {cooldown.label}.</p>
      )}
      {!status ? (
        <p role="status">Loading security settings…</p>
      ) : codes ? (
        <div className="recovery-codes">
          <h3>Save your recovery codes.</h3>
          <p>
            Each code works once. These codes are only shown now; we keep their
            hashes.
          </p>
          <textarea
            readOnly
            aria-label="Your recovery codes"
            value={codes.join("\n")}
            rows={10}
            spellCheck={false}
          />
          <button
            type="button"
            className="button copper"
            onClick={() => setCodes(null)}
          >
            I have saved my codes
          </button>
        </div>
      ) : (
        <>
          {operator && status.required && (
            <p>
              Operator workspace access requires two-factor authentication. If
              you disable it, complete setup again before opening the workspace.
            </p>
          )}
          <span
            className={
              "account-verification " + (status.enabled ? "verified" : "")
            }
          >
            {status.enabled
              ? "Two-factor authentication enabled"
              : "Two-factor authentication off"}
          </span>
          {status.enabled && (
            <p>{status.recovery_remaining || 0} recovery codes remain.</p>
          )}
          {setup && (
            <div className="mfa-enrollment">
              <p>
                Scan this code with your authenticator app, or enter the setup
                key manually. Setup expires in 10 minutes.
              </p>
              <img
                src={setup.qr_code}
                width="240"
                height="240"
                alt="Authenticator setup QR code"
              />
              <label className="field">
                Private setup key
                <input
                  readOnly
                  value={setup.secret}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(
                setup
                  ? "mfa-enable"
                  : status.enabled
                    ? e.nativeEvent.submitter?.value || "mfa-recovery"
                    : "mfa-start",
                e.currentTarget,
              );
            }}
          >
            {status.has_password ? (
              <label className="field">
                Current password
                <input
                  name="current_password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
              </label>
            ) : (
              <p>
                For security, sign in again if your last sign-in was more than
                five minutes ago.
              </p>
            )}
            {(setup || status.enabled) && (
              <label className="field">
                {setup
                  ? "Six-digit authenticator code"
                  : "Fresh authenticator code or recovery code"}
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode={setup ? "numeric" : "text"}
                  pattern={
                    setup
                      ? "[0-9]{6}"
                      : "[0-9]{6}|[a-fA-F0-9]{4}(-[a-fA-F0-9]{4}){4}"
                  }
                  maxLength={setup ? 6 : 24}
                  required
                  spellCheck={false}
                />
              </label>
            )}
            {status.enabled ? (
              <div className="mfa-actions">
                <button
                  className="button outline"
                  name="operation"
                  value="mfa-recovery"
                  disabled={busy || cooldown.remaining > 0}
                >
                  Replace recovery codes
                </button>
                <button
                  className="text-link"
                  name="operation"
                  value="mfa-disable"
                  disabled={busy || cooldown.remaining > 0}
                >
                  Disable two-factor authentication
                </button>
              </div>
            ) : (
              <button
                className="button copper"
                disabled={
                  busy ||
                  cooldown.remaining > 0 ||
                  (!operator && !account?.email_verified)
                }
              >
                {busy
                  ? "Please wait…"
                  : setup
                    ? "Confirm and enable"
                    : "Set up authenticator"}
              </button>
            )}
            {!operator && !account?.email_verified && (
              <small>
                Verify your email before enabling two-factor authentication.
              </small>
            )}
          </form>
          {setup && (
            <button
              className="text-link"
              type="button"
              disabled={busy}
              onClick={() => setSetup(null)}
            >
              Cancel setup
            </button>
          )}
        </>
      )}
    </section>
  );
}
