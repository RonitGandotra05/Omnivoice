"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
export default function AccountPage() {
  const [mode, setMode] = useState("register"),
    [account, setAccount] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/account/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((x) => setAccount(x.account || null))
      .catch(() => {});
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/account/" + mode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Please try again.");
      setAccount(data.account);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/account/logout", { method: "POST" });
    setAccount(null);
  }
  return (
    <div className="page-shell account-page">
      <section className="account-intro">
        <p className="eyebrow">YOUR BUSINESS. YOUR VOICE.</p>
        <h1>
          A little more
          <br />
          <em>connected.</em>
        </h1>
        <p>
          Create your account to keep your identity connected to your trials and
          request longer access.
        </p>
        <div className="account-note">
          <Icon name="phone" />
          <p>
            Your free voice demo lasts up to 60 seconds, once per network and
            browser every 24 hours. Creating an account keeps the same daily
            allowance. Longer trials require approval.
          </p>
        </div>
        <p className="muted">
          Company documents and caller details stay in this browser. Your
          account does not automatically upload them.
        </p>
      </section>
      <section className="panel account-form">
        {account ? (
          <>
            <p className="eyebrow">SIGNED IN</p>
            <h2>Hello, {account.name}.</h2>
            <p>{account.email}</p>
            <p>
              {account.extended_access
                ? "Your account has approved extended trial access."
                : "Your account is ready. Explore the studio or contact us about a longer trial."}
            </p>
            <Link className="button copper full" href="/try-for-free">
              Open agent studio <Icon name="arrow" />
            </Link>
            <Link className="text-link" href="/contact">
              Request longer access
            </Link>
            <button className="text-link" onClick={logout}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow">
              {mode === "register" ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}
            </p>
            <h2>
              {mode === "register"
                ? "Start a conversation."
                : "Back to your studio."}
            </h2>
            <div className="account-tabs">
              <button
                className={mode === "register" ? "active" : ""}
                onClick={() => {
                  setMode("register");
                  setError("");
                }}
              >
                Create account
              </button>
              <button
                className={mode === "login" ? "active" : ""}
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                Sign in
              </button>
            </div>
            <form onSubmit={submit}>
              {mode === "register" && (
                <label className="field">
                  Name
                  <input
                    name="name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={100}
                    required
                  />
                </label>
              )}
              <label className="field">
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
              <label className="field">
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  minLength={12}
                  maxLength={72}
                  required
                />
                <small>
                  At least 12 characters. Never share this password with the
                  voice agent.
                </small>
              </label>
              {error && (
                <p role="alert" className="error-banner">
                  {error}
                </p>
              )}
              <button disabled={busy} className="button copper full">
                {busy
                  ? "Please wait…"
                  : mode === "register"
                    ? "Create account"
                    : "Sign in"}
                <Icon name="arrow" />
              </button>
            </form>
            <Link href="/try-for-free" className="text-link">
              Explore the free demo <Icon name="right" />
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
