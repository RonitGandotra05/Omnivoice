import {
  localAction,
  readWorkspace,
  updateWorkspace,
} from "./indexed-store.mjs";
import {
  freshWorkspace,
  captureCaller,
  workspaceRevision,
} from "./workspace-state.mjs";
import { parse, ProfileSchema, DocumentsSchema } from "./schema.mjs";
import { answer, evaluateChecks } from "./knowledge.mjs";
let capabilities;
const jobs = new Map();
export async function serverRequest(
  path,
  body,
  { signal, method = "POST" } = {},
) {
  const response = await fetch("/api/studio/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = response.status;
    error.retryAfterMs =
      Number(response.headers.get("retry-after") || 0) * 1000;
    throw error;
  }
  if (data.documents_deferred) {
    let next = 0;
    const documents = new Array(data.documents.length);
    await Promise.all(
      Array.from({ length: Math.min(2, documents.length) }, async () => {
        while (next < documents.length) {
          const i = next++;
          documents[i] = await serverRequest(
            `documents/${data.documents[i].id}`,
            null,
            { method: "GET", signal },
          );
        }
      }),
    );
    data.documents = documents;
    delete data.documents_deferred;
  }
  return data;
}
const jsonOptions = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
async function publishWorkspace(mode = "browser") {
  const cache = await readWorkspace();
  const snapshot =
    mode === "postgres"
      ? await serverRequest("workspace", null, { method: "GET" })
      : cache;
  snapshot.providerDocuments = cache.providerDocuments;
  if (snapshot.documents.some((d) => d.status === "needs_review"))
    throw new Error("Review or remove flagged OCR documents before publishing");
  const report = evaluateChecks(
    snapshot.profile,
    snapshot.documents,
    snapshot.cases,
  );
  if (report.status === "failed")
    throw new Error(
      "Saved knowledge checks failed. Fix them before publishing.",
    );
  const jobId = crypto.randomUUID();
  const revision = workspaceRevision(snapshot);
  const job = {
    job_id: jobId,
    status: "running",
    result: { completed: 0, total: snapshot.documents.length },
  };
  await updateWorkspace((s) => {
    s.publish = job;
  });
  const work = (async () => {
    try {
      const receipts = [];
      let next = 0,
        completed = 0;
      const documents = snapshot.documents.filter(
        (d) => d.status !== "needs_review",
      );
      const prepared = await Promise.allSettled(
        Array.from({ length: Math.min(2, documents.length) }, async () => {
          while (next < documents.length) {
            const doc = documents[next++];
            const old = snapshot.providerDocuments[doc.id];
            let response;
            try {
              response = await serverRequest("voice/knowledge", {
                document: doc,
                receipt: old?.receipt,
              });
            } catch (error) {
              if (error.status !== 401 || !old?.receipt) throw error;
              response = await serverRequest("voice/knowledge", {
                document: doc,
              });
            }
            await updateWorkspace((s) => {
              s.providerDocuments[doc.id] = { receipt: response.receipt };
            });
            let receipt = response.receipt;
            let ready = response.ready;
            const deadline = Date.now() + 180000;
            while (!ready) {
              if (Date.now() > deadline)
                throw new Error(
                  "Knowledge indexing is pending. Retry publishing to reuse prepared documents.",
                );
              await new Promise((r) => setTimeout(r, 2000));
              const index = await serverRequest("voice/index", { receipt });
              ready = index.ready;
              receipt = index.receipt || receipt;
            }
            receipts.push(receipt);
            await updateWorkspace((s) => {
              s.providerDocuments[doc.id] = { receipt };
            });
            completed++;
            await updateWorkspace((s) => {
              s.publish = {
                ...job,
                result: { completed, total: documents.length },
              };
            });
          }
        }),
      );
      const failed = prepared.find((item) => item.status === "rejected");
      if (failed) throw failed.reason;
      if (
        workspaceRevision(
          mode === "postgres"
            ? await serverRequest("workspace", null, { method: "GET" })
            : await readWorkspace(),
        ) !== revision
      )
        throw new Error(
          "Workspace changed while preparing knowledge. Publish again.",
        );
      const result = await serverRequest("voice/publish", {
        profile: snapshot.profile,
        knowledge: receipts,
      });
      await updateWorkspace((s) => {
        const receipt = {
          id: jobId,
          revision,
          published_at: new Date().toISOString(),
          document_count: documents.length,
          checks_passed: report.passed,
          checks_total: report.total,
        };
        if (s.agentToken)
          s.retiredAgents = [...(s.retiredAgents || []), s.agentToken].slice(
            -10,
          );
        s.agentToken = result.agent_token;
        s.releases = [receipt, ...s.releases].slice(0, 10);
        s.publish = {
          ...job,
          status: "complete",
          result: {
            ...result,
            agent_token: undefined,
            needs_publish: workspaceRevision(s) !== revision,
          },
        };
      });
    } catch (error) {
      await updateWorkspace((s) => {
        s.publish = {
          ...job,
          status: "failed",
          error: error.message,
          result: {},
        };
      });
    } finally {
      jobs.delete(jobId);
    }
  })();
  jobs.set(jobId, work);
  return job;
}
export async function studioRequest(path, options = {}) {
  options.signal?.throwIfAborted();
  const method = options.method || "GET";
  if (path === "status") {
    capabilities = await serverRequest("status", null, {
      method: "GET",
      signal: options.signal,
    });
    return capabilities;
  }
  const mode = capabilities?.storage || "browser";
  const body =
    typeof options.body === "string"
      ? JSON.parse(options.body)
      : options.body || {};
  if (
    path === "parse" ||
    (path === "documents" && options.body instanceof FormData)
  ) {
    const { parseDocument } = await import("./parse-document.js");
    const file = options.body.get("file");
    const doc = await parseDocument(file, { signal: options.signal });
    return mode === "postgres"
      ? serverRequest("documents", doc)
      : localAction("documents", "POST", doc);
  }
  if (path === "preview") {
    const profile = parse(ProfileSchema, body.profile);
    const documents = parse(DocumentsSchema, body.documents || []);
    return {
      ...answer(body.query, profile, documents),
      preview: true,
      email_sent: false,
    };
  }
  if (path === "preview-caller") {
    const state = {
      ...freshWorkspace(),
      profile: parse(ProfileSchema, body.profile),
    };
    return captureCaller(state, body, {
      preview: true,
      at: body.at,
      storage: "preview",
    });
  }
  if (path === "voice/session") {
    let state = await readWorkspace();
    if (!state.agentToken && mode === "postgres") {
      const published = await serverRequest("voice/publish", null, {
        method: "GET",
      });
      if (published.agent_token) {
        await updateWorkspace((s) => {
          s.agentToken = published.agent_token;
        });
        state = await readWorkspace();
      }
    }
    if (
      mode === "browser" &&
      state.releases[0]?.revision !== workspaceRevision(state)
    )
      throw new Error(
        "Publish your latest workspace changes before starting voice.",
      );
    if (!state.agentToken)
      throw new Error(
        "Publish your workspace knowledge before starting voice.",
      );
    return serverRequest(
      path,
      { agent_token: state.agentToken },
      { signal: options.signal },
    );
  }
  if (path === "voice/publish" && method === "POST") {
    if (!capabilities?.voice_configured)
      throw new Error(
        "Voice is not configured. Add the server API key to enable it.",
      );
    return publishWorkspace(mode);
  }
  if (mode === "postgres" && path === "voice/publish" && method === "GET") {
    const cached = await readWorkspace();
    if (cached.publish.status === "running" && jobs.has(cached.publish.job_id))
      return cached.publish;
    const result = await serverRequest(path, null, { method: "GET" });
    if (result.agent_token)
      await updateWorkspace((s) => {
        s.agentToken = result.agent_token;
      });
    return result;
  }
  if (mode === "postgres")
    return serverRequest(path, method === "GET" ? null : body, {
      method,
      signal: options.signal,
    });
  if (path === "voice/publish" && method === "GET") {
    const state = await readWorkspace();
    if (state.publish.status === "running" && !jobs.has(state.publish.job_id))
      await updateWorkspace((s) => {
        s.publish = {
          ...s.publish,
          status: "failed",
          error:
            "Publishing was interrupted. Retry to reuse saved document receipts.",
        };
      });
  }
  if (path === "workspace/save" && method === "PUT") {
    parse(ProfileSchema, body.profile);
    parse(DocumentsSchema, body.documents);
    return updateWorkspace((s) => {
      s.profile = body.profile;
      const drafts = new Map(body.documents.map((d) => [d.id, d]));
      s.documents = s.documents.map((d) =>
        d.status === "needs_review" &&
        drafts.get(d.id)?.status === "needs_review"
          ? { ...d, content: drafts.get(d.id).content }
          : d,
      );
    });
  }
  if (path === "provider/cleanup" && method === "POST") {
    const state = await readWorkspace();
    const tokens = [state.agentToken, ...(state.retiredAgents || [])].filter(
      Boolean,
    );
    const deleted = new Set();
    for (const token of tokens) {
      await serverRequest("voice/cleanup", {
        agent_token: token,
        part: "agent",
      });
      const payload = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(
            atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")),
            (c) => c.charCodeAt(0),
          ),
        ),
      );
      const ids = (payload.documents || []).filter((id) => !deleted.has(id));
      for (let start = 0; start < ids.length; start += 3) {
        const group = ids.slice(start, start + 3);
        await serverRequest("voice/cleanup", {
          agent_token: token,
          part: "documents",
          ids: group,
        });
        group.forEach((id) => deleted.add(id));
      }
    }
    await updateWorkspace((s) => {
      s.agentToken = null;
      s.retiredAgents = [];
      s.providerDocuments = {};
      s.publish = { status: "not_published", result: {} };
    });
    return { deleted: true };
  }
  return localAction(path, method, body);
}
export async function recordVoiceTranscript(id, transcript, seconds) {
  return studioRequest(
    "conversations",
    jsonOptions({ id, transcript, duration_seconds: seconds }),
  );
}
export async function runVoiceTool(values, conversationId) {
  if (!conversationId)
    throw new Error("Voice connection has not supplied a conversation ID");
  return studioRequest(
    "caller-context",
    jsonOptions({
      ...values,
      conversation_id: conversationId,
      action: values.action || "capture",
    }),
  );
}
export async function searchVoiceKnowledge(query) {
  return studioRequest("query", jsonOptions({ query }));
}
