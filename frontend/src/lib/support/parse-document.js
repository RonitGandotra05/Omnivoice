import { DOCUMENT_LIMITS, extensionFor } from "./document-text.mjs";
export async function parseDocument(file, { signal, onProgress } = {}) {
  extensionFor(file.name);
  if (file.size > DOCUMENT_LIMITS.bytes)
    throw new Error("Maximum document size is 10 MB");
  signal?.throwIfAborted();
  const buffer = await file.arrayBuffer();
  signal?.throwIfAborted();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  signal?.throwIfAborted();
  const fingerprint = [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/document-worker.js", import.meta.url),
      { type: "module" },
    );
    const done = (error, result) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      error ? reject(error) : resolve({ ...result, fingerprint });
    };
    const timeout = setTimeout(
      () =>
        done(
          new Error(
            "Document processing timed out. Split the document or provide a clearer scan.",
          ),
        ),
      150000,
    );
    const abort = () =>
      done(signal.reason || new DOMException("Cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) =>
      data.error
        ? done(new Error(data.error))
        : data.result
          ? done(null, data.result)
          : onProgress?.(data.progress);
    worker.onerror = () =>
      done(
        new Error(
          "The document worker stopped. This file may be invalid or exceed browser resources.",
        ),
      );
    worker.postMessage({ buffer, name: file.name, origin: location.origin }, [
      buffer,
    ]);
  });
}
