"use client";
import { useEffect, useRef, useState } from "react";
import { fieldLabels, mergeProposal } from "@/lib/support/assistant-schema.mjs";

const display = (value) =>
  typeof value === "string" ? value || "Empty" : JSON.stringify(value, null, 2);
export default function CompanyAssistant({ profile, onApply, disabled }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [selected, setSelected] = useState([]);
  const [focus, setFocus] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [until, setUntil] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const pending = useRef(false);
  const controller = useRef(null);
  const currentProfile = useRef(profile);
  currentProfile.current = profile;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!until) return;
    setWaiting(true);
    const timer = setTimeout(
      () => {
        setWaiting(false);
        setUntil(0);
      },
      Math.max(0, until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [until]);
  async function send(event) {
    event.preventDefault();
    if (pending.current || !input.trim() || Date.now() < until) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const message = input.trim(),
      snapshot = structuredClone(currentProfile.current);
    controller.current = new AbortController();
    try {
      const response = await fetch("/api/company-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          message,
          profile: snapshot,
          focus,
        }),
        signal: AbortSignal.any([
          controller.current.signal,
          AbortSignal.timeout(28000),
        ]),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 429)
          setUntil(
            Date.now() +
              Math.max(1, Number(response.headers.get("retry-after")) || 60) *
                1000,
          );
        throw new Error(
          data.error || "The assistant is temporarily unavailable.",
        );
      }
      setHistory((items) =>
        [
          ...items,
          { role: "You", text: message },
          { role: "OmniVoice", text: data.message },
        ].slice(-6),
      );
      setInput("");
      setFocus(data.focus);
      const fields = Object.keys(data.updates);
      setProposal(fields.length ? { snapshot, updates: data.updates } : null);
      // Replacing existing values always requires explicit per-field selection.
      setSelected(
        fields.filter(
          (k) =>
            snapshot[k] === "" ||
            snapshot[k] === undefined ||
            (Array.isArray(snapshot[k]) && !snapshot[k].length),
        ),
      );
    } catch (err) {
      setError(
        err.name === "TimeoutError"
          ? "This request took too long. Your form is unchanged. Try again shortly."
          : err.message,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function apply() {
    try {
      const next = mergeProposal(
        currentProfile.current,
        proposal.snapshot,
        proposal.updates,
        selected,
      );
      onApply(next);
      setProposal(null);
      setError("");
      setHistory((items) =>
        [
          ...items,
          {
            role: "OmniVoice",
            text: "Changes added to your form. You can edit them there, then use Save workspace.",
          },
        ].slice(-6),
      );
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <aside
      className={`company-assistant ${open ? "is-open" : ""}`}
      aria-label="Company information assistant"
    >
      <button
        type="button"
        className="assistant-launch"
        aria-expanded={open}
        aria-controls="company-assistant-panel"
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">✦</span> Company assistant{" "}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <section id="company-assistant-panel" className="assistant-panel">
          <div className="assistant-intro">
            <strong>A little help getting set up.</strong>
            <p>
              Describe your business or paste your About Us content. I’ll
              suggest company details for your existing form. Review changes
              before saving.
            </p>
            <small>
              Company information only · Avoid pasting passwords or private
              customer data.
            </small>
          </div>
          <div className="assistant-history" role="log" aria-live="polite">
            {history.map((item, index) => (
              <p key={index} className={item.role === "You" ? "from-user" : ""}>
                <strong>{item.role}</strong>
                {item.text}
              </p>
            ))}
          </div>
          {proposal && (
            <div className="assistant-proposal">
              <strong>Review proposed changes</strong>
              <p>
                Select each value you want to use. Existing values stay until
                you approve their replacement.
              </p>
              {Object.entries(proposal.updates).map(([field, value]) => (
                <div key={field} className="assistant-change">
                  <input
                    type="checkbox"
                    id={`assistant-field-${field}`}
                    checked={selected.includes(field)}
                    onChange={(e) =>
                      setSelected((keys) =>
                        e.target.checked
                          ? [...keys, field]
                          : keys.filter((k) => k !== field),
                      )
                    }
                  />
                  <span>
                    <label htmlFor={`assistant-field-${field}`}>
                      Use {fieldLabels[field]}
                    </label>
                    <small>Current: {display(profile[field])}</small>
                    <pre>{display(value)}</pre>
                  </span>
                </div>
              ))}
              <div className="assistant-actions">
                <button
                  type="button"
                  onClick={apply}
                  disabled={!selected.length || disabled || busy}
                >
                  Apply selected to form
                </button>
                <button type="button" onClick={() => setProposal(null)}>
                  Dismiss
                </button>
              </div>
              <small>
                Edit applied values in the company form before saving.
              </small>
            </div>
          )}
          {error && (
            <p className="assistant-error" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={send}>
            <label htmlFor="company-assistant-message">
              Company details or a correction
            </label>
            <textarea
              id="company-assistant-message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={6000}
              rows={3}
              placeholder="We’re Northstar Dental in Delhi. Our support email is…"
              disabled={busy}
            />
            <div className="assistant-actions">
              <small>
                {busy
                  ? "Finding company details…"
                  : waiting
                    ? "Please wait before sending again."
                    : "Review → apply → save"}
              </small>
              <button
                type="submit"
                disabled={busy || waiting || !input.trim() || disabled}
              >
                {busy ? "Working…" : "Suggest changes ↗"}
              </button>
            </div>
          </form>
        </section>
      )}
    </aside>
  );
}
