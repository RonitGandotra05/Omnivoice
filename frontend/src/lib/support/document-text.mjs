import { unzipSync } from "fflate";
export const DOCUMENT_LIMITS = {
  bytes: 10 * 1024 * 1024,
  characters: 200000,
  pages: 100,
  ocrPages: 30,
  pixels: 20000000,
  expanded: 24 * 1024 * 1024,
};
export function extensionFor(name) {
  if (
    typeof name !== "string" ||
    name.length > 255 ||
    /[\x00-\x1f\/\\]/.test(name)
  )
    throw new Error("Use a simple filename without path separators");
  const ext = name.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx", "txt", "md", "json"].includes(ext))
    throw new Error("Use PDF, DOCX, TXT, Markdown or JSON documents");
  return ext;
}
function entries(raw) {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let eocd = -1;
  for (let i = raw.length - 22; i >= Math.max(0, raw.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("Invalid DOCX archive");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (
    count > 500 ||
    count === 65535 ||
    offset >= eocd ||
    view.getUint16(eocd + 4, true) ||
    view.getUint16(eocd + 6, true)
  )
    throw new Error("Oversized, split or ZIP64 archives are unsupported");
  let total = 0;
  const result = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("Invalid DOCX directory");
    const flags = view.getUint16(offset + 8, true),
      compressed = view.getUint32(offset + 20, true),
      size = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true);
    if (offset + 46 + length + extra + comment > eocd)
      throw new Error("Invalid archive entry");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      raw.subarray(offset + 46, offset + 46 + length),
    );
    if (
      flags & 1 ||
      size === 0xffffffff ||
      compressed === 0xffffffff ||
      size > DOCUMENT_LIMITS.expanded ||
      size > Math.max(1024, compressed) * 150
    )
      throw new Error(
        "Encrypted or excessively compressed documents are unsupported",
      );
    total += size;
    if (
      total > DOCUMENT_LIMITS.expanded ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\") ||
      /vbaProject|embeddings\/|activeX\//i.test(name)
    )
      throw new Error("Unsafe or oversized DOCX contents");
    result.push({ name, size });
    offset += 46 + length + extra + comment;
  }
  return result;
}
function unescapeXML(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v) => {
    if (v[0] === "#") {
      const n =
        v[1].toLowerCase() === "x"
          ? parseInt(v.slice(2), 16)
          : parseInt(v.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : " ";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
      v.toLowerCase()
    ];
  });
}
export function docxText(raw) {
  const directory = entries(raw);
  if (
    !directory.some((e) => e.name === "[Content_Types].xml") ||
    !directory.some((e) => e.name === "word/document.xml")
  )
    throw new Error("This is not a DOCX document");
  const wanted = (name) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(
      name,
    ) || /\.rels$/.test(name);
  const decoded = unzipSync(raw, {
    filter: (entry) => {
      if (entry.originalSize > DOCUMENT_LIMITS.expanded)
        throw new Error("Expanded content limit exceeded");
      return wanted(entry.name);
    },
  });
  let result = "";
  for (const [name, bytes] of Object.entries(decoded)) {
    if (bytes.length > DOCUMENT_LIMITS.expanded)
      throw new Error("Expanded content limit exceeded");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("XML entities are unsupported");
    if (name.endsWith(".rels")) {
      if (/TargetMode\s*=\s*["']External/i.test(xml))
        throw new Error(
          "Remove external links or linked objects from the DOCX before upload",
        );
      continue;
    }
    const parts =
      xml.match(
        /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<\/w:p>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g,
      ) || [];
    for (const part of parts) {
      result +=
        part.startsWith("<w:t>") || /^<w:t\s/.test(part)
          ? unescapeXML(part.replace(/^<w:t[^>]*>|<\/w:t>$/g, ""))
          : part === "</w:p>"
            ? "\n\n"
            : " ";
      if (result.length > DOCUMENT_LIMITS.characters)
        throw new Error("Extracted text exceeds 200,000 characters");
    }
  }
  return result;
}
export function finishText(content, name, metadata = {}) {
  const text = content.replace(/\r\n?/g, "\n").replace(/\0/g, "").trim();
  if (text.length < 10 || !/[\p{L}\p{N}]/u.test(text))
    throw new Error("The document does not contain enough readable text");
  if (text.length > DOCUMENT_LIMITS.characters)
    throw new Error(
      "Extracted text exceeds 200,000 characters; split this document",
    );
  if ((text.match(/\uFFFD/g) || []).length > text.length * 0.01)
    throw new Error("Text could not be decoded reliably");
  return {
    name,
    content: text,
    metadata,
    status: metadata.needs_review ? "needs_review" : "ready",
  };
}
export function parseSimple(raw, name) {
  const ext = extensionFor(name);
  if (raw.length > DOCUMENT_LIMITS.bytes)
    throw new Error("Maximum document size is 10 MB");
  if (ext === "docx")
    return finishText(docxText(raw), name, { format: "docx" });
  if (ext === "pdf") throw new Error("PDF requires the document worker");
  let text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (ext === "json") {
    const json = JSON.parse(text);
    text = Array.isArray(json)
      ? json
          .map((item) =>
            typeof item === "object"
              ? Object.entries(item || {})
                  .map(
                    ([k, v]) =>
                      `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
                  )
                  .join("\n")
              : String(item),
          )
          .join("\n\n")
      : typeof json === "object" && json
        ? Object.entries(json)
            .map(
              ([k, v]) =>
                `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
            )
            .join("\n\n")
        : String(json);
  }
  return finishText(text, name, { format: ext });
}
