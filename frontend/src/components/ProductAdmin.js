"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
const format = (value) => Number(value || 0).toLocaleString();
const minutes = (value) =>
  `${(Number(value || 0) / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} min`;
const date = (value) => (value ? new Date(value).toLocaleString() : "Never");
async function request(path, options = {}) {
  const response = await fetch("/api/admin/" + path, {
    cache: "no-store",
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || "Could not load administration.");
  return body;
}
export default function ProductAdmin() {
  const [data, setData] = useState(null),
    [accounts, setAccounts] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(""),
    [notice, setNotice] = useState(""),
    [selection, setSelection] = useState(null);
  const [search, setSearch] = useState(""),
    [searchInput, setSearchInput] = useState("");
  const confirmation = useRef(null);
  useEffect(() => {
    if (confirmation.current) {
      confirmation.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      confirmation.current.focus();
    }
  }, [selection?.id, selection?.action]);
  const busy = useRef(false);
  const load = useCallback(
    async (signal) => {
      setLoading(true);
      setError("");
      try {
        const [overview, users] = await Promise.all([
          request("overview", { signal }),
          request(
            "accounts?page=" + page + "&search=" + encodeURIComponent(search),
            { signal },
          ),
        ]);
        if (!signal?.aborted) {
          setData(overview);
          setAccounts(users);
        }
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, search],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function act() {
    if (busy.current || !selection) return;
    busy.current = true;
    setPending(selection.id);
    setError("");
    setNotice("");
    try {
      await request("accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selection.id,
          action: selection.action,
          ...(selection.action === "set_minutes"
            ? { minutes: Number(selection.minutes) }
            : {}),
        }),
      });
      setNotice(
        selection.action === "set_minutes"
          ? `Daily voice allowance updated to ${selection.minutes} minutes.`
          : selection.action === "reset_minutes"
            ? "Consumed minutes reset. History is preserved; pending calls remain reserved until verified."
            : selection.action === "revoke"
              ? "All existing sessions revoked."
              : selection.action === "suspend"
                ? "Account suspended and sessions revoked."
                : "Account restored. The user can sign in again.",
      );
      setSelection(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      busy.current = false;
      setPending("");
    }
  }
  const peak = Math.max(1, ...(data?.activity || []).map((d) => d.sessions));
  return (
    <div className="page-shell product-admin" aria-busy={loading}>
      <div className="page-kicker">
        <span>OMNIVOICE / ADMINISTRATION</span>
        <Link href="/account/settings" className="text-link">
          Account security
        </Link>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SERVICE OVERVIEW</p>
          <h1>
            Keep a pulse
            <br />
            <em>on every connection.</em>
          </h1>
          <p>
            Accounts, voice activity and operational signals from your
            application.
          </p>
        </div>
        <button
          type="button"
          className="button copper"
          disabled={loading || !!pending}
          onClick={() => load()}
        >
          {loading ? "Refreshing…" : "Refresh data"}
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}{" "}
          <button className="text-link" onClick={() => load()}>
            Retry
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="panel">
          {notice}
        </p>
      )}
      {!data && loading && <p role="status">Loading service overview…</p>}
      {data && (
        <>
          <p className="workspace-note">
            Updated {date(data.generated_at)} · Browser-local documents, caller
            details and transcripts stay on each device. They are not included
            here.
          </p>
          <div className="stats-grid">
            {[
              [
                data.accounts.total,
                "Registered accounts",
                `${format(data.accounts.active)} active · ${format(data.accounts.verified)} verified`,
              ],
              [
                data.sessions.today,
                "Voice sessions / 24h",
                `${format(data.sessions.total)} reservations in retained records`,
              ],
              [
                Math.round(Number(data.sessions.confirmed_seconds) / 60),
                "Confirmed voice minutes",
                "Provider-settled usage in retained records",
              ],
              [
                data.sessions.pending,
                "Pending reservations",
                `${format(Math.round(Number(data.sessions.reserved_seconds) / 60))} minutes reserved; not confirmed usage`,
              ],
            ].map(([value, label, help]) => (
              <article className="panel" key={label}>
                <p className="eyebrow">{label}</p>
                <strong>{format(value)}</strong>
                <small>{help}</small>
              </article>
            ))}
          </div>
          <section className="panel" aria-labelledby="voice-activity">
            <h2 id="voice-activity">Voice activity</h2>
            <p>
              Session reservations per day · Last 3 days · UTC · Retained
              reservations
            </p>
            <div
              className="admin-chart"
              role="img"
              aria-label={data.activity
                .map((d) => `${d.day}: ${d.sessions} sessions`)
                .join("; ")}
            >
              {data.activity.map((d) => (
                <div className="admin-chart-column" key={d.day}>
                  <span>{d.sessions}</span>
                  <div
                    className="admin-chart-bar"
                    style={{
                      height: `${Math.max(2, (d.sessions / peak) * 120)}px`,
                    }}
                  />
                  <small>{d.day.slice(5)}</small>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Integration status</h2>
            <p>
              Configuration checks from this deployment. “Configured” does not
              establish provider availability.
            </p>
            <dl className="admin-integrations">
              {Object.entries(data.integrations).map(([name, status]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{status}</dd>
                </div>
              ))}
            </dl>
            <p className="workspace-note">
              Costs are not estimated: provider billing and invoices are the
              source of truth.
            </p>
          </section>
          <section className="panel">
            <h2>Account management</h2>
            <p>
              See each user’s voice balance, adjust their allowance, or reset
              consumed minutes. Usage covers the rolling 24-hour window since
              the last reset. Each call is capped at 10 minutes.
            </p>
            <form
              className="admin-user-search"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setSearch(searchInput.trim());
              }}
            >
              <label htmlFor="admin-user-search">
                Find a user by name or email
              </label>
              <div className="admin-row-actions">
                <input
                  id="admin-user-search"
                  value={searchInput}
                  maxLength={100}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search users…"
                />
                <button
                  className="button small"
                  disabled={loading || !!pending}
                >
                  Search
                </button>
                {search && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setSearchInput("");
                      setSearch("");
                      setPage(1);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
            <div
              className="admin-table-wrap"
              role="region"
              aria-label="Registered accounts"
            >
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Status</th>
                    <th scope="col">Voice minutes</th>
                    <th scope="col">Last sign-in</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts?.accounts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name}</strong>
                        <br />
                        {a.email}
                      </td>
                      <td>
                        {a.is_admin
                          ? "Administrator"
                          : a.active
                            ? "Active"
                            : "Suspended"}
                        <br />
                        <small>
                          {a.mfa_enabled ? "2FA enabled" : "2FA not enabled"}
                        </small>
                      </td>
                      <td className="admin-voice-usage">
                        <strong>
                          {minutes(a.voice_usage?.remaining_seconds)} available
                        </strong>
                        <meter
                          min="0"
                          max={Math.max(
                            1,
                            a.voice_usage?.budget_seconds || 600,
                          )}
                          value={Math.min(
                            a.voice_usage?.budget_seconds || 600,
                            (a.voice_usage?.used_seconds || 0) +
                              (a.voice_usage?.pending_seconds || 0),
                          )}
                          aria-label={`Voice minutes used or reserved for ${a.name}`}
                        />
                        <small>
                          {minutes(a.voice_usage?.used_seconds)} used ·{" "}
                          {minutes(a.voice_usage?.budget_seconds || 600)}{" "}
                          allowance
                        </small>
                        <small>
                          {minutes(a.voice_usage?.pending_seconds)} pending
                          verification
                        </small>
                        <small>
                          Retained confirmed history:{" "}
                          {minutes(a.retained_seconds)}
                        </small>
                        {a.voice_usage?.reset_at && (
                          <small>Reset {date(a.voice_usage.reset_at)}</small>
                        )}
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="text-link"
                            disabled={!!pending || loading}
                            onClick={() =>
                              setSelection({
                                id: a.id,
                                email: a.email,
                                action: "set_minutes",
                                minutes: Math.round(
                                  (a.voice_usage?.budget_seconds || 600) / 60,
                                ),
                              })
                            }
                          >
                            Edit allowance
                          </button>
                          <button
                            type="button"
                            className="text-link"
                            disabled={!!pending || loading}
                            onClick={() =>
                              setSelection({
                                id: a.id,
                                email: a.email,
                                action: "reset_minutes",
                              })
                            }
                          >
                            Reset minutes
                          </button>
                        </div>
                      </td>
                      <td>{date(a.last_login_at)}</td>
                      <td>
                        {a.is_admin ? (
                          <span>Protected account</span>
                        ) : (
                          <div className="admin-row-actions">
                            {[
                              [
                                a.active ? "suspend" : "restore",
                                a.active ? "Suspend" : "Restore",
                              ],
                              ["revoke", "Revoke sessions"],
                            ].map(([action, label]) => (
                              <button
                                type="button"
                                className="text-link"
                                key={action}
                                disabled={!!pending || loading}
                                onClick={() =>
                                  setSelection({
                                    id: a.id,
                                    email: a.email,
                                    action,
                                  })
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!accounts?.accounts.length && <p>No accounts on this page.</p>}
            <div className="admin-row-actions">
              <button
                className="button small"
                disabled={page === 1 || loading || !!pending}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="button small"
                disabled={!accounts?.has_more || loading || !!pending}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
            {selection && (
              <div
                ref={confirmation}
                tabIndex={-1}
                className="admin-confirm panel"
                role="region"
                aria-label="Confirm account action"
              >
                <p>
                  {selection.action === "set_minutes"
                    ? "Edit the daily voice allowance for"
                    : selection.action === "reset_minutes"
                      ? "Reset consumed voice minutes for"
                      : selection.action === "suspend"
                        ? "Suspend access and revoke all sessions for"
                        : selection.action === "restore"
                          ? "Restore access for"
                          : "Revoke all sessions for"}{" "}
                  <strong>{selection.email}</strong>?
                </p>
                {selection.action === "set_minutes" && (
                  <label className="field" htmlFor="admin-allowance-minutes">
                    Daily voice allowance (minutes)
                    <input
                      id="admin-allowance-minutes"
                      type="number"
                      min="1"
                      max="240"
                      step="1"
                      value={selection.minutes}
                      onChange={(event) =>
                        setSelection((value) => ({
                          ...value,
                          minutes: event.target.value,
                        }))
                      }
                    />
                    <small>
                      1–240 whole minutes. Changes affect the remaining balance
                      immediately; each new call stays capped at 10 minutes.
                    </small>
                  </label>
                )}
                {selection.action === "reset_minutes" && (
                  <p>
                    Restore this user’s current allowance. Confirmed usage
                    history stays visible. Pending calls remain reserved until
                    verified, and site-wide safety limits still apply.
                  </p>
                )}
                <div className="admin-row-actions">
                  <button
                    className="button copper small"
                    disabled={
                      !!pending ||
                      (selection.action === "set_minutes" &&
                        (!Number.isInteger(Number(selection.minutes)) ||
                          Number(selection.minutes) < 1 ||
                          Number(selection.minutes) > 240))
                    }
                    onClick={act}
                  >
                    {pending ? "Applying…" : "Confirm"}
                  </button>
                  <button
                    className="button small"
                    disabled={!!pending}
                    onClick={() => setSelection(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
          <div className="admin-two-column">
            <section className="panel">
              <h2>Authentication / 24h</h2>
              {data.security.length ? (
                <ul>
                  {data.security.map((s) => (
                    <li key={s.event}>
                      {s.event}: {format(s.count)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No retained events in this period.</p>
              )}
              <p className="workspace-note">
                Security events use hashed identities. They do not expose
                credentials or tokens.
              </p>
            </section>
            <section className="panel">
              <h2>Protection counters / 3 days</h2>
              {data.operations.length ? (
                <ul>
                  {data.operations.map((o) => (
                    <li key={o.operation}>
                      {o.operation}: {format(o.count)} counter increments ·{" "}
                      {format(o.characters)} characters
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No retained operations.</p>
              )}
              <p className="workspace-note">
                A request may increment several account, network and browser
                counters. These are not unique requests or billable API usage.
              </p>
            </section>
          </div>
          <section className="panel">
            <h2>Administrator activity</h2>
            {data.audit.length ? (
              <ul>
                {data.audit.map((e, i) => (
                  <li key={i}>
                    {date(e.created_at)} ·{" "}
                    {{
                      set_minutes: "Voice allowance updated",
                      reset_minutes: "Voice minutes reset",
                      suspend: "Account suspended",
                      restore: "Account restored",
                      revoke: "Sessions revoked",
                    }[e.action] || e.action}{" "}
                    · {e.target_email || "Removed account"}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No account management actions recorded yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
