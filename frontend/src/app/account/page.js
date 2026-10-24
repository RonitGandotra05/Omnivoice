"use client";
import MfaVerify from "@/components/MfaVerify";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { useAccount } from "@/components/AccountPreferences";
const messages = {
  UseOriginalMethod:
    "This email belongs to an older account. Contact support to move it to Google sign-in.",
  VerifiedEmailRequired: "Use a verified Gmail or Google Workspace account.",
  SignInUnavailable:
    "Google sign-in is unavailable right now. Please try again later.",
};
export default function AccountPage() {
  const { account, providers, loading, loadError, refresh } = useAccount();
  const router = useRouter();
  const [mfa, setMfa] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    setMfa(params.get("mfa") === "1");
    if (params.get("error"))
      setError(
        messages[params.get("error")] ||
          "Sign-in was not completed. Please try again.",
      );
  }, []);
  function destination() {
    const value = new URL(window.location.href).searchParams.get("callbackUrl");
    return value?.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\")
      ? value
      : "/try-for-free";
  }
  async function google() {
    setBusy(true);
    setError("");
    try {
      await signIn("google", { callbackUrl: destination() });
    } catch {
      setError("Google sign-in could not be started. Please try again.");
      setBusy(false);
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
        <p>Bring your documents, build your agent, and hear it in action.</p>
        <div className="account-benefit">
          <strong>
            10<span>min</span>
          </strong>
          <div>
            <h2>Your voice. On us.</h2>
            <p>Up to 10 free minutes of voice demo time every 24 hours.</p>
          </div>
        </div>
        <p className="account-fine-print">
          Your documents stay in this browser until you publish them.
        </p>
      </section>
      <section className="panel account-form" aria-label="Your account">
        {loadError && (
          <p className="error-banner" role="alert">
            {loadError}{" "}
            <button
              type="button"
              className="text-link"
              onClick={() => refresh()}
            >
              Retry
            </button>
          </p>
        )}
        {loading ? (
          <p role="status">Loading your account…</p>
        ) : mfa ? (
          <MfaVerify
            onSuccess={async () => {
              await refresh();
              router.push(destination());
            }}
            onCancel={() => {
              setMfa(false);
              router.replace("/account");
            }}
          />
        ) : account ? (
          <>
            <p className="eyebrow">WELCOME BACK</p>
            <h2>Hello, {account.name}.</h2>
            <p className="account-email">{account.email}</p>
            <Link className="button copper full" href="/try-for-free">
              Open agent studio <Icon name="arrow" />
            </Link>
            <Link className="text-link" href="/account/settings">
              Account settings <Icon name="right" />
            </Link>
          </>
        ) : (
          <>
            <p className="eyebrow">A SPACE FOR YOUR VOICE</p>
            <h2>Continue with Google.</h2>
            <p>Use your Google account to sign in or create an account.</p>
            <button
              type="button"
              className="social-button"
              disabled={!providers.google || busy}
              onClick={google}
            >
              <span
                className="provider-mark provider-google"
                aria-hidden="true"
              >
                G
              </span>
              {busy ? "Connecting…" : "Continue with Google"}
            </button>
            {!providers.google && (
              <p role="status">
                Google sign-in is not available yet. Please check back soon.
              </p>
            )}
            <small>
              We use your Google name and verified email. No separate password
              or email code.
            </small>
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            <Link href="/docs" className="text-link">
              Read the setup guide <Icon name="right" />
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
