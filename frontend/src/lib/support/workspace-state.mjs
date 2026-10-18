import {
  initialProfile,
  initialDocuments,
  voicePrompt,
  validDraft,
} from "../workspace.mjs";
import {
  ProfileSchema,
  DocumentsSchema,
  DocumentSchema,
  CallerSchema,
  TicketSchema,
  ChecksSchema,
  parse,
} from "./schema.mjs";
import { answer, evaluateChecks, routeTicket } from "./knowledge.mjs";
import { availability } from "./hours.mjs";
export const freshWorkspace = () => ({
  version: 2,
  profile: structuredClone(initialProfile),
  documents: structuredClone(initialDocuments).map((d) => ({
    ...d,
    status: "ready",
    metadata: {},
  })),
  tickets: [],
  callers: [],
  conversations: [],
  cases: [],
  report: null,
  publish: { status: "not_published", result: {} },
  releases: [],
  providerDocuments: {},
  agentToken: null,
  revision: 0,
});
export function migrateDraft(draft) {
  const state = freshWorkspace();
  if (validDraft(draft)) {
    state.profile = parse(ProfileSchema, draft.profile);
    state.documents = parse(DocumentsSchema, draft.documents);
    state.tickets = draft.tickets.slice(0, 100);
  }
  return state;
}
export function fail(message, status = 422) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export function workspaceRevision(state) {
  const raw = JSON.stringify([
    state.profile,
    state.documents
      .filter((d) => d.status !== "needs_review")
      .map((d) => [d.id, d.name, d.content]),
    state.cases,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++)
    hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function createTicket(state, values, saved = true) {
  const body = parse(TicketSchema, values);
  const prior = state.tickets.find(
    (t) => t.idempotency_key === body.idempotency_key,
  );
  if (prior) return { ticket: prior, duplicate: true };
  const ticket = {
    ...body,
    id: crypto.randomUUID(),
    ...routeTicket(state.profile, body.subject + " " + body.summary),
    status: "open",
    delivery_status: saved ? "not_configured" : "demo_only",
    delivery_error: null,
    attempts: 0,
    created_at: new Date().toISOString(),
  };
  state.tickets = [ticket, ...state.tickets].slice(0, 100);
  return { ticket, duplicate: false };
}
export function captureCaller(
  state,
  values,
  { preview = false, at, channel = "browser", storage = "browser" } = {},
) {
  const body = parse(CallerSchema, values);
  const current = availability(state.profile, at);
  if (body.action === "availability" && !body.human_requested && !body.callback_requested) return { availability: current };
  const previous = state.callers.find(
    (c) => c.conversation_id === body.conversation_id,
  );
  const time = new Date().toISOString();
  const caller = {
    ...previous,
    ...body,
    id: previous?.id || crypto.randomUUID(),
    saved: !preview,
    storage,
    identity: "self_reported",
    created_at: previous?.created_at || time,
    updated_at: time,
  };
  delete caller.action;
  if (
    caller.handoff === "callback_requested" &&
    !(body.consent && (body.phone || body.email))
  )
    caller.handoff = "follow_up_requested";
  let result = { caller, availability: current };
  // One tool invocation must not drop an explicit request while saving contacts.
  const requestedHandoff =
    body.action === "handoff" ||
    body.human_requested ||
    body.callback_requested;
  if (requestedHandoff) {
    const decision =
      current.available && channel === "phone" && !body.callback_requested
        ? "transfer_available"
        : body.callback_requested && body.consent && (body.phone || body.email)
          ? "callback_requested"
          : "follow_up_requested";
    Object.assign(caller, {
      handoff: decision,
      suggested_callback_at: current.next_open,
      callback_booked: false,
      availability_at_request: current,
    });
    result = {
      ...result,
      decision,
      transfer_number:
        decision === "transfer_available" ? state.profile.human_phone : null,
      message: preview
        ? "Preview only. Nothing was saved or sent."
        : storage === "browser"
          ? "Request saved in this browser. No email sent or callback appointment booked."
          : "Request saved for the team. No callback appointment booked.",
    };
  }
  if (!preview) {
    let ticket = state.tickets.find((t) => t.id === caller.ticket_id);
    if (requestedHandoff || ticket) {
      const summary = [
        `Caller: ${body.name || "Not provided"}`,
        `Reason: ${body.reason || "Caller requested human support"}`,
        `Conversation: ${body.conversation_id}`,
        `Request: ${caller.handoff}`,
        `Callback preference: ${body.callback_preference || "Not provided"}`,
        `Next opening: ${current.next_open || "Not specified"} (${current.timezone})`,
        "A callback request is not a confirmed appointment. Contact details are self-reported.",
      ].join("\n");
      if (!ticket) {
        ticket = createTicket(state, {
          subject: "Caller requested human support",
          summary,
          customer_email: body.email,
          customer_phone: body.phone,
          idempotency_key: caller.id,
        }).ticket;
        caller.ticket_id = ticket.id;
      } else
        Object.assign(ticket, {
          summary,
          customer_email: body.email,
          customer_phone: body.phone,
        });
      result.ticket = ticket;
    }
    state.callers = [
      caller,
      ...state.callers.filter((c) => c.id !== caller.id),
    ].slice(0, 100);
  }
  return result;
}
/** Same domain operations run in IndexedDB or inside a PostgreSQL transaction. */
export function workspaceAction(
  state,
  path,
  method = "GET",
  body = {},
  options = {},
) {
  const saved = options.storage !== "preview";
  if (path === "workspace" && method === "GET")
    return { ...state, prompt: voicePrompt(state.profile) };
  if (path === "profile" && method === "PUT") {
    state.profile = parse(ProfileSchema, body);
    return { profile: state.profile, prompt: voicePrompt(state.profile) };
  }
  if (path === "documents" && method === "POST") {
    const doc = parse(DocumentSchema, body);
    const previous = state.documents.find((d) =>
      doc.fingerprint
        ? d.fingerprint === doc.fingerprint
        : d.name === doc.name && d.content === doc.content,
    );
    if (previous) return { ...previous, duplicate: true };
    const all = parse(DocumentsSchema, [
      ...state.documents,
      { ...doc, id: doc.id || crypto.randomUUID() },
    ]);
    state.documents = all;
    return all.at(-1);
  }
  const documentPath = path.match(/^documents\/([^/]+)(\/approve)?$/);
  if (documentPath) {
    const [, id, approve] = documentPath;
    const doc = state.documents.find((d) => d.id === id);
    if (!doc) fail("Document not found", 404);
    if (method === "GET" && !approve) return doc;
    if (method === "DELETE" && !approve) {
      state.documents = state.documents.filter((d) => d.id !== id);
      return { deleted: true };
    }
    if (method === "POST" && approve) {
      const next = parse(DocumentSchema, {
        ...doc,
        ...body,
        id,
        status: "ready",
        metadata: { ...doc.metadata, needs_review: false, reviewed: true },
      });
      state.documents = state.documents.map((d) => (d.id === id ? next : d));
      parse(DocumentsSchema, state.documents);
      return next;
    }
  }
  if (path === "query" && method === "POST") {
    if (
      typeof body.query !== "string" ||
      body.query.trim().length < 2 ||
      body.query.length > 2000
    )
      fail("Provide a question between 2 and 2,000 characters");
    return answer(body.query, state.profile, state.documents);
  }
  if (path === "checks" && method === "GET")
    return {
      cases: state.cases,
      report: state.report
        ? {
            ...state.report,
            stale: state.report.revision !== workspaceRevision(state),
          }
        : { status: "not_run" },
    };
  if (path === "checks" && method === "PUT") {
    state.cases = parse(ChecksSchema, body.cases);
    state.report = null;
    return { cases: state.cases };
  }
  if (path === "checks/run" && method === "POST") {
    state.report = {
      ...evaluateChecks(state.profile, state.documents, state.cases),
      revision: workspaceRevision(state),
      stale: false,
    };
    return state.report;
  }
  if (path === "availability" && method === "GET")
    return availability(state.profile);
  if (path === "caller-context" && method === "POST")
    return captureCaller(state, body, options);
  if (path === "callers" && method === "GET") return { callers: state.callers };
  if (path.startsWith("callers/") && method === "GET")
    return {
      caller:
        state.callers.find((c) => c.conversation_id === path.slice(8)) || null,
    };
  if (path.startsWith("conversations/") && method === "GET") {
    const call = state.conversations.find((c) => c.id === path.slice(14));
    if (!call) fail("Conversation not found", 404);
    return call;
  }
  if (path === "conversations" && method === "GET")
    return {
      conversations: state.conversations.map((c) => ({
        ...c,
        caller: state.callers.find((p) => p.conversation_id === c.id) || null,
      })),
    };
  if (path === "conversations" && method === "POST") {
    if (typeof body.id !== "string" || !/^[\w-]{1,120}$/.test(body.id))
      fail("Invalid conversation ID");
    const rows = Array.isArray(body.transcript)
      ? body.transcript.slice(-100).map((t) => ({
          role: String(t.role).slice(0, 20),
          message: String(t.message || t.text || "").slice(0, 4000),
        }))
      : [];
    const value = {
      id: body.id,
      status: "done",
      transcript: rows,
      summary: String(body.summary || "Browser conversation").slice(0, 4000),
      duration_seconds: Math.min(
        3600,
        Math.max(0, Number(body.duration_seconds) || 0),
      ),
      outcome: String(body.outcome || "unknown").slice(0, 50),
      created_at: new Date().toISOString(),
    };
    state.conversations = [
      value,
      ...state.conversations.filter((c) => c.id !== value.id),
    ].slice(0, 100);
    return value;
  }
  if (path === "escalations" && method === "POST")
    return createTicket(state, body, saved);
  if (/^escalations\/[^/]+\/retry$/.test(path) && method === "POST") {
    const ticket = state.tickets.find((t) => t.id === path.split("/")[1]);
    if (!ticket) fail("Ticket not found", 404);
    return { ticket };
  }
  if (path === "voice/publish" && method === "GET")
    return {
      ...state.publish,
      publication: state.releases[0],
      result: {
        ...state.publish.result,
        needs_publish:
          !state.agentToken ||
          state.releases[0]?.revision !== workspaceRevision(state),
      },
    };
  if (path === "voice/releases" && method === "GET")
    return { releases: state.releases };
  fail("Unknown workspace action", 404);
}
