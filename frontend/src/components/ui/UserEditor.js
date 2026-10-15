"use client";
import { useState } from "react";
import Icon from "./Icon";
export default function UserEditor({ user = {}, onSave, creating = false }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await onSave({
        email: f.get("email"),
        password: f.get("password"),
        firstName: f.get("firstName"),
        lastName: f.get("lastName"),
        phoneNumber: f.get("phoneNumber"),
        isAdmin: f.has("isAdmin"),
        isActive: f.has("isActive"),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel user-editor" onSubmit={submit}>
      <p className="eyebrow">{creating ? "NEW ACCOUNT" : "ACCOUNT DETAILS"}</p>
      <div className="editor-fields">
        {[
          ["email", "Email", "email", user.email],
          ["firstName", "First name", "text", user.first_name],
          ["lastName", "Last name", "text", user.last_name],
          ["phoneNumber", "Phone", "tel", user.phone_number],
        ].map(([name, label, type, value]) => (
          <label className="field" key={name}>
            {label}
            <input
              name={name}
              type={type}
              defaultValue={value || ""}
              required={name === "email"}
            />
          </label>
        ))}
        <label className="field">
          {creating ? "Password" : "New password (optional)"}
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required={creating}
          />
        </label>
      </div>
      <div className="editor-checks">
        <label>
          <input
            name="isAdmin"
            type="checkbox"
            defaultChecked={user.is_admin}
          />{" "}
          Administrator
        </label>
        <label>
          <input
            name="isActive"
            type="checkbox"
            defaultChecked={user.is_active !== false}
          />{" "}
          Active account
        </label>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <button className="button copper" disabled={busy}>
        {busy ? "Saving…" : creating ? "Create account" : "Save account"}
        <Icon name="check" />
      </button>
    </form>
  );
}
