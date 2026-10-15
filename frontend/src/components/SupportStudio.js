"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
const VoiceTest = dynamic(() => import("@/components/VoiceTest"), {
  ssr: false,
});
import Icon from "@/components/ui/Icon";
import {
  initialProfile,
  initialDocuments,
  validDraft,
  integrationExample,
  voicePrompt,
} from "@/lib/workspace.mjs";

const sections = [
  ["brief", "01", "Company brief", "Your agent’s identity"],
  ["knowledge", "02", "Knowledge", "The source of truth"],
  ["routing", "03", "Escalations", "The human handoff"],
  ["test", "04", "Test conversation", "Put it to work"],
  ["connect", "05", "Connect", "Plug into your stack"],
];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function api(path, options = {}) {
  const response = await fetch(`/api/studio/${path}`, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Request failed. Please try again.");
  return data;
}
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
  const [copied, setCopied] = useState(false);
  const uploadRef = useRef(null);
  const operation = useRef(false);
  const storageKey = "omnivoice-workspace-v1";
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(storageKey));
      if (validDraft(draft)) {
        setProfile(draft.profile);
        setDocuments(draft.documents);
        setTickets(draft.tickets);
      }
    } catch {}
    api("status")
      .then(setStatus)
      .catch(() => setStatus({ available: false, connected: false }));
  }, []);
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
    }
  };
  const update = (field, value) => {
    setProfile((p) => ({ ...p, [field]: value }));
    setNotice("");
    setMessages([]);
  };
  const save = () =>
    run("Saving", async () => {
      if (
        !emailPattern.test(profile.support_email) ||
        profile.routes.some(
          (r) => !r.name.trim() || !emailPattern.test(r.email),
        )
      )
        throw new Error(
          "Enter a valid email address for support and each team, and name every team.",
        );
      if (profile.company_name.trim().length < 2 || !profile.greeting.trim())
        throw new Error("Add a company name and greeting.");
      if (connected) await api("profile", json(profile, "PUT"));
      else
        localStorage.setItem(
          storageKey,
          JSON.stringify({ version: 1, profile, documents, tickets }),
        );
      setNotice(
        connected
          ? "Company configuration saved to the backend."
          : "Demo workspace saved in this browser. No email has been sent.",
      );
    });
  const connect = () =>
    run("Connecting", async () => {
      const data = await api("workspace");
      setProfile(data.profile);
      setDocuments(data.documents);
      setTickets(data.tickets);
      setMessages([]);
      setConnected(true);
      setCalls((await api("conversations")).conversations);
      setNotice(
        "Connected company workspace loaded. Changes now use your company API.",
      );
    });
  const upload = (files) =>
    run("Reading documents", async () => {
      let next = [...documents];
      let failures = [];
      for (const file of Array.from(files)) {
        try {
          if (file.size > 10 * 1024 * 1024)
            throw new Error("Maximum file size is 10 MB");
          if (next.length >= 30)
            throw new Error("Maximum 30 documents per workspace");
          const body = new FormData();
          body.append("file", file);
          const doc = await api(connected ? "documents" : "parse", {
            method: "POST",
            body,
          });
          if (
            !connected &&
            next.reduce((n, d) => n + d.content.length, 0) +
              doc.content.length >
              500000
          )
            throw new Error("Combined text limit is 500,000 characters");
          next.push({ ...doc, id: doc.id || crypto.randomUUID() });
          setDocuments([...next]);
        } catch (err) {
          failures.push(`${file.name}: ${err.message}`);
        }
      }
      setMessages([]);
      if (uploadRef.current) uploadRef.current.value = "";
      if (failures.length) throw new Error(failures.join(" · "));
      setNotice(
        `${files.length} document(s) ready for search. ${connected ? "Saved to the company workspace." : "Save workspace to keep them in this browser."}`,
      );
    });
  const remove = (doc) =>
    run("Removing", async () => {
      if (connected) await api(`documents/${doc.id}`, { method: "DELETE" });
      setDocuments((d) => d.filter((x) => x.id !== doc.id));
      setMessages([]);
    });
  const ask = (question = query) =>
    run("Searching", async () => {
      if (question.trim().length < 2)
        throw new Error("Enter a question with at least 2 characters.");
      // Save configuration first in connected mode so tests use exactly what is visible.
      if (connected) await api("profile", json(profile, "PUT"));
      const result = await api(
        connected ? "query" : "preview",
        json(
          connected
            ? { query: question }
            : {
                query: question,
                profile,
                documents: documents.map(({ name, content }) => ({
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
      setMessages((m) =>
        m.map((x) => (x === last ? { ...x, ticketId: ticket.id } : x)),
      );
      setNotice(
        connected
          ? `Ticket saved. Email status: ${ticket.delivery_status.replaceAll("_", " ")}.`
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
          {connected ? "CONNECTED WORKSPACE" : "SANDBOX · NO LIVE ACTIONS"}
        </span>
      </div>
      <div className="workspace-title">
        <div>
          <p className="eyebrow">YOUR COMPANY. ON CALL.</p>
          <h1>
            Make it <em>your agent.</em>
          </h1>
          <p>Give it the knowledge. Define the handoff. Test every answer.</p>
        </div>
        <button className="button dark small" disabled={!!busy} onClick={save}>
          {busy === "Saving" ? "Saving…" : "Save workspace"}
          <Icon name="check" />
        </button>
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
                  ? "Company API connected"
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
                ? "Your company key stays on the server. Requests are scoped to this workspace."
                : "A safe place to build. Documents are parsed by your local backend. Calls and email stay off."}
            </p>
          </div>
          <Link className="text-link" href="/">
            Back to overview <Icon name="arrow" />
          </Link>
        </aside>
        <section className="workspace-content" aria-busy={!!busy}>
          <div className="workspace-topline">
            <span className="eyebrow">
              {sections.find((s) => s[0] === section)?.[1]} /{" "}
              {sections.find((s) => s[0] === section)?.[2].toUpperCase()}
            </span>
            <span className="tag">{connected ? "COMPANY" : "DEMO"}</span>
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
                  A familiar voice.
                  <br />
                  <em>Your company’s expertise.</em>
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
                <small>
                  Used in the exported voice-agent prompt. Document search
                  returns source excerpts.
                </small>
              </label>
              <div className="boundary-card">
                <Icon name="shield" />
                <div>
                  <h3>Helpful, with clear boundaries.</h3>
                  <p>
                    Unknown answer? Offer a handoff. Refund or booking? Require
                    a connected tool. Never claim that an email was delivered
                    before delivery succeeds.
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
                  Good answers start
                  <br />
                  with <em>good sources.</em>
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
                  {busy === "Reading documents"
                    ? "Reading your documents…"
                    : "Choose company documents"}
                </strong>
                <span>PDF, DOCX, TXT, Markdown, JSON · 10 MB each</span>
                <small>
                  30 files / 500,000 characters total · text-based PDFs only
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
              <div className="document-list">
                {documents.map((doc) => (
                  <article key={doc.id}>
                    <div className="document-row">
                      <Icon name="document" />
                      <div>
                        <strong>{doc.name}</strong>
                        <small>
                          {doc.content.length.toLocaleString()} characters ·
                          Ready for search
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
                      <pre>{doc.content}</pre>
                    </details>
                  </article>
                ))}
              </div>
              <p className="microcopy">
                Demo changes stay in this tab until you save the workspace.
                Review extracted text before using it for customer support.
                After removing a connected document, sync voice knowledge to
                remove its provider copy.
              </p>
            </>
          )}
          {section === "routing" && (
            <>
              <div className="section-intro">
                <h2>
                  Automation, with
                  <br />a <em>human way through.</em>
                </h2>
                <p>
                  Route issues to the right inbox. Tickets include the caller’s
                  question, contact details, and conversation transcript.
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
                      Comma separated. Most matching keywords wins; first team
                      breaks ties.
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
                      : "Email preview, without credentials."}
                  </h3>
                  <p>
                    {connected
                      ? "Unconfigured and failed email stays available for retry below."
                      : "Demo tickets show the destination and summary. Add SMTP settings in .env to enable delivery in a connected workspace."}
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
                    <span className="tag">
                      {ticket.delivery_status.replaceAll("_", " ")}
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
                    ["failed", "not_configured", "pending", "sending"].includes(
                      ticket.delivery_status,
                    ) && (
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
              <VoiceTest enabled={connected} />
              <div className="section-intro">
                <h2>
                  Ask a real question.
                  <br />
                  <em>Inspect the answer.</em>
                </h2>
                <p>
                  Live document search, with source excerpts. This tests
                  knowledge and routing; voice quality requires a connected
                  voice provider.
                </p>
              </div>
              <div className="test-agent-bar">
                <span className="status-dot" />
                <strong>{profile.company_name}</strong>
                <span>{documents.length} knowledge sources</span>
              </div>
              <div className="test-transcript" aria-live="polite">
                <div className="test-bubble agent">
                  <small>AGENT GREETING / VOICE CONFIGURATION</small>
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
                      ? "Creates a saved ticket and attempts configured email delivery."
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
                  Your expertise.
                  <br />
                  <em>Everywhere you answer.</em>
                </h2>
                <p>
                  Use the same tenant-scoped tools from your phone agent, CRM,
                  or backend. Keep company API keys on the server.
                </p>
              </div>
              <div className="integration-status">
                <span className="status-dot" />
                <div>
                  <strong>Support API</strong>
                  <p>
                    {status?.available
                      ? "Local backend available"
                      : "Start the backend on localhost:8000"}
                  </p>
                </div>
                <span className="tag">
                  {status?.available ? "AVAILABLE" : "OFFLINE"}
                </span>
              </div>
              <div className="connection-steps">
                <article>
                  <span>01</span>
                  <div>
                    <h3>Create your company</h3>
                    <p>
                      Set INTEGRATION_API_KEY in the backend .env. Use POST
                      /api/companies with your name, slug, and support email.
                      Save the returned company ID and API key.
                    </p>
                  </div>
                </article>
                <article>
                  <span>02</span>
                  <div>
                    <h3>Connect this studio</h3>
                    <p>
                      Add SUPPORT_COMPANY_ID and SUPPORT_API_KEY to
                      frontend/.env.local. Sign in as an administrator, then
                      load the workspace. Upload documents and save your routing
                      rules.
                    </p>
                  </div>
                </article>
                <article>
                  <span>03</span>
                  <div>
                    <h3>Connect voice & email</h3>
                    <p>
                      Configure your voice agent with the server tools in the
                      integration guide. Add SMTP settings and
                      EMAIL_ENABLED=true to the backend .env. Your company key
                      authenticates each tool request.
                    </p>
                  </div>
                </article>
              </div>
              <details className="snippet-card">
                <summary>Inspect voice-agent prompt</summary>
                <pre>{voicePrompt(profile)}</pre>
              </details>
              <div className="snippet-card">
                <div className="panel-heading">
                  <span className="eyebrow">
                    SERVER INTEGRATION / DOCUMENT SEARCH
                  </span>
                  <button
                    className="text-link"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          integrationExample(),
                        );
                        setCopied(true);
                      } catch {
                        setError(
                          "Clipboard unavailable. Select the code below.",
                        );
                      }
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre>{integrationExample()}</pre>
              </div>
              <div className="heading-actions">
                <button
                  className="button dark small"
                  disabled={!!busy || !status?.connected}
                  onClick={connect}
                >
                  Load connected workspace <Icon name="arrow" />
                </button>
                <button
                  className="button outline small"
                  onClick={exportWorkspace}
                >
                  Export company brief <Icon name="document" />
                </button>
              </div>
              <div className="boundary-card">
                <Icon name="phone" />
                <div>
                  <h3>Company knowledge & voice</h3>
                  <p>
                    Synchronize saved documents and the company prompt to its
                    dedicated company voice agent. Enable RAG and configure the
                    escalation server tool in the voice platform before taking
                    customer calls.
                  </p>
                  <button
                    className="text-link"
                    disabled={!connected || !!busy}
                    onClick={() =>
                      run("Syncing voice", async () => {
                        await api("profile", json(profile, "PUT"));
                        const result = await api("voice/sync", {
                          method: "POST",
                        });
                        setNotice(result.message);
                      })
                    }
                  >
                    Sync knowledge to your voice agent <Icon name="arrow" />
                  </button>
                </div>
              </div>
              <div className="document-heading">
                <h3>Call activity</h3>
                <button
                  className="text-link"
                  disabled={!connected || !!busy}
                  onClick={() =>
                    run("Refreshing calls", async () => {
                      setCalls((await api("conversations")).conversations);
                    })
                  }
                >
                  Refresh
                </button>
              </div>
              {!calls.length && (
                <p className="empty-note">
                  No completed calls tracked yet. Configure the signed post-call
                  webhook to receive transcripts and outcomes.
                </p>
              )}
              {calls.map((call) => (
                <article className="ticket-card" key={call.id}>
                  <div>
                    <span className="tag">{call.status}</span>
                    <small>{call.duration_seconds ?? "—"} seconds</small>
                  </div>
                  <h3>{call.summary || "Conversation completed"}</h3>
                  <p>Outcome: {call.outcome}</p>
                  <details>
                    <summary>Transcript</summary>
                    <pre>
                      {call.transcript
                        .map((t) => `${t.role}: ${t.message || ""}`)
                        .join("\n")}
                    </pre>
                  </details>
                </article>
              ))}
              <p className="microcopy">
                Full setup, tool schemas, environment variables, and delivery
                behavior are documented in docs/company-integration.md.
              </p>
            </>
          )}
        </section>
      </div>
      <div className="workspace-footnote">
        <span>KNOWLEDGE → CONVERSATION → HUMAN FOLLOW-UP</span>
        <span>BUILT TO FIT YOUR BUSINESS ↗</span>
      </div>
    </div>
  );
}
