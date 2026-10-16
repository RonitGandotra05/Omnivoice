/**
 * API client for same-origin Next.js routes.
 * All backend calls go through this module.
 */

const BACKEND_URL = '';

/**
 * Base fetch wrapper with error handling
 */
async function apiFetch(path, options = {}) {
  const url = `${BACKEND_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      Array.isArray(error.detail)
        ? error.detail.join("; ")
        : error.detail || error.error || `API error: ${res.status}`,
    );
  }

  return res.json();
}

// ── Companies ──────────────────────────────────────────────────────

export async function listCompanies(page = 1, limit = 20) {
  return apiFetch(`/api/companies?page=${page}&limit=${limit}`);
}

export async function getCompany(id) {
  return apiFetch(`/api/companies/${id}`);
}

export async function createCompany(data) {
  return apiFetch("/api/companies", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateCompany(id, data) {
  return apiFetch(`/api/companies/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteCompany(id) {
  return apiFetch(`/api/companies/${id}`, { method: "DELETE" });
}

// ── Knowledge Documents ─────────────────────────────────────────────

export async function listDocuments(companyId) {
  return apiFetch(`/api/knowledge?company_id=${companyId}`);
}

export async function uploadDocument(companyId, file) {
  const formData = new FormData();
  formData.append("company_id", companyId);
  formData.append("file", file);

  const url = `${BACKEND_URL}/api/knowledge`;
  const res = await fetch(url, {
    method: "POST",
    body: formData,
    // Don't set Content-Type - browser sets it with boundary for FormData
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      error.detail || error.error || `Upload failed: ${res.status}`,
    );
  }

  return res.json();
}

export async function deleteDocument(documentId) {
  return apiFetch(`/api/knowledge/${documentId}`, { method: "DELETE" });
}

// ── Agent ───────────────────────────────────────────────────────────

export async function processQuery(
  query,
  twilioNumber,
  customerPhone,
  history = [],
  actionData = {},
) {
  return apiFetch("/api/agent/process", {
    method: "POST",
    body: JSON.stringify({
      query,
      twilio_number: twilioNumber,
      customer_phone: customerPhone,
      conversation_history: history,
      action_data: actionData,
    }),
  });
}

export async function getGreeting(twilioNumber) {
  return apiFetch(
    `/api/agent/greeting?twilio_number=${encodeURIComponent(twilioNumber)}`,
  );
}

// ── Health ──────────────────────────────────────────────────────────

export async function checkBackendHealth() {
  try {
    const data = await apiFetch("/health");
    return { healthy: true, ...data };
  } catch {
    return { healthy: false };
  }
}
