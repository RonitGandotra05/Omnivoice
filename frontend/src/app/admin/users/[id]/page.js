"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import UserEditor from "@/components/ui/UserEditor";
import { adminFetch } from "@/lib/admin-client";
export default function UserDetails() {
  const { id } = useParams(),
    router = useRouter();
  const [user, setUser] = useState(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [deleting, setDeleting] = useState(false);
  useEffect(() => {
    adminFetch(`/api/admin/users/${id}`)
      .then(setUser)
      .catch((e) => setError(e.message));
  }, [id]);
  async function save(body) {
    await adminFetch(`/api/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setSaved(true);
  }
  async function remove() {
    if (!window.confirm(`Permanently delete ${user.email}?`)) return;
    setDeleting(true);
    try {
      await adminFetch(`/api/admin/users/${id}`, { method: "DELETE" });
      router.push("/admin/users");
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  }
  return (
    <div className="page-shell">
      <div className="page-kicker">
        <span>WORKSPACE / ACCOUNT DETAILS</span>
        <Link href="/admin/users" className="text-link">
          Back to team <Icon name="right" />
        </Link>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACCOUNT SETTINGS</p>
          <h1>
            A place for <em>everyone.</em>
          </h1>
          <p>{user?.email || "Loading account…"}</p>
        </div>
        {user && !user.is_admin && (
          <button
            className="button outline"
            disabled={deleting}
            onClick={remove}
          >
            Delete account
          </button>
        )}
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="success-banner" role="status">
          Account saved.
        </p>
      )}
      {user && <UserEditor user={user} onSave={save} />}
      <p className="workspace-note">
        Leave the new password empty to keep the current password. The last
        administrator cannot be demoted.
      </p>
    </div>
  );
}
