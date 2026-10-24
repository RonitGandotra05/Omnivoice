"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  adminRequest,
  replaceConfirmedAccount,
  actionLabel,
} from "@/lib/admin-dashboard.mjs";
const number = (value) => Number(value || 0).toLocaleString();
const minutes = (value) =>
  `${(Number(value || 0) / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} min`;
const date = (value) => (value ? new Date(value).toLocaleString() : "Not yet");
function ProviderBalance({ usage }) {
  return (
    <section
      className="admin-card admin-provider"
      aria-labelledby="provider-title"
    >
      <div className="admin-card-heading">
        <div>
          <p className="eyebrow">ELEVENLABS WORKSPACE</p>
          <h2 id="provider-title">Provider balance</h2>
        </div>
        <a
          className="text-link"
          href="https://elevenlabs.io/app/usage"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open ElevenLabs ↗
        </a>
      </div>
      <div className="admin-provider-grid">
        <div>
          <span>Remaining call minutes</span>
          <strong>
            {usage?.remaining_call_minutes == null
              ? "Not available"
              : number(usage.remaining_call_minutes)}
          </strong>
          <p>{usage?.message || "Checking provider usage…"}</p>
        </div>
        {usage?.status === "connected" ? (
          <div>
            <span>Account credits</span>
            <strong>{number(usage.credits_remaining)} remaining</strong>
            <small>
              {number(usage.credits_used)} used of {number(usage.credits_limit)}{" "}
              · {usage.plan}
            </small>
            <meter
              aria-label="ElevenLabs account credits used"
              min="0"
              max={Math.max(1, usage.credits_limit)}
              value={Math.min(usage.credits_limit, usage.credits_used)}
            />
            <small>Next reset: {date(usage.reset_at)}</small>
          </div>
        ) : (
          <div>
            <span>Subscription access</span>
            <strong>
              {usage?.status === "permission_required"
                ? "Read permission needed"
                : "Usage not verified"}
            </strong>
            <p>
              User allowances below are application limits. Increasing them does
              not add ElevenLabs minutes or credits.
            </p>
          </div>
        )}
        <div>
          <span>Published Free Agents plan</span>
          <strong>15 call minutes</strong>
          <small>4 concurrent calls · monthly plan reference</small>
          <a
            className="text-link"
            href="https://elevenlabs.io/pricing/agents"
            target="_blank"
            rel="noopener noreferrer"
          >
            Official plan limits ↗
          </a>
          <small>
            This is not your verified remaining balance. Checked 24 Oct 2026.
          </small>
        </div>
      </div>
      {usage?.checked_at && (
        <p className="admin-footnote">
          Provider checked {date(usage.checked_at)} · cached for up to 60
          seconds. Credits are not converted to call minutes.
        </p>
      )}
    </section>
  );
}
function AccountHistory({ detail, loading, page, onPage, onClose }) {
  return (
    <div className="admin-history">
      <div className="admin-card-heading">
        <h3>Recent call activity</h3>
        <button type="button" className="text-link" onClick={onClose}>
          Close history
        </button>
      </div>
      {loading ? (
        <p role="status">Loading call history…</p>
      ) : detail ? (
        <>
          <div className="admin-profile-facts">
            <span>
              Joined <strong>{date(detail.account.created_at)}</strong>
            </span>
            <span>
              Last sign-in <strong>{date(detail.account.last_login_at)}</strong>
            </span>
            <span>
              Recorded calls{" "}
              <strong>{number(detail.account.call_count)}</strong>
            </span>
            <span>
              Confirmed usage{" "}
              <strong>{minutes(detail.account.retained_seconds)}</strong>
            </span>
          </div>
          <p className="admin-footnote">{detail.history_note}</p>
          {detail.sessions.length ? (
            <table className="admin-history-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Minutes</th>
                  <th>Conversation</th>
                </tr>
              </thead>
              <tbody>
                {detail.sessions.map((call) => (
                  <tr key={call.id}>
                    <td>{date(call.created_at)}</td>
                    <td>
                      <span className="admin-status">{call.status}</span>
                    </td>
                    <td>
                      {minutes(call.duration_seconds)}
                      {!call.settled && " reserved"}
                    </td>
                    <td className="admin-call-id">
                      {call.conversation_id || "No connection recorded"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No call activity in retained history.</p>
          )}
          <div className="admin-pagination">
            <button
              type="button"
              className="button outline small"
              disabled={page === 1}
              onClick={() => onPage(page - 1)}
            >
              Newer
            </button>
            <span>History page {page}</span>
            <button
              type="button"
              className="button outline small"
              disabled={!detail.has_more}
              onClick={() => onPage(page + 1)}
            >
              Older
            </button>
          </div>
        </>
      ) : (
        <p>History could not be loaded. Select View activity to retry.</p>
      )}
    </div>
  );
}
export default function ProductAdmin() {
  const [data, setData] = useState(null),
    [accounts, setAccounts] = useState(null),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [searchInput, setSearchInput] = useState(""),
    [status, setStatus] = useState("all"),
    [sort, setSort] = useState("newest"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [pending, setPending] = useState(""),
    [notice, setNotice] = useState(""),
    [selection, setSelection] = useState(null),
    [updatedAt, setUpdatedAt] = useState(null),
    [expanded, setExpanded] = useState(""),
    [history, setHistory] = useState(null),
    [historyLoading, setHistoryLoading] = useState(false),
    [historyPage, setHistoryPage] = useState(1);
  const busy = useRef(false),
    generation = useRef(0),
    confirmation = useRef(null),
    historyGeneration = useRef(0);
  useEffect(() => {
    if (confirmation.current) {
      confirmation.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      confirmation.current.focus();
    }
  }, [selection?.id, selection?.action]);
  const load = useCallback(
    async (signal, background = false) => {
      if (busy.current) return;
      const version = ++generation.current;
      if (!background) setRefreshing(true);
      const [overview, users] = await Promise.allSettled([
        adminRequest("overview", { signal }),
        adminRequest(
          `accounts?page=${page}&search=${encodeURIComponent(search)}&status=${status}&sort=${sort}`,
          { signal },
        ),
      ]);
      if (signal?.aborted || version !== generation.current) return;
      if (overview.status === "fulfilled") setData(overview.value);
      if (users.status === "fulfilled") setAccounts(users.value);
      const errors = [overview, users]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason.message);
      setError(errors.length ? [...new Set(errors)].join(" ") : "");
      if (overview.status === "fulfilled" || users.status === "fulfilled")
        setUpdatedAt(new Date().toISOString());
      setLoading(false);
      setRefreshing(false);
    },
    [page, search, status, sort],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !selection && !busy.current)
        load(undefined, true);
    }, 15000);
    return () => clearInterval(timer);
  }, [load, selection]);
  const loadHistory = useCallback(async (id, nextPage = 1) => {
    const version = ++historyGeneration.current;
    setExpanded(id);
    setHistoryPage(nextPage);
    setHistoryLoading(true);
    try {
      const result = await adminRequest(
        `accounts?id=${encodeURIComponent(id)}&page=${nextPage}`,
      );
      if (version === historyGeneration.current) setHistory(result);
    } catch (e) {
      if (version === historyGeneration.current) {
        setError(e.message);
        setHistory(null);
      }
    } finally {
      if (version === historyGeneration.current) setHistoryLoading(false);
    }
  }, []);
  async function act() {
    if (busy.current || !selection) return;
    busy.current = true;
    ++generation.current;
    setPending(selection.id);
    setError("");
    setNotice("");
    const change = selection;
    try {
      const result = await adminRequest("accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: change.id,
          action: change.action,
          ...(change.action === "set_minutes"
            ? { minutes: Number(change.minutes) }
            : {}),
        }),
      });
      if (result.account) {
        setAccounts((current) =>
          replaceConfirmedAccount(current, result.account),
        );
        setHistory((current) =>
          current?.account.id === result.account.id
            ? { ...current, account: result.account }
            : current,
        );
        setUpdatedAt(result.updated_at);
      }
      const balance = result.account
        ? ` ${minutes(result.account.voice_usage.remaining_seconds)} available from ${minutes(result.account.voice_usage.budget_seconds)}.`
        : "";
      setNotice(
        `${actionLabel[change.action] || "Account updated"} for ${change.email}.${balance}`,
      );
      setSelection(null);
      if (!result.account) {
        busy.current = false;
        await load(undefined, true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      busy.current = false;
      setPending("");
      setRefreshing(false);
    }
  }
  const peak = Math.max(
    1,
    ...(data?.activity || []).map((day) => Number(day.seconds) / 60),
  );
  const successful =
    data?.security
      ?.filter((item) => item.event === "success")
      .reduce((sum, item) => sum + item.count, 0) || 0;
  const blocked =
    data?.security
      ?.filter((item) => ["locked", "failure"].includes(item.event))
      .reduce((sum, item) => sum + item.count, 0) || 0;
  return (
    <div className="page-shell product-admin">
      <div className="page-kicker">
        <span>OMNIVOICE / ADMINISTRATION</span>
        <Link href="/account/settings" className="text-link">
          Account security ↗
        </Link>
      </div>
      <header className="admin-dashboard-heading">
        <div>
          <p className="eyebrow">YOUR SERVICE, AT A GLANCE</p>
          <h1>
            Voice <em>operations.</em>
          </h1>
          <p>Manage people, balances and call activity in one place.</p>
        </div>
        <div className="admin-refresh">
          <button
            type="button"
            className="button copper"
            disabled={refreshing || !!pending}
            onClick={() => load()}
          >
            {refreshing ? "Refreshing…" : "Refresh data ↻"}
          </button>
          <small>
            {updatedAt ? `Updated ${date(updatedAt)}` : "Waiting for data"}
          </small>
          <span className="admin-live-label">
            Refreshes every 15 seconds while open
          </span>
        </div>
      </header>
      {error && (
        <div className="error-banner admin-feedback" role="alert">
          {error}
          <button className="text-link" onClick={() => load()}>
            Retry refresh
          </button>
        </div>
      )}
      {notice && (
        <p className="admin-success" role="status">
          ✓ {notice}
        </p>
      )}
      {loading && !accounts && <p role="status">Loading your dashboard…</p>}
      {data && (
        <>
          <div className="admin-summary-grid">
            {[
              [
                number(data.accounts.total),
                "Registered users",
                `${number(data.accounts.active)} active · ${number(data.accounts.verified)} verified`,
              ],
              [
                number(data.sessions.today),
                "Call starts · 24h",
                "Session requests, including failed connections",
              ],
              [
                minutes(data.sessions.confirmed_seconds),
                "Confirmed call time",
                "Provider-verified usage in retained history",
              ],
              [
                number(data.sessions.pending),
                "Awaiting verification",
                `${minutes(data.sessions.reserved_seconds)} held for pending calls`,
              ],
            ].map(([value, label, help]) => (
              <article className="admin-summary" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{help}</small>
              </article>
            ))}
          </div>
          <ProviderBalance usage={data.provider_usage} />
          <div className="admin-main-grid">
            <section className="admin-card">
              <div className="admin-card-heading">
                <div>
                  <p className="eyebrow">LAST 7 DAYS · UTC</p>
                  <h2>Confirmed call minutes</h2>
                </div>
                <span className="admin-status">Application history</span>
              </div>
              <div
                className="admin-activity-chart"
                role="img"
                aria-label={data.activity
                  .map(
                    (day) =>
                      `${day.day}: ${minutes(day.seconds)}, ${day.sessions} call starts`,
                  )
                  .join("; ")}
              >
                {data.activity.map((day) => (
                  <div className="admin-chart-column" key={day.day}>
                    <strong>{(Number(day.seconds) / 60).toFixed(1)}</strong>
                    <div className="admin-chart-track">
                      <div
                        className="admin-chart-bar"
                        style={{
                          height: `${Math.max(2, (Number(day.seconds) / 60 / peak) * 100)}%`,
                        }}
                      />
                    </div>
                    <span>
                      {new Date(day.day + "T12:00:00Z").toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric", timeZone: "UTC" },
                      )}
                    </span>
                    <small>{day.sessions} calls</small>
                  </div>
                ))}
              </div>
              <p className="admin-footnote">
                Call starts include reservations. Confirmed minutes appear after
                provider verification. Older application records may have
                expired.
              </p>
            </section>
            <section className="admin-card admin-connections">
              <div className="admin-card-heading">
                <div>
                  <p className="eyebrow">SERVICE CONNECTIONS</p>
                  <h2>What’s connected</h2>
                </div>
              </div>
              <dl className="admin-connection-list">
                {Object.entries(data.integrations).map(([key, value]) => {
                  const labels = {
                    database: "Account database",
                    voice: "Voice service",
                    google: "Google sign-in",
                    storage: "Company data",
                    email: "Email delivery",
                    phone: "Phone transfers",
                  };
                  const state = {
                    reachable: "Connected",
                    configured: "Key configured",
                    missing: "Setup needed",
                    connected: "Shared workspace",
                    "browser-local": "Saved on each device",
                    enabled: "Enabled",
                    disabled: "Not connected",
                  };
                  return (
                    <div key={key}>
                      <dt>{labels[key] || key}</dt>
                      <dd>
                        <span
                          className={`admin-status ${["enabled", "configured", "reachable", "connected"].includes(value) ? "is-ready" : ""}`}
                        >
                          {state[value] || value}
                        </span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="admin-footnote">
                Configuration status is not a live service-health guarantee.
                Browser-only company data is not shared with the team.
              </p>
            </section>
          </div>
        </>
      )}
      <section
        className="admin-card admin-users"
        aria-labelledby="admin-users-title"
      >
        <div className="admin-card-heading">
          <div>
            <p className="eyebrow">PEOPLE & ACCESS</p>
            <h2 id="admin-users-title">User balances</h2>
            <p>
              Allowance applies to the rolling 24-hour window since the last
              reset. Each call is capped at 10 minutes.
            </p>
          </div>
        </div>
        <form
          className="admin-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          <label>
            Search users
            <input
              value={searchInput}
              maxLength={100}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Name or email"
            />
          </label>
          <label>
            Show
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All users</option>
              <option value="active">Active users</option>
              <option value="suspended">Suspended users</option>
              <option value="unverified">Unverified email</option>
              <option value="exhausted">No minutes available</option>
            </select>
          </label>
          <label>
            Sort by
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="newest">Newest accounts</option>
              <option value="recent">Latest call</option>
              <option value="usage">Most call time</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
          <button className="button outline small" disabled={!!pending}>
            Search
          </button>
          {(search || status !== "all" || sort !== "newest") && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setSearch("");
                setSearchInput("");
                setStatus("all");
                setSort("newest");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          )}
        </form>
        <div
          className="admin-table-wrap"
          role="region"
          aria-label="User allowances and call activity"
        >
          <table className="admin-table admin-users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Voice balance</th>
                <th>Manage minutes</th>
                <th>Call activity</th>
                <th>Account</th>
              </tr>
            </thead>
            <tbody>
              {accounts?.accounts.map((a) => (
                <AccountRows
                  key={a.id}
                  account={a}
                  pending={!!pending}
                  onSelect={setSelection}
                  onHistory={() => {
                    setHistory(null);
                    loadHistory(a.id);
                  }}
                  historyOpen={expanded === a.id}
                  history={history}
                  historyLoading={historyLoading}
                  historyPage={historyPage}
                  onHistoryPage={(p) => loadHistory(a.id, p)}
                  onCloseHistory={() => {
                    ++historyGeneration.current;
                    setExpanded("");
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!accounts?.accounts.length && !loading && (
          <div className="admin-empty">
            <h3>No users match these filters</h3>
            <p>Try another name, email, or status.</p>
          </div>
        )}
        <div className="admin-pagination">
          <button
            type="button"
            className="button outline small"
            disabled={page === 1 || refreshing || !!pending}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            Page {page}
            {accounts?.accounts?.length
              ? ` · ${accounts.accounts.length} users shown`
              : ""}
          </span>
          <button
            type="button"
            className="button outline small"
            disabled={!accounts?.has_more || refreshing || !!pending}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
        {selection && (
          <div
            ref={confirmation}
            tabIndex={-1}
            className="admin-confirm"
            role="region"
            aria-label="Confirm account update"
          >
            <div className="admin-card-heading">
              <div>
                <p className="eyebrow">REVIEW CHANGE</p>
                <h3>
                  {selection.action === "set_minutes"
                    ? "Edit voice allowance"
                    : selection.action === "reset_minutes"
                      ? "Reset consumed minutes"
                      : actionLabel[selection.action]}
                </h3>
                <p>{selection.email}</p>
              </div>
            </div>
            {selection.action === "set_minutes" ? (
              <label className="field">
                Daily allowance in minutes
                <input
                  type="number"
                  min="1"
                  max="240"
                  step="1"
                  value={selection.minutes}
                  onChange={(e) =>
                    setSelection((value) => ({
                      ...value,
                      minutes: e.target.value,
                    }))
                  }
                />
                <small>
                  1–240 whole minutes. Used and pending time still count;
                  increasing this does not purchase provider credits.
                </small>
              </label>
            ) : (
              <p>
                {selection.action === "reset_minutes"
                  ? "Restore the configured balance without deleting call history. Pending calls stay reserved until verified."
                  : "This changes account access. Existing security safeguards remain active."}
              </p>
            )}
            <div className="admin-row-actions">
              <button
                type="button"
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
                {pending ? "Saving…" : "Confirm update"}
              </button>
              <button
                type="button"
                className="button outline small"
                disabled={!!pending}
                onClick={() => setSelection(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
      {data && (
        <div className="admin-main-grid">
          <section className="admin-card">
            <div className="admin-card-heading">
              <div>
                <p className="eyebrow">ACCOUNT SECURITY · 24 HOURS</p>
                <h2>Sign-in overview</h2>
              </div>
            </div>
            <div className="admin-security-summary">
              <div>
                <strong>{number(successful)}</strong>
                <span>Successful sign-ins</span>
              </div>
              <div>
                <strong>{number(blocked)}</strong>
                <span>Blocked or unsuccessful sign-ins</span>
              </div>
            </div>
            <p className="admin-footnote">
              Blocked sign-ins include attempts stopped by account-protection
              rules. A sign-in request is not necessarily a successful login.
            </p>
            <details className="admin-advanced">
              <summary>Technical service activity</summary>
              <p>
                Request counters help troubleshoot load; they do not represent
                completed calls or provider billing.
              </p>
              <ul>
                {data.operations.map((o) => (
                  <li key={o.operation}>
                    {{
                      agent: "Agent preparation requests",
                      document: "Document processing requests",
                      account: "Account creation requests",
                    }[o.operation] || "Other service requests"}
                    : {number(o.count)}
                  </li>
                ))}
              </ul>
            </details>
          </section>
          <section className="admin-card">
            <div className="admin-card-heading">
              <div>
                <p className="eyebrow">AUDIT TRAIL</p>
                <h2>Recent admin changes</h2>
              </div>
            </div>
            {data.audit.length ? (
              <ul className="admin-audit-list">
                {data.audit.map((e, i) => (
                  <li key={`${e.created_at}-${i}`}>
                    <div>
                      <strong>
                        {actionLabel[e.action] || "Account changed"}
                      </strong>
                      <span>{e.target_email || "Removed account"}</span>
                      {e.action === "set_minutes" &&
                        e.details?.budget_seconds && (
                          <small>
                            {minutes(e.details.previous_budget_seconds)} →{" "}
                            {minutes(e.details.budget_seconds)}
                          </small>
                        )}
                    </div>
                    <time>{date(e.created_at)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-footnote">No account changes recorded yet.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function AccountRows({
  account: a,
  pending,
  onSelect,
  onHistory,
  historyOpen,
  history,
  historyLoading,
  historyPage,
  onHistoryPage,
  onCloseHistory,
}) {
  const balance = a.voice_usage || {};
  return (
    <>
      <tr className={pending ? "admin-row-pending" : ""}>
        <td>
          <strong>{a.name}</strong>
          <span className="admin-user-email">{a.email}</span>
          <small>Joined {date(a.created_at)}</small>
        </td>
        <td className="admin-balance">
          <strong>{minutes(balance.remaining_seconds)} available</strong>
          <meter
            min="0"
            max={Math.max(1, balance.budget_seconds || 600)}
            value={Math.min(
              balance.budget_seconds || 600,
              (balance.used_seconds || 0) + (balance.pending_seconds || 0),
            )}
            aria-label={`Used or reserved minutes for ${a.name}`}
          />
          <small>
            {minutes(balance.used_seconds)} used of{" "}
            {minutes(balance.budget_seconds || 600)}
          </small>
          {balance.pending_seconds > 0 && (
            <small>{minutes(balance.pending_seconds)} pending</small>
          )}
        </td>
        <td>
          <div className="admin-minute-actions">
            <button
              type="button"
              className="button outline small"
              disabled={pending}
              onClick={() =>
                onSelect({
                  id: a.id,
                  email: a.email,
                  action: "set_minutes",
                  minutes: Math.round((balance.budget_seconds || 600) / 60),
                })
              }
            >
              Edit allowance
            </button>
            <button
              type="button"
              className="text-link"
              disabled={pending}
              onClick={() =>
                onSelect({ id: a.id, email: a.email, action: "reset_minutes" })
              }
            >
              Reset minutes
            </button>
          </div>
        </td>
        <td>
          <strong>{number(a.call_count)} recorded calls</strong>
          <small>{minutes(a.retained_seconds)} confirmed</small>
          <small>Last call: {date(a.last_call_at)}</small>
          <button type="button" className="text-link" onClick={onHistory}>
            View activity ↗
          </button>
        </td>
        <td>
          <span className={`admin-status ${a.active ? "is-ready" : ""}`}>
            {a.is_admin ? "Administrator" : a.active ? "Active" : "Suspended"}
          </span>
          <small>
            {a.email_verified ? "Email verified" : "Email unverified"} ·{" "}
            {a.mfa_enabled ? "2FA on" : "2FA off"}
          </small>
          <small>Last sign-in: {date(a.last_login_at)}</small>
          {!a.is_admin && (
            <details className="admin-account-actions">
              <summary>Account actions</summary>
              <button
                type="button"
                className="text-link"
                disabled={pending}
                onClick={() =>
                  onSelect({
                    id: a.id,
                    email: a.email,
                    action: a.active ? "suspend" : "restore",
                  })
                }
              >
                {a.active ? "Suspend access" : "Restore access"}
              </button>
              <button
                type="button"
                className="text-link"
                disabled={pending}
                onClick={() =>
                  onSelect({ id: a.id, email: a.email, action: "revoke" })
                }
              >
                Revoke sessions
              </button>
            </details>
          )}
        </td>
      </tr>
      {historyOpen && (
        <tr>
          <td colSpan={5}>
            <AccountHistory
              detail={history}
              loading={historyLoading}
              page={historyPage}
              onPage={onHistoryPage}
              onClose={onCloseHistory}
            />
          </td>
        </tr>
      )}
    </>
  );
}
