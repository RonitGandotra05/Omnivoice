"use client";
import Link from "next/link";
import { useAccount } from "@/components/AccountPreferences";
import SupportStudio from "@/components/SupportStudio";
export default function StudioAccess() {
  const { account, loading, loadError, refresh } = useAccount();
  if (loading)
    return (
      <div className="page-shell guide-page">
        <p role="status">Loading your account…</p>
      </div>
    );
  if (account?.email_verified) return <SupportStudio />;
  return (
    <div className="page-shell guide-page">
      <section
        className="panel account-form"
        style={{ maxWidth: 560, margin: "24px auto" }}
      >
        <p className="eyebrow">YOUR VOICE DEMO</p>
        <h1>Try it with your account.</h1>
        <p>Sign in with a verified account for up to 10 free minutes daily.</p>
        {loadError && (
          <p role="alert" className="error-banner">
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
        <Link
          className="button copper"
          href={account ? "/account/settings" : "/account"}
        >
          {account ? "Verify your account" : "Create account / sign in"}
        </Link>
        <Link className="text-link" href="/tutorial">
          See how it works
        </Link>
      </section>
    </div>
  );
}
