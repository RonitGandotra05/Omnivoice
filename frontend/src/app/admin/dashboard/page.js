"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
export default function Dashboard() {
  const [stats, setStats] = useState(null),
    [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (!token) {
      router.replace("/admin/login");
      return;
    }
    fetch("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            "Could not load workspace statistics. Check the administrator database connection.",
          );
        return r.json();
      })
      .then(setStats)
      .catch((e) => setError(e.message));
  }, [router]);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("authToken");
    router.replace("/admin/login");
  }
  return (
    <div className="page-shell">
      <div className="page-kicker">
        <span>WORKSPACE / OVERVIEW</span>
        <button className="text-link" onClick={logout}>
          Sign out <Icon name="arrow" />
        </button>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OMNIVOICE / OPERATOR STUDIO</p>
          <h1>
            Your conversations.
            <br />
            <em>In perspective.</em>
          </h1>
          <p>
            Existing workspace records, with a simpler place to shape your next
            agent.
          </p>
        </div>
        <Link href="/try-for-free" className="button copper">
          Open playground <Icon name="play" />
        </Link>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="stats-grid">
        {[
          ["totalCalls", "Recorded calls"],
          ["bookings", "Booking records"],
          ["complaints", "Complaints"],
          ["feedback", "Feedback"],
        ].map(([key, label]) => (
          <article className="panel" key={key}>
            <p className="eyebrow">{label}</p>
            <strong>{stats ? (stats[key] ?? 0) : "—"}</strong>
            <small>From your existing administrator database</small>
          </article>
        ))}
      </div>
      <div className="workflow">
        {[
          [
            "01",
            "Shape an agent",
            "Preview flows, edit context, and export a focused brief.",
            "/try-for-free",
          ],
          [
            "02",
            "Inspect records",
            "Manage existing workspace users and account data.",
            "/admin/users",
          ],
          [
            "03",
            "Connect the line",
            "Follow the voice platform setup workflow.",
            "/contact",
          ],
        ].map(([n, title, desc, href]) => (
          <article key={n}>
            <p className="eyebrow">{n} /</p>
            <h2>{title}</h2>
            <p>{desc}</p>
            <Link href={href} className="text-link">
              Open <Icon name="arrow" />
            </Link>
          </article>
        ))}
      </div>
      <p className="workspace-note">
        the voice platform conversation analytics remain in the provider
        dashboard. These counters display the existing app database and are not
        automatically synchronized with the voice platform.
      </p>
    </div>
  );
}
