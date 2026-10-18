"use client";
import MfaSettings from "@/components/MfaSettings";
import { ACCOUNT_DEMO_SECONDS } from "@/lib/demo-limits.mjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/AccountPreferences";
import Icon from "@/components/ui/Icon";
export default function AccountSettings() {
  const {
    account,
    loading,
    loadError,
    refresh,
    logout,
    theme,
    setTheme,
    allowance,
  } = useAccount();
  const router = useRouter();
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (account?.name) setName(account.name);
  }, [account?.name]);
  useEffect(() => {
    const update = () => refresh({ preserveTheme: true });
    const timer = setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [refresh]);
  async function action(kind, body = {}) {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      if (kind === "logout" || kind === "logout-all") {
        await logout(kind === "logout-all");
        router.push("/account");
        return;
      }
      const response = await fetch("/api/account/" + kind, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        data = await response.json();
      if (!response.ok)
        throw Error(data.error || "Your changes could not be saved.");
      await refresh();
      setNotice(
        kind === "send-verification"
          ? "Verification email sent. Check your inbox."
          : kind === "password"
            ? "Password updated. Other sessions have been signed out."
            : "Your account settings have been saved.",
      );
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="page-shell settings-page">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h1>
            Make yourself <em>at home.</em>
          </h1>
          <p>Your details, your preferences, your next conversation.</p>
        </div>
        <Link className="button outline" href="/try-for-free">
          Open studio
          <Icon name="arrow" />
        </Link>
      </header>
      {loading ? (
        <p role="status">Loading your settings…</p>
      ) : !account ? (
        <section className="panel settings-panel">
          <h2>Sign in to manage your account.</h2>
          {loadError && <p role="alert">{loadError}</p>}
          <Link href="/account" className="button copper">
            Sign in / create account
            <Icon name="arrow" />
          </Link>
        </section>
      ) : (
        <>
          <div className="settings-feedback" aria-live="polite">
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="success-banner">
                {notice}
              </p>
            )}
          </div>
          <div className="settings-grid">
            <MfaSettings account={account} onChanged={refresh} />
            <section className="panel settings-panel">
              <p className="eyebrow">01 / THE ESSENTIALS</p>
              <h2>Personal details.</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action("settings", { name, theme });
                }}
              >
                <label className="field">
                  Display name
                  <input
                    name="name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  Email address
                  <input type="email" value={account.email} readOnly />
                  <small>Your email is provided by Google.</small>
                </label>
                <span
                  className={
                    "account-verification " +
                    (account.email_verified ? "verified" : "")
                  }
                >
                  {account.email_verified
                    ? "Email verified"
                    : "Email verification pending"}
                </span>
                <button className="button copper" disabled={!!busy}>
                  {busy === "settings" ? "Saving…" : "Save details"}
                  <Icon name="check" />
                </button>
              </form>
            </section>
            <section className="panel settings-panel">
              <p className="eyebrow">02 / YOUR SPACE</p>
              <h2>A change of atmosphere.</h2>
              <p>
                Choose a look that feels right. Your preference follows your
                account.
              </p>
              <div
                className="theme-options"
                role="group"
                aria-label="Appearance"
              >
                {[
                  ["light", "Light"],
                  ["dark", "Dark"],
                  ["system", "Use device"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={
                      "theme-choice " + (theme === value ? "selected" : "")
                    }
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                  >
                    <span
                      className={"theme-swatch swatch-" + value}
                      aria-hidden="true"
                    >
                      <i />
                      <i />
                    </span>
                    {label}
                    {theme === value && <Icon name="check" />}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="button outline"
                disabled={!!busy}
                onClick={() =>
                  action("settings", { name: account.name, theme })
                }
              >
                Save appearance
                <Icon name="check" />
              </button>
              <small>
                Changes preview immediately on this device. Save to use them
                when you sign in elsewhere.
              </small>
            </section>
            <section className="panel settings-panel">
              <p className="eyebrow">03 / TIME TO TALK</p>
              <h2>Your free voice demo.</h2>
              <div className="usage-number">
                {Math.floor((allowance?.max_seconds || 0) / 60)}
                <span>
                  min {(allowance?.max_seconds || 0) % 60 || ""}{" "}
                  {(allowance?.max_seconds || 0) % 60 ? "sec" : ""} available
                </span>
              </div>
              <progress
                value={Math.min(
                  allowance?.used_seconds || 0,
                  allowance?.budget_seconds || ACCOUNT_DEMO_SECONDS,
                )}
                max={allowance?.budget_seconds || ACCOUNT_DEMO_SECONDS}
                aria-label="Daily voice demo time reserved"
              />
              <p>
                {account.email_verified
                  ? "Up to 10 minutes every 24 hours."
                  : "Verify your email for up to 10 minutes every 24 hours."}{" "}
                Time is reserved when your conversation starts.
              </p>
              {allowance?.retry_at && (
                <small>
                  Next availability:{" "}
                  {new Date(allowance.retry_at).toLocaleString()}
                </small>
              )}
              <Link className="text-link" href="/try-for-free">
                Try your voice agent
                <Icon name="arrow" />
              </Link>
            </section>
            <section className="panel settings-panel">
              <p className="eyebrow">04 / PEACE OF MIND</p>
              <h2>Account security.</h2>
              <p>
                You sign in with Google. Manage your Google password and Google
                security settings in your Google account.
              </p>
              <div className="settings-signout">
                <button
                  className="text-link"
                  type="button"
                  disabled={!!busy}
                  onClick={() => action("logout")}
                >
                  Sign out
                </button>
                <button
                  className="text-link"
                  type="button"
                  disabled={!!busy}
                  onClick={() => action("logout-all")}
                >
                  Sign out of all devices
                </button>
              </div>
              <small>
                Signing out of all devices invalidates existing sessions. Your
                company workspace stays in this browser.
              </small>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
