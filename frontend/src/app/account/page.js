"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { useAccount } from "@/components/AccountPreferences";
const oauthErrors = {
  UseOriginalMethod:
    "This email already has an account. Use the same sign-in method you used to create it.",
  VerifiedEmailRequired:
    "Choose a provider account with a verified email address.",
  SignInUnavailable: "Sign-in is unavailable right now. Please try again.",
  AccessDenied: "Sign-in was not completed. Please try again.",
};
export default function AccountPage() {
  const { account, providers, loading, refresh } = useAccount();
  const router = useRouter();
  const [mode, setMode] = useState("register"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const code = new URL(window.location.href).searchParams.get("error");
    if (code)
      setError(
        oauthErrors[code] || "We could not complete sign-in. Please try again.",
      );
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy("email");
    setError("");
    setNotice("");
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(
          "/api/account/" + (mode === "reset" ? "reset-request" : mode),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          },
        ),
        data = await response.json();
      if (!response.ok) throw Error(data.error || "Please try again.");
      if (mode === "reset") {
        setNotice(data.message);
        return;
      }
      await refresh();
      router.push("/account/settings");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function social(provider) {
    setBusy(provider);
    setError("");
    try {
      await signIn(provider, { callbackUrl: "/account/settings" });
    } catch {
      setError("Sign-in could not be started. Please try again.");
      setBusy("");
    }
  }
  return (
    <div className="page-shell account-page account-welcome">
      <section className="account-intro">
        <p className="eyebrow">YOUR BUSINESS. YOUR VOICE.</p>
        <h1>
          Good support
          <br />
          starts with
          <br />
          <em>a conversation.</em>
        </h1>
        <p>
          Make your business sound like you. Bring your documents, build your
          agent, and hear it in action.
        </p>
        <div className="account-benefit">
          <strong>
            10<span>min</span>
          </strong>
          <div>
            <h2>Your voice. On us.</h2>
            <p>
              Verify your account for up to 10 free minutes of voice demo time
              every 24 hours.
            </p>
          </div>
        </div>
        <ul className="account-benefits">
          <li>
            <Icon name="check" />
            One account for your email
          </li>
          <li>
            <Icon name="check" />
            Private, secure sign-in
          </li>
          <li>
            <Icon name="check" />
            No payment card needed
          </li>
        </ul>
        <p className="account-fine-print">
          Daily limits also apply to your network and browser. Company documents
          stay in this browser unless you publish them to your agent.
        </p>
      </section>
      <section className="panel account-form" aria-label="Your account">
        {loading ? (
          <p role="status">Loading your account…</p>
        ) : account ? (
          <>
            <p className="eyebrow">WELCOME BACK</p>
            <h2>Hello, {account.name}.</h2>
            <p className="account-email">{account.email}</p>
            <p>Your studio is ready when you are.</p>
            <Link className="button copper full" href="/try-for-free">
              Open agent studio
              <Icon name="arrow" />
            </Link>
            <Link className="button outline full" href="/account/settings">
              Account settings
              <Icon name="right" />
            </Link>
          </>
        ) : (
          <>
            <p className="eyebrow">
              {mode === "register"
                ? "A SPACE FOR YOUR VOICE"
                : mode === "reset"
                  ? "LET’S GET YOU BACK IN"
                  : "WELCOME BACK"}
            </p>
            <h2>
              {mode === "register"
                ? "Create your account."
                : mode === "reset"
                  ? "Reset your password."
                  : "Back to your studio."}
            </h2>
            {mode !== "reset" && (
              <>
                <div className="social-options">
                  {[
                    ["google", "Google"],
                    ["apple", "Apple"],
                    ["github", "GitHub"],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      type="button"
                      className="social-button"
                      disabled={!providers[id] || !!busy}
                      title={
                        !providers[id]
                          ? name + " sign-in is not available yet"
                          : undefined
                      }
                      onClick={() => social(id)}
                    >
                      <span
                        className={"provider-mark provider-" + id}
                        aria-hidden="true"
                      >
                        {id === "google" ? (
                          "G"
                        ) : id === "apple" ? (
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M16.7 3c-.8 0-1.8.5-2.4 1.2-.5.6-1 1.5-.9 2.4.9.1 1.8-.4 2.4-1.1.6-.7 1-1.6.9-2.5ZM19.7 16.7c-.5 1.2-.8 1.8-1.5 2.8-.9 1.3-2.1 2.9-3.5 2.9-1.2 0-1.5-.8-3.2-.8-1.6 0-2 .8-3.2.8-1.4 0-2.5-1.5-3.4-2.8C2.4 16 2 11.3 3.7 8.9 4.8 7.2 6.5 6.3 8.2 6.3c1.3 0 2.2.8 3.3.8 1.1 0 1.9-.8 3.3-.8 1.5 0 3.1.8 4.2 2.1-3.7 2-3.1 7.3.7 8.3Z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82c.85 0 1.71.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
                          </svg>
                        )}
                      </span>
                      {busy === id ? "Connecting…" : "Continue with " + name}
                      {!providers[id] && <small>Soon</small>}
                    </button>
                  ))}
                </div>
                <div className="account-divider">
                  <span>or use your email</span>
                </div>
                <div
                  className="account-tabs"
                  role="group"
                  aria-label="Account access"
                >
                  {[
                    ["register", "Create account"],
                    ["login", "Sign in"],
                  ].map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={mode === value}
                      disabled={!!busy}
                      className={mode === value ? "active" : ""}
                      onClick={() => {
                        setMode(value);
                        setError("");
                        setNotice("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <form onSubmit={submit} key={mode}>
              {mode === "register" && (
                <label className="field">
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={100}
                    required
                    placeholder="How should we call you?"
                  />
                </label>
              )}
              <label className="field">
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  placeholder="you@company.com"
                />
              </label>
              {mode !== "reset" && (
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
                  <small>At least 12 characters; up to 72 bytes.</small>
                </label>
              )}
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
              <button disabled={!!busy} className="button copper full">
                {busy
                  ? "Please wait…"
                  : mode === "register"
                    ? "Create account"
                    : mode === "reset"
                      ? "Send reset link"
                      : "Sign in"}
                <Icon name="arrow" />
              </button>
            </form>
            {mode === "register" && (
              <small>
                Verify your email to unlock the 10-minute demo. We’ll send you a
                link to confirm your email.
              </small>
            )}
            {mode !== "register" && (
              <button
                type="button"
                className="text-link"
                disabled={!!busy}
                onClick={() => {
                  setMode(mode === "reset" ? "login" : "reset");
                  setError("");
                  setNotice("");
                }}
              >
                {mode === "reset" ? "Back to sign in" : "Forgot your password?"}
              </button>
            )}
            <Link href="/try-for-free" className="text-link">
              Explore without an account
              <Icon name="right" />
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
