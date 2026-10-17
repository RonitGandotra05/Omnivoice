"use client";
import { useEffect, useRef, useState } from "react";

export default function KnowledgeChecks({
  connected,
  request,
  workspaceDirty,
  onSaved,
}) {
  const [cases, setCases] = useState([]);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    setLoaded(false);
    setLoading(true);
    setError("");
    request("checks", { signal: controller.signal })
      .then((data) => {
        setCases(data.cases);
        setReport(data.report);
        setLoaded(true);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [connected, request, reload]);
  const change = (index, values) => {
    setCases((previous) =>
      previous.map((item, i) => (i === index ? { ...item, ...values } : item)),
    );
    setDirty(true);
    setReport(null);
  };
  const run = async () => {
    if (pending.current || !loaded) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await request("checks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cases }),
      });
      setDirty(false);
      setReport(await request("checks/run", { method: "POST" }));
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <details className="voice-test-option knowledge-checks">
      <summary>Saved knowledge checks</summary>
      <p>
        Keep important questions and expected answers. Saved checks run again
        before publishing. These check document search and handoffs; test live
        voice separately.
      </p>
      {!connected ? (
        <p className="empty-note">
          Load your company workspace to save and run checks.
        </p>
      ) : (
        <>
          {loading && <p role="status">Loading saved checks…</p>}
          {!loaded && !loading && (
            <button
              type="button"
              className="button outline small"
              onClick={() => setReload((value) => value + 1)}
            >
              Reload saved checks
            </button>
          )}
          <fieldset disabled={busy || !loaded}>
            {cases.map((item, index) => (
              <div className="routing-card" key={index}>
                <div className="document-heading">
                  <strong>Check {index + 1}</strong>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setCases(cases.filter((_, i) => i !== index));
                      setDirty(true);
                      setReport(null);
                    }}
                  >
                    Remove check {index + 1}
                  </button>
                </div>
                <label className="field">
                  Name
                  <input
                    maxLength={100}
                    value={item.name}
                    onChange={(event) =>
                      change(index, { name: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Customer question
                  <input
                    maxLength={2000}
                    value={item.query}
                    onChange={(event) =>
                      change(index, { query: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Expected outcome
                  <select
                    value={item.expect_escalation ? "handoff" : "answer"}
                    onChange={(event) =>
                      change(index, {
                        expect_escalation: event.target.value === "handoff",
                        expected_phrases: [],
                        expected_document: null,
                        expected_team: null,
                      })
                    }
                  >
                    <option value="answer">Knowledge answer</option>
                    <option value="handoff">Human handoff</option>
                  </select>
                </label>
                {item.expect_escalation ? (
                  <label className="field">
                    Expected team (optional)
                    <input
                      maxLength={80}
                      value={item.expected_team || ""}
                      onChange={(event) =>
                        change(index, {
                          expected_team: event.target.value || null,
                        })
                      }
                    />
                  </label>
                ) : (
                  <>
                    <label className="field">
                      Expected answer phrase
                      <input
                        maxLength={200}
                        value={item.expected_phrases[0] || ""}
                        onChange={(event) =>
                          change(index, {
                            expected_phrases: event.target.value
                              ? [event.target.value]
                              : [],
                          })
                        }
                        placeholder="For example: two years from delivery"
                      />
                    </label>
                    <label className="field">
                      Expected source filename (optional)
                      <input
                        maxLength={255}
                        value={item.expected_document || ""}
                        onChange={(event) =>
                          change(index, {
                            expected_document: event.target.value || null,
                          })
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            ))}
            <div className="document-heading">
              <button
                type="button"
                className="button outline small"
                disabled={cases.length >= 25}
                onClick={() => {
                  setCases([
                    ...cases,
                    {
                      name: "",
                      query: "",
                      expect_escalation: false,
                      expected_phrases: [],
                      expected_document: null,
                      expected_team: null,
                    },
                  ]);
                  setDirty(true);
                  setReport(null);
                }}
              >
                Add check
              </button>
              <button
                type="button"
                className="button dark small"
                disabled={workspaceDirty}
                onClick={run}
              >
                {busy ? "Checking…" : "Save & run checks"}
              </button>
            </div>
          </fieldset>
          {workspaceDirty && (
            <p className="empty-note">
              Save the company workspace before running checks.
            </p>
          )}
          {dirty && (
            <p className="empty-note">
              Unsaved check changes. Save company settings and document edits
              before running checks.
            </p>
          )}
          {error && (
            <p className="error-banner workspace-alert" role="alert">
              {error}
            </p>
          )}
          {report?.status && (
            <div aria-live="polite">
              <p
                className={
                  report.status === "failed"
                    ? "error-banner workspace-alert"
                    : "workspace-notice"
                }
              >
                {report.stale
                  ? "Workspace changed. Run these checks again."
                  : report.status === "not_run"
                    ? "No checks configured. This does not count as a pass."
                    : `${report.passed} of ${report.total} checks passed.`}
              </p>
              {report.results?.map((result) => (
                <article className="ticket-card" key={result.name}>
                  <strong>
                    {result.status === "passed" ? "Passed" : "Failed"} ·{" "}
                    {result.name}
                  </strong>
                  <p>{result.response}</p>
                  {result.reasons?.length > 0 && (
                    <p>{result.reasons.join(" ")}</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </details>
  );
}
