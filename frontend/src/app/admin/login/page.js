"use client";
import MfaVerify, { useAuthCooldown } from "@/components/MfaVerify";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import Icon from "@/components/ui/Icon";
export default function Login() {
  const router = useRouter();
  const cooldown = useAuthCooldown();
  const [mfa, setMfa] = useState(false);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      const body = await res.json();
      cooldown.limit(res);
      if (!res.ok) throw new Error(body.message || "Sign in failed.");
      if (body.mfa_required) {
        setMfa(true);
        return;
      }
      localStorage.removeItem("authToken");
      router.push(body.setup_required ? "/admin/security" : "/admin/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="page-shell login">
      <div className="login-art">
        <Image
          src="/voice-sculpture.png"
          alt=""
          fill
          sizes="(max-width: 760px) 100vw, 50vw"
        />
        <div>
          <p className="eyebrow">OMNIVOICE / YOUR WORKSPACE</p>
          <h1>
            Welcome
            <br />
            <em>back.</em>
          </h1>
          <p>Good conversations start with a thoughtful brief.</p>
        </div>
      </div>
      {mfa ? (
        <section className="panel login-form">
          <MfaVerify
            operator
            endpoint="/api/auth/login"
            onSuccess={() => router.push("/admin/dashboard")}
            onCancel={() => setMfa(false)}
          />
        </section>
      ) : (
        <form className="panel login-form" onSubmit={submit}>
          <p className="eyebrow">OPERATOR SIGN IN</p>
          <h2>Back to your studio.</h2>
          <p>Use your existing administrator account.</p>
          <label className="field">
            Email
            <input type="email" name="email" autoComplete="username" required />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
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
            disabled={loading || cooldown.remaining > 0}
          >
            {loading ? "Signing in…" : "Sign in"}
            <Icon name="arrow" />
          </button>
          <Link href="/docs" className="text-link">
            Read the setup guide <Icon name="right" />
          </Link>
        </form>
      )}
    </div>
  );
}
