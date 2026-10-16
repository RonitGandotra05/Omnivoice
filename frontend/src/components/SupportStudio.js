"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { studioRequest } from "@/lib/support/studio-client.mjs";
import BusinessHours from "@/components/BusinessHours";
import CallerJourney from "@/components/CallerJourney";
import CallTranscript from "@/components/CallTranscript";
import CallerDetails from "@/components/CallerDetails";
import KnowledgeChecks from "@/components/KnowledgeChecks";
import dynamic from "next/dynamic";
const VoiceTest = dynamic(() => import("@/components/VoiceTest"), {
  ssr: false,
});
import { UPLOAD_LIMITS, uploadBatch } from "@/lib/upload-batch.mjs";
import Icon from "@/components/ui/Icon";
import {
  initialProfile,
  initialDocuments,
  voicePrompt,
  profileError,
  workspaceReadiness,
  deliveryLabel,
} from "@/lib/workspace.mjs";

const sections = [
  ["brief", "01", "Company brief", "Your agent’s identity"],
  ["knowledge", "02", "Knowledge", "The source of truth"],
  ["routing", "03", "Escalations", "The human handoff"],
  ["test", "04", "Test conversation", "Put it to work"],
  ["connect", "05", "Setup & activity", "Readiness and call history"],
];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const api = studioRequest;
function json(body, method = "POST") {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export default function SupportStudio() {
  const [section, setSection] = useState("brief");
  const [profile, setProfile] = useState(initialProfile);
  const [documents, setDocuments] = useState(initialDocuments);
  const [tickets, setTickets] = useState([]);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [contact, setContact] = useState("");
  const [calls, setCalls] = useState([]);
  const [callers, setCallers] = useState([]);
  const [publishState, setPublishState] = useState(null);
  const [uploads, setUploads] = useState([]);
  const uploadController = useRef(null);
  const [dirty, setDirty] = useState(true);
  const readiness = workspaceReadiness(profile, documents);
  const uploadRef = useRef(null);
  const operation = useRef(false);
  useEffect(() => {
    let active = true;
    (async () => {
      const status = await api("status");
      if (!active) return;
      setStatus(status);
      const data = await api("workspace");
      if (!active) return;
      setProfile(data.profile);
      setDocuments(data.documents);
      setTickets(data.tickets);
      setCalls(data.conversations || []);
      setCallers(data.callers || []);
      setConnected(true);
      setDirty(false);
    })().catch((error) => {
      if (active) setError(error.message);
    });
    return () => {
      active = false;
      uploadController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    let timer;
    let failures = 0;
    const poll = async () => {
      try {
        const data = await api("voice/publish", { signal: controller.signal });
        setPublishState(data);
        failures = 0;
        if (["queued", "running"].includes(data.status))
          timer = setTimeout(poll, 3000);
      } catch (err) {
        if (controller.signal.aborted) return;
        if ([401, 403].includes(err.status)) {
          setError("Sign in again to check publishing progress.");
          return;
        }
        failures += 1;
        timer = setTimeout(
          poll,
          Math.max(
            err.retryAfterMs || 0,
            Math.min(30000, 3000 * 2 ** Math.min(failures, 4)),
          ),
        );
      }
    };
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [connected, publishState?.job_id]);
  const run = async (label, task) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
      operation.current = false;
      if (connected)
        api("voice/publish")
          .then(setPublishState)
          .catch(() => {});
    }
  };
  const update = (field, value) => {
    setProfile((p) => ({ ...p, [field]: value }));
    setDirty(true);
    setNotice("");
    setMessages([]);
  };
  const save = () =>
    run("Saving", async () => {
      const validation = profileError(profile);
      if (validation) throw new Error(validation);
      if (status?.storage === "postgres")
        await api("profile", json(profile, "PUT"));
      else
        await api(
          "workspace/save",
          json({ profile, documents, tickets }, "PUT"),
        );
      setDirty(false);
      setNotice(
        connected
          ? "Company settings saved."
          : "Workspace saved in this browser.",
      );
    });
  const connect = () =>
    run("Connecting", async () => {
      const data = await api("workspace");
      setProfile(data.profile);
      setDocuments(data.documents);
      setTickets(data.tickets);
      setCallers(data.callers || []);
      setMessages([]);
      setConnected(true);
      setDirty(false);
      setCalls((await api("conversations")).conversations);
      setNotice("Your company workspace is connected.");
    });
  const upload = (files) =>
    run("Uploading documents", async () => {
      const selected = Array.from(files);
      if (selected.length + documents.length > UPLOAD_LIMITS.documents)
        throw new Error(
          `This workspace supports ${UPLOAD_LIMITS.documents} documents. Select fewer files or remove old documents.`,
        );
      const controller = new AbortController();
      uploadController.current = controller;
      let next = [...documents];
      const outcomes = await uploadBatch(
        selected,
        async (file, signal) => {
          const body = new FormData();
          body.append("file", file);
          const doc = await api(connected ? "documents" : "parse", {
            method: "POST",
            body,
            signal,
          });
          if (
            !connected &&
            next.reduce((n, d) => n + d.content.length, 0) +
              doc.content.length >
              UPLOAD_LIMITS.characters
          )
            throw new Error(
              "Combined text limit is 5,000,000 characters. Remove older documents or split the workspace.",
            );
          const normalized = { ...doc, id: doc.id || crypto.randomUUID() };
          if (!next.some((item) => item.id === normalized.id))
            next.push(normalized);
          setDocuments([...next]);
          if (!connected) setDirty(true);
          return normalized;
        },
        { concurrency: 2, signal: controller.signal, onUpdate: setUploads },
      );
      uploadController.current = null;
      if (uploadRef.current) uploadRef.current.value = "";
      setMessages([]);
      const completed = outcomes.filter((item) =>
        ["ready", "duplicate"].includes(item.status),
      ).length;
      const review = outcomes.filter(
        (item) => item.status === "needs_review",
      ).length;
      const failed = outcomes.filter((item) => item.status === "failed").length;
      setNotice(
        `${completed} ready · ${review} need review · ${failed} failed. Completed files are kept; retry only the failed files.`,
      );
    });
  const approveDocument = (doc) =>
    run("Approving document", async () => {
      let result = {
        ...doc,
        status: "ready",
        metadata: { ...doc.metadata, needs_review: false, reviewed: true },
      };
      if (doc.content.trim().length < 10)
        throw new Error(
          "Provide at least 10 characters of verified text before approving.",
        );
      if (connected)
        result = await api(
          `documents/${doc.id}/approve`,
          json({ name: doc.name, content: doc.content }),
        );
      setDocuments((items) =>
        items.map((item) => (item.id === doc.id ? result : item)),
      );
      if (!connected) setDirty(true);
      setNotice(
        "Verified text approved. This document can now be used for answers.",
      );
    });
  const remove = (doc) =>
    run("Removing", async () => {
      if (connected) await api(`documents/${doc.id}`, { method: "DELETE" });
      setDocuments((d) => d.filter((x) => x.id !== doc.id));
      if (!connected) setDirty(true);
      setMessages([]);
    });
  const ask = (question = query) =>
    run("Searching", async () => {
      const validation = profileError(profile);
      if (validation) throw new Error(validation);
      if (question.trim().length < 2)
        throw new Error("Enter a question with at least 2 characters.");
      // Save configuration first in connected mode so tests use exactly what is visible.
      if (connected) {
        await api("profile", json(profile, "PUT"));
        setDirty(false);
      }
      const result = await api(
        connected ? "query" : "preview",
        json(
          connected
            ? { query: question }
            : {
                query: question,
                profile,
                documents: documents
                  .filter((doc) => doc.status !== "needs_review")
                  .map(({ name, content }) => ({
                    name,
                    content,
                  })),
              },
        ),
      );
      setMessages((m) => [
        ...m,
        { role: "caller", text: question },
        {
          role: "agent",
          text: result.response,
          result,
          requestId: crypto.randomUUID(),
        },
      ]);
      setQuery("");
    });
  const last = messages.at(-1);
  const escalate = () =>
    run("Creating ticket", async () => {
      if (!last?.result?.needs_escalation) return;
      if (contact && !emailPattern.test(contact))
        throw new Error("Enter a valid callback email, or leave it empty.");
      const question = messages.at(-2).text;
      const payload = {
        subject: question.slice(0, 160).padEnd(3, "."),
        summary: `Caller requested help: ${question}`,
        customer_email: contact || null,
        transcript: messages
          .map((m) => `${m.role}: ${m.text}`)
          .join("\n")
          .slice(-20000),
        priority: "normal",
        idempotency_key: last.requestId,
      };
      let ticket;
      if (connected) ticket = (await api("escalations", json(payload))).ticket;
      else
        ticket = {
          ...payload,
          id: last.requestId,
          ...last.result.routing,
          status: "open",
          delivery_status: "demo_only",
          created_at: new Date().toISOString(),
        };
      setTickets((t) =>
        [ticket, ...t.filter((x) => x.id !== ticket.id)].slice(0, 100),
      );
      if (!connected) setDirty(true);
      setMessages((m) =>
        m.map((x) => (x === last ? { ...x, ticketId: ticket.id } : x)),
      );
      setNotice(
        connected
          ? `Ticket saved. Email status: ${deliveryLabel(ticket.delivery_status)}.`
          : "Demo ticket created. No email sent. Save workspace to keep it.",
      );
    });
  const exportWorkspace = () => {
    const a = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              version: 1,
              profile,
              documents,
              tickets: [],
              voice_prompt: voicePrompt(profile),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    a.href = url;
    a.download = "omnivoice-company.json";
    a.click();
    URL.revokeObjectURL(url);
    setNotice(
      "Exported configuration and documents. Caller tickets are excluded.",
    );
  };
  const retry = (ticket) =>
    run("Retrying email", async () => {
      const data = await api(`escalations/${ticket.id}/retry`, {
        method: "POST",
      });
      setTickets((t) => t.map((x) => (x.id === ticket.id ? data.ticket : x)));
      setNotice(
        `Email status: ${data.ticket.delivery_status.replaceAll("_", " ")}.`,
      );
    });
  return (
    <div className="page-shell support-workspace">
      <div className="page-kicker">
        <span>COMPANY WORKSPACE / VOICE OPERATIONS</span>
        <span>
          <span className="status-dot" />{" "}
          {connected
            ? status?.storage === "postgres"
              ? "CONNECTED WORKSPACE"
              : "SAVED IN THIS BROWSER"
            : "SANDBOX · NO LIVE ACTIONS"}
        </span>
      </div>
      <div className="workspace-title">
        <div>
          <p className="eyebrow">YOUR COMPANY. ON CALL.</p>
          <h1>
            Your support <em>workspace.</em>
          </h1>
          <p>Add company knowledge, set up handoffs, and test your agent.</p>
        </div>
        <div className="workspace-save">
          <span className={`save-state ${dirty ? "changed" : ""}`}>
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <button
            className="button copper small"
            disabled={!!busy}
            onClick={save}
          >
            {busy === "Saving" ? "Saving…" : "Save workspace"}
            <Icon name="check" />
          </button>
          {busy === "Uploading documents" && (
            <button
              className="button outline small"
              onClick={() => uploadController.current?.abort()}
            >
              Stop uploads
            </button>
          )}
        </div>
      </div>
      <div className="workspace-layout">
        <aside className="workspace-sidebar">
          <div className="company-stamp">
            <span className="company-monogram">
              {profile.company_name.slice(0, 1)}
            </span>
            <div>
              <strong>{profile.company_name}</strong>
              <small>
                {connected
                  ? status?.storage === "postgres"
                    ? "Company workspace connected"
                    : "Local company workspace"
                  : "Demo company · editable"}
              </small>
            </div>
          </div>
          <nav aria-label="Workspace sections">
            {sections.map(([id, n, label, desc]) => (
              <button
                key={id}
                disabled={!!busy}
                onClick={() => {
                  setSection(id);
                  setError("");
                  setNotice("");
                }}
                className={section === id ? "active" : ""}
                aria-current={section === id ? "step" : undefined}
              >
                <span>{n}</span>
                <div>
                  {label}
                  <small>{desc}</small>
                </div>
                <Icon name="right" />
              </button>
            ))}
          </nav>
          <div className="sidebar-note">
            <Icon name="shield" />
            <p>
              {connected
                ? status?.storage === "postgres"
                  ? "Documents and requests belong to this company workspace."
                  : "Documents and requests stay in this browser. Publish knowledge only when you are ready to share extracted text with your voice agent."
                : "Demo mode: try your documents and routing. Calls and email stay off."}
            </p>
          </div>
          <Link className="text-link" href="/">
            Back to overview <Icon name="arrow" />
          </Link>
        </aside>
        <section className="workspace-content" aria-busy={!!busy}>
          <fieldset className="workspace-fields" disabled={!!busy}>
            <div className="workspace-topline">
              <span className="eyebrow">
                {sections.find((s) => s[0] === section)?.[1]} /{" "}
                {sections.find((s) => s[0] === section)?.[2].toUpperCase()}
              </span>
              <span className="tag">
                {connected
                  ? status?.storage === "postgres"
                    ? "COMPANY"
                    : "LOCAL"
                  : "DEMO"}
              </span>
            </div>
            {error && (
              <p className="workspace-alert error-banner" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="workspace-alert success-banner" role="status">
                {notice}
              </p>
            )}
            {section === "brief" && (
              <>
                <div className="section-intro">
                  <h2>
                    Company <em>details.</em>
                  </h2>
                  <p>
                    Start with an identity and clear boundaries. Your documents
                    supply the facts; your team handles the exceptions.
                  </p>
                </div>
                <div className="workspace-form two-columns">
                  <label className="field">
                    Company name
                    <input
                      maxLength={120}
                      value={profile.company_name}
                      onChange={(e) => update("company_name", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Default support email
                    <input
                      type="email"
                      value={profile.support_email}
                      onChange={(e) => update("support_email", e.target.value)}
                    />
                    <small>
                      Fallback recipient when no specialist team matches.
                    </small>
                  </label>
                </div>
                <label className="field">
                  Opening greeting
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={profile.greeting}
                    onChange={(e) => update("greeting", e.target.value)}
                  />
                </label>
                <label className="field">
                  Tone & conversation style
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={profile.instructions}
                    onChange={(e) => update("instructions", e.target.value)}
                  />
                  <small>How your agent should speak to customers.</small>
                </label>
                <BusinessHours profile={profile} update={update} />
                <div className="boundary-card">
                  <Icon name="shield" />
                  <div>
                    <h3>Helpful, with clear boundaries.</h3>
                    <p>
                      Unknown answer? Offer a handoff. Refund or booking?
                      Require a connected tool. Never claim that an email was
                      delivered before delivery succeeds.
                    </p>
                  </div>
                </div>
                <button
                  className="button copper"
                  onClick={() => setSection("knowledge")}
                >
                  Add company knowledge <Icon name="arrow" />
                </button>
              </>
            )}
            {section === "knowledge" && (
              <>
                <div className="section-intro">
                  <h2>
                    Company <em>knowledge.</em>
                  </h2>
                  <p>
                    Upload policies, FAQs, product guides, or service documents.
                    Search stays within this company’s knowledge.
                  </p>
                </div>
                <input
                  ref={uploadRef}
                  type="file"
                  id="knowledge-upload"
                  className="sr-only"
                  multiple
                  accept=".pdf,.docx,.txt,.md,.json"
                  disabled={!!busy}
                  onChange={(e) =>
                    e.target.files.length && upload(e.target.files)
                  }
                />
                <button
                  className="document-drop"
                  disabled={!!busy}
                  onClick={() => uploadRef.current?.click()}
                >
                  <Icon name="document" />
                  <strong>
                    {busy === "Uploading documents"
                      ? "Reading your documents…"
                      : "Choose company documents"}
                  </strong>
                  <span>PDF, DOCX, TXT, Markdown, JSON · 10 MB each</span>
                  <small>
                    100 files / 5,000,000 characters total · scanned PDFs
                    supported with OCR
                  </small>
                </button>
                <div className="document-heading">
                  <h3>Knowledge library</h3>
                  <span>
                    {documents.length} documents ·{" "}
                    {documents
                      .reduce((n, d) => n + d.content.length, 0)
                      .toLocaleString()}{" "}
                    characters
                  </span>
                </div>
                {!documents.length && (
                  <p className="empty-note">
                    No sources yet. Add a document to start answering company
                    questions.
                  </p>
                )}
                {uploads.length > 0 && (
                  <div className="upload-results" aria-live="polite">
                    <div className="document-heading">
                      <h3>Upload progress</h3>
                      <span>
                        {
                          uploads.filter(
                            (item) =>
                              !["queued", "processing", "retrying"].includes(
                                item.status,
                              ),
                          ).length
                        }{" "}
                        / {uploads.length} processed
                      </span>
                    </div>
                    {uploads.map((item) => (
                      <div
                        className={`upload-result ${item.status}`}
                        key={item.index}
                      >
                        <strong>{item.name}</strong>
                        <span>{item.status.replaceAll("_", " ")}</span>
                        {item.error && <small>{item.error}</small>}
                      </div>
                    ))}
                    {!busy &&
                      uploads.some((item) =>
                        ["failed", "cancelled"].includes(item.status),
                      ) && (
                        <button
                          className="text-link"
                          onClick={() =>
                            upload(
                              uploads
                                .filter((item) =>
                                  ["failed", "cancelled"].includes(item.status),
                                )
                                .map((item) => item.file),
                            )
                          }
                        >
                          Retry unfinished files <Icon name="reset" />
                        </button>
                      )}
                  </div>
                )}
                <div className="document-list">
                  {documents.map((doc) => (
                    <article key={doc.id}>
                      <div className="document-row">
                        <Icon name="document" />
                        <div>
                          <strong>{doc.name}</strong>
                          <small>
                            {doc.content.length.toLocaleString()} characters ·
                            {doc.status === "needs_review"
                              ? "Review required · excluded from answers"
                              : "Ready for search"}
                          </small>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Remove ${doc.name}`}
                          disabled={!!busy}
                          onClick={() => remove(doc)}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                      <details>
                        <summary>Inspect extracted text</summary>
                        {doc.status === "needs_review" ? (
                          <>
                            <p>
                              {doc.metadata?.warnings?.join(" ") ||
                                "Review the OCR extraction before using this document."}
                            </p>
                            <textarea
                              aria-label={`Verified text for ${doc.name}`}
                              rows={8}
                              value={doc.content}
                              onChange={(event) =>
                                setDocuments((items) =>
                                  items.map((item) =>
                                    item.id === doc.id
                                      ? { ...item, content: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <button
                              className="button copper small"
                              onClick={() => approveDocument(doc)}
                            >
                              Approve verified text <Icon name="check" />
                            </button>
                          </>
                        ) : (
                          <pre>{doc.content}</pre>
                        )}
                      </details>
                    </article>
                  ))}
                </div>
                <p className="microcopy">
                  Imported text is saved locally. Save company settings after
                  editing. Review extracted text before using it for customer
                  support. Publish updated knowledge to your voice agent after
                  adding or removing documents.
                </p>
              </>
            )}
            {section === "routing" && (
              <>
                <div className="section-intro">
                  <h2>
                    Human <em>handoff.</em>
                  </h2>
                  <p>
                    Route issues to the right inbox. Tickets include the
                    caller’s question, contact details, and conversation
                    transcript.
                  </p>
                </div>
                <label className="field">
                  Default support inbox
                  <input
                    type="email"
                    value={profile.support_email}
                    onChange={(e) => update("support_email", e.target.value)}
                  />
                </label>
                <div className="document-heading">
                  <h3>Specialist teams</h3>
                  <button
                    className="text-link"
                    disabled={profile.routes.length >= 20}
                    onClick={() =>
                      update("routes", [
                        ...profile.routes,
                        {
                          name: "New team",
                          email: "team@example.com",
                          keywords: [],
                        },
                      ])
                    }
                  >
                    + Add team
                  </button>
                </div>
                {profile.routes.map((route, i) => (
                  <div className="route-card" key={i}>
                    <div className="route-index">
                      {String(i + 1).padStart(2, "0")}
                      <button
                        className="icon-button"
                        aria-label={`Remove team ${i + 1}`}
                        onClick={() =>
                          update(
                            "routes",
                            profile.routes.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                    <div className="two-columns">
                      <label className="field">
                        Team name
                        <input
                          maxLength={80}
                          value={route.name}
                          onChange={(e) =>
                            update(
                              "routes",
                              profile.routes.map((r, j) =>
                                j === i ? { ...r, name: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="field">
                        Destination email
                        <input
                          type="email"
                          value={route.email}
                          onChange={(e) =>
                            update(
                              "routes",
                              profile.routes.map((r, j) =>
                                j === i ? { ...r, email: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <label className="field">
                      Routing keywords
                      <input
                        value={route.keywords.join(",")}
                        onChange={(e) =>
                          update(
                            "routes",
                            profile.routes.map((r, j) =>
                              j === i
                                ? {
                                    ...r,
                                    keywords: e.target.value
                                      .split(",")
                                      .slice(0, 30),
                                  }
                                : r,
                            ),
                          )
                        }
                        placeholder="refund, invoice, payment"
                      />
                      <small>
                        Separate keywords with commas, such as refund, invoice,
                        payment.
                      </small>
                    </label>
                  </div>
                ))}
                <div className="boundary-card">
                  <Icon name="chat" />
                  <div>
                    <h3>
                      {connected
                        ? "Tickets are saved before email delivery."
                        : "Preview the handoff."}
                    </h3>
                    <p>
                      {connected
                        ? status?.storage === "postgres"
                          ? "Unconfigured and failed email stays available for retry below."
                          : "Local requests stay on this device. Server email requires a connected workspace."
                        : "Preview who receives the request. Email delivery becomes available when your workspace is connected."}
                    </p>
                  </div>
                </div>
                <div className="document-heading">
                  <h3>Escalation inbox</h3>
                  <span>{tickets.length} recent tickets</span>
                </div>
                {!tickets.length && (
                  <p className="empty-note">
                    No escalations yet. Ask for a person in Test conversation to
                    try a handoff.
                  </p>
                )}
                {tickets.map((ticket) => (
                  <article className="ticket-card" key={ticket.id}>
                    <div>
                      <span
                        className={`tag delivery-${ticket.delivery_status}`}
                      >
                        {deliveryLabel(ticket.delivery_status)}
                      </span>
                      <small>#{ticket.id.slice(0, 8)}</small>
                    </div>
                    <h3>{ticket.subject}</h3>
                    <p>
                      {ticket.team} → {ticket.recipient}
                    </p>
                    <p>{ticket.summary}</p>
                    {ticket.delivery_error && (
                      <small>{ticket.delivery_error}</small>
                    )}
                    {connected &&
                      status?.storage === "postgres" &&
                      [
                        "failed",
                        "not_configured",
                        "pending",
                        "sending",
                      ].includes(ticket.delivery_status) && (
                        <button
                          className="text-link"
                          disabled={!!busy}
                          onClick={() => retry(ticket)}
                        >
                          Retry email delivery <Icon name="reset" />
                        </button>
                      )}
                  </article>
                ))}
              </>
            )}
            {section === "test" && (
              <>
                <div className="section-intro">
                  <h2>
                    Test your <em>agent.</em>
                  </h2>
                  <p>
                    Ask a customer question and review the answer, its sources,
                    and any suggested handoff.
                  </p>
                </div>
                <CallerJourney
                  profile={profile}
                  connected={connected}
                  dirty={dirty}
                  local={status?.storage !== "postgres"}
                />
                {connected && (
                  <details className="voice-test-option">
                    <summary>Test with voice</summary>
                    <VoiceTest
                      enabled={
                        connected && !!status?.voice_configured && !dirty && publishState?.status === "complete" && !publishState?.result?.needs_publish
                      }
                    />
                  </details>
                )}
                <KnowledgeChecks
                  connected={connected}
                  request={api}
                  workspaceDirty={dirty}
                  onSaved={() =>
                    api("voice/publish")
                      .then(setPublishState)
                      .catch(() => {})
                  }
                />
                <div className="test-agent-bar">
                  <span className="status-dot" />
                  <strong>{profile.company_name}</strong>
                  <span>
                    {
                      documents.filter((doc) => doc.status !== "needs_review")
                        .length
                    }{" "}
                    ready sources
                  </span>
                </div>
                <div className="test-transcript" aria-live="polite">
                  <div className="test-bubble agent">
                    <small>AGENT</small>
                    <p>{profile.greeting}</p>
                  </div>
                  {messages.map((m, i) => (
                    <div key={i} className={`test-bubble ${m.role}`}>
                      <small>{m.role.toUpperCase()}</small>
                      <p>{m.text}</p>
                      {m.result?.sources.map((source, n) => (
                        <details className="source-evidence" key={n}>
                          <summary>Source: {source.document}</summary>
                          <p>{source.excerpt}</p>
                        </details>
                      ))}
                      {m.ticketId && (
                        <span className="ticket-reference">
                          Ticket #{m.ticketId.slice(0, 8)} created
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {!messages.length && (
                  <div className="test-suggestions">
                    {[
                      "What is your return policy?",
                      "When are you open?",
                      "I need a human about a billing error",
                    ].map((q) => (
                      <button disabled={!!busy} key={q} onClick={() => ask(q)}>
                        {q}
                        <Icon name="arrow" />
                      </button>
                    ))}
                  </div>
                )}
                <form
                  className="question-entry"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask();
                  }}
                >
                  <input
                    aria-label="Caller question"
                    value={query}
                    maxLength={2000}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask as a customer would…"
                  />
                  <button
                    className="button copper small"
                    disabled={!!busy || query.trim().length < 2}
                  >
                    {busy === "Searching" ? "Searching…" : "Send"}
                    <Icon name="arrow" />
                  </button>
                </form>
                {last?.result?.needs_escalation && !last.ticketId && (
                  <div className="handoff-form">
                    <div>
                      <h3>Offer a human follow-up</h3>
                      <p>
                        {last.result.routing.team} →{" "}
                        {last.result.routing.recipient}
                      </p>
                    </div>
                    <label className="field">
                      Callback email <span className="optional">OPTIONAL</span>
                      <input
                        type="email"
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        placeholder="customer@example.com"
                      />
                    </label>
                    <button
                      className="button dark small"
                      disabled={!!busy}
                      onClick={escalate}
                    >
                      {connected
                        ? "Create escalation ticket"
                        : "Preview escalation ticket"}
                      <Icon name="arrow" />
                    </button>
                    <small>
                      {connected
                        ? status?.storage === "postgres"
                          ? "Creates a saved ticket and attempts configured email delivery."
                          : "Saves the request in this browser. No email is sent."
                        : "Demo only. No email is sent and no live action is taken."}
                    </small>
                  </div>
                )}
                {messages.length > 0 && (
                  <button
                    className="text-link"
                    disabled={!!busy}
                    onClick={() => {
                      setMessages([]);
                      setContact("");
                    }}
                  >
                    Clear conversation <Icon name="reset" />
                  </button>
                )}
              </>
            )}
            {section === "connect" && (
              <>
                <div className="section-intro">
                  <h2>
                    Setup <em>& activity.</em>
                  </h2>
                  <p>
                    Review your company details and follow conversations once
                    your agent is connected.
                  </p>
                </div>
                <div className="readiness-heading">
                  <h3>Workspace checklist</h3>
                  <span>
                    {readiness.filter((item) => item.complete).length} of{" "}
                    {readiness.length} added
                  </span>
                </div>
                <div className="readiness-list">
                  {readiness.map((item) => (
                    <button key={item.id} onClick={() => setSection(item.id)}>
                      <span
                        className={
                          item.complete
                            ? "readiness-check complete"
                            : "readiness-check"
                        }
                      >
                        <Icon name={item.complete ? "check" : "right"} />
                      </span>
                      <strong>{item.label}</strong>
                      <span>{item.complete ? "Added" : "Needs attention"}</span>
                      <Icon name="right" />
                    </button>
                  ))}
                </div>
                <div
                  className="workspace-connection"
                  data-connected={connected}
                >
                  <Icon name="phone" />
                  <div>
                    <h3>
                      {connected
                        ? status?.storage === "postgres"
                          ? "Company workspace connected"
                          : "Local company workspace"
                        : "You’re in demo mode"}
                    </h3>
                    <p>
                      {connected
                        ? status?.storage === "postgres"
                          ? "Company documents and escalation requests are saved to your workspace."
                          : "Saved locally on this device. Clearing browser data removes this workspace; export a backup. Publishing sends approved extracted text to your voice agent."
                        : "You can configure and test your agent here. Your administrator can connect voice and email when you’re ready."}
                    </p>
                  </div>
                </div>
                <div className="heading-actions">
                  {status?.connected && !connected && (
                    <button
                      className="button copper small"
                      disabled={!!busy}
                      onClick={connect}
                    >
                      Load company workspace <Icon name="arrow" />
                    </button>
                  )}
                  <button
                    className="button outline small"
                    onClick={exportWorkspace}
                  >
                    Export company brief <Icon name="document" />
                  </button>
                </div>
                {connected && (
                  <div className="publish-knowledge">
                    <div>
                      <h3>Update your voice agent</h3>
                      <p>
                        Publish the current company knowledge and greeting for
                        future voice conversations.
                      </p>
                    </div>
                    <button
                      className="button copper small"
                      disabled={
                        !!busy ||
                        !status?.voice_configured ||
                        ["queued", "running"].includes(publishState?.status)
                      }
                      onClick={() =>
                        run("Publishing", async () => {
                          const validation = profileError(profile);
                          if (validation) throw new Error(validation);
                          await api("profile", json(profile, "PUT"));
                          const job = await api("voice/publish", {
                            method: "POST",
                          });
                          setPublishState(job);
                          setDirty(false);
                          setNotice(
                            "Preparing knowledge. Keep this tab open until publishing completes; retries reuse saved progress.",
                          );
                        })
                      }
                    >
                      Publish knowledge <Icon name="arrow" />
                    </button>
                    {publishState?.publication && (
                      <p className="empty-note">
                        Last published{" "}
                        {new Date(
                          publishState.publication.published_at,
                        ).toLocaleString()}{" "}
                        · revision{" "}
                        {publishState.publication.revision.slice(0, 10)}
                        {publishState.result?.needs_publish
                          ? " · Saved changes need publishing."
                          : ""}
                      </p>
                    )}
                    {publishState?.result?.warning && (
                      <p className="workspace-alert" role="status">
                        {publishState.result.warning}
                      </p>
                    )}
                    {publishState && (
                      <p role="status">
                        {publishState.status === "complete"
                          ? publishState.result?.needs_publish
                            ? "The workspace changed during publishing. Publish again to include the latest changes."
                            : "Company knowledge published successfully."
                          : publishState.status === "failed"
                            ? publishState.error
                            : publishState.status === "not_published"
                              ? "Knowledge has not been published yet."
                              : `Publishing: ${publishState.status.replaceAll("_", " ")}`}
                      </p>
                    )}
                  </div>
                )}
                {status?.storage === "browser" &&
                  publishState?.status === "complete" && (
                    <button
                      className="text-link"
                      disabled={!!busy}
                      onClick={() =>
                        run("Removing published copies", async () => {
                          await api("provider/cleanup", { method: "POST" });
                          setPublishState(null);
                          setNotice(
                            "Published voice copies removed. Local documents are unchanged.",
                          );
                        })
                      }
                    >
                      Remove published voice copies
                    </button>
                  )}
                <div className="document-heading">
                  <h3>Call activity</h3>
                  <button
                    className="text-link"
                    disabled={!connected || !!busy}
                    onClick={() =>
                      run("Refreshing calls", async () => {
                        const [activity, intake] = await Promise.all([
                          api("conversations"),
                          api("callers"),
                        ]);
                        setCalls(activity.conversations);
                        setCallers(intake.callers);
                      })
                    }
                  >
                    Refresh
                  </button>
                </div>
                {callers.length > 0 && (
                  <details className="support-hours">
                    <summary>
                      Collected callers & callback requests ({callers.length})
                    </summary>
                    {callers.map((caller) => (
                      <CallerDetails
                        key={caller.id}
                        caller={caller}
                        availability={caller.availability_at_request}
                      />
                    ))}
                  </details>
                )}
                {!calls.length && (
                  <p className="empty-note">
                    Completed conversations will appear here after your agent is
                    connected.
                  </p>
                )}
                {calls.map((call) => (
                  <article className="ticket-card" key={call.id}>
                    <div>
                      <span className="tag">{call.status}</span>
                      <small>{call.duration_seconds ?? "—"} seconds</small>
                    </div>
                    <h3>{call.summary || "Conversation completed"}</h3>
                    <p>
                      Outcome: {call.outcome} ·{" "}
                      {call.created_at
                        ? new Date(call.created_at).toLocaleString()
                        : ""}
                    </p>
                    {call.caller && (
                      <CallerDetails
                        caller={call.caller}
                        availability={call.caller.availability_at_request}
                      />
                    )}
                    <CallTranscript call={call} />
                  </article>
                ))}
              </>
            )}
          </fieldset>
        </section>
      </div>
      <div className="workspace-footnote">
        <span>KNOWLEDGE → CONVERSATION → HUMAN FOLLOW-UP</span>
        <span>BUILT TO FIT YOUR BUSINESS ↗</span>
      </div>
    </div>
  );
}
