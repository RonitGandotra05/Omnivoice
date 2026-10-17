import { DocumentSchema, DocumentsSchema, parse } from "./support/schema.mjs";

// Typed notes and parsed files share one library, quota and publishing pipeline.
export async function saveTextKnowledge({
  request,
  documents,
  title,
  content,
  signal,
}) {
  signal?.throwIfAborted();
  if (!content?.trim()) return documents;
  const draft = parse(DocumentSchema, {
    name: title?.trim() || "Company notes",
    content: content.trim(),
    status: "ready",
    metadata: { source: "manual" },
  });
  const duplicate = documents.find(
    (d) => d.name === draft.name && d.content === draft.content,
  );
  if (duplicate) return documents;
  parse(DocumentsSchema, [...documents, draft]);
  const saved = await request("documents", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  return documents.some((d) => d.id === saved.id)
    ? documents
    : [...documents, saved];
}
