import { parseSimple, extensionFor } from "../lib/support/document-text.mjs";
import { parsePDF } from "../lib/support/pdf-text.mjs";
self.onmessage = async ({ data }) => {
  try {
    const raw = new Uint8Array(data.buffer);
    const result =
      extensionFor(data.name) === "pdf"
        ? await parsePDF(raw, data.name, {
            origin: data.origin,
            progress: (progress) => self.postMessage({ progress }),
          })
        : parseSimple(raw, data.name);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error:
        error?.name === "PasswordException"
          ? "Password-protected PDFs are unsupported. Export an unlocked copy."
          : error.message || "Document parsing failed",
    });
  }
};
