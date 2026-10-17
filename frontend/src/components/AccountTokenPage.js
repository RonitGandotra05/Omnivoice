"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/AccountPreferences";
export default function AccountTokenPage({ purpose }) {
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  const { refresh } = useAccount();
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setToken(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
          "/api/account/" +
            (purpose === "verify" ? "verify-email" : "reset-password"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              ...Object.fromEntries(new FormData(event.currentTarget)),
            }),
          },
        ),
        data = await response.json();
      if (!response.ok)
        throw Error(data.error || "This link could not be used.");
      setDone(true);
      setToken("");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-shell token-page">
      <section className="panel account-form">
        <p className="eyebrow">YOUR OMNIVOICE ACCOUNT</p>
        <h1>
          {purpose === "verify" ? "A little more connected." : "A fresh start."}
        </h1>
        {done ? (
          <>
            <p role="status">
              {purpose === "verify"
                ? "Your email is verified. Your 10-minute demo allowance is ready, subject to daily usage."
                : "Your password has been reset. Sign in with your new password."}
            </p>
            <Link
              className="button copper"
              href={purpose === "verify" ? "/account/settings" : "/account"}
            >
              Continue to your account
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>
              {purpose === "verify"
                ? "Confirm your email to unlock your account demo."
                : "Choose a new password. Existing sessions will be signed out."}
            </p>
            {purpose === "reset" && (
              <label className="field">
                New password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                />
                <small>At least 12 characters; up to 72 bytes.</small>
              </label>
            )}
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            {!token && (
              <p role="status">
                Open the full link from your email. Links expire after 30
                minutes.
              </p>
            )}
            <button className="button copper" disabled={busy || !token}>
              {busy
                ? "Please wait…"
                : purpose === "verify"
                  ? "Verify my email"
                  : "Reset password"}
            </button>
            <Link href="/account" className="text-link">
              Back to your account
            </Link>
          </form>
        )}
      </section>
    </div>
  );
}
