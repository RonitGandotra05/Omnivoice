"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import UserEditor from "@/components/ui/UserEditor";
import { adminFetch } from "@/lib/admin-client";
export default function Users() {
  const [users, setUsers] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    try {
      setUsers(await adminFetch("/api/admin/users"));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function create(body) {
    await adminFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setAdding(false);
    await load();
  }
  return (
    <div className="page-shell">
      <div className="page-kicker">
        <span>WORKSPACE / ACCOUNTS</span>
        <Link href="/admin/dashboard" className="text-link">
          Back to workspace <Icon name="right" />
        </Link>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE PEOPLE BEHIND THE CONVERSATIONS</p>
          <h1>
            Your <em>team.</em>
          </h1>
          <p>Manage existing workspace accounts and administrator access.</p>
        </div>
        <button className="button copper" onClick={() => setAdding(!adding)}>
          {adding ? "Close form" : "Add account"}
          <Icon name={adding ? "close" : "arrow"} />
        </button>
      </div>
      {adding && <UserEditor creating onSave={create} />}{" "}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="panel account-table">
        <table>
          <caption className="eyebrow">
            {loading
              ? "Loading accounts…"
              : `${users.length} WORKSPACE ACCOUNTS`}
          </caption>
          <thead>
            <tr>
              <th>Name / email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign in</th>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>
                    {[user.first_name, user.last_name]
                      .filter(Boolean)
                      .join(" ") || user.email}
                  </strong>
                  <small>{user.email}</small>
                </td>
                <td>{user.is_admin ? "Administrator" : "User"}</td>
                <td>{user.is_active === false ? "Disabled" : "Active"}</td>
                <td>
                  {user.last_login
                    ? new Date(user.last_login).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })
                    : "Never"}
                </td>
                <td>
                  <Link className="text-link" href={`/admin/users/${user.id}`}>
                    Edit <Icon name="arrow" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !error && !users.length && (
          <p className="workspace-note">
            No accounts yet. Create an account to get started.
          </p>
        )}
      </div>
      <p className="workspace-note">
        Administrator access applies to this app’s existing database. Company
        knowledge APIs use the separate server-side operator key.
      </p>
    </div>
  );
}
