import { DOCUMENT_LIMITS, finishText } from "./document-text.mjs";
export async function parsePDF(
  raw,
  name,
  {
    origin,
    progress = () => {},
    loadEngine = () => import("pdfjs-dist/legacy/build/pdf.mjs"),
    createCanvas = (w, h) => new OffscreenCanvas(w, h),
    createOCR,
  } = {},
) {
  let pdf, ocr, loadingTask;
  try {
    if (raw.length > DOCUMENT_LIMITS.bytes)
      throw new Error("Maximum document size is 10 MB");
    if (!new TextDecoder().decode(raw.subarray(0, 1024)).includes("%PDF-"))
      throw new Error("Invalid PDF signature");
    const pdfjs = await loadEngine();
    pdfjs.GlobalWorkerOptions.workerSrc = origin + "/vendor/pdf.worker.min.mjs";
    loadingTask = pdfjs.getDocument({
      data: raw,
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: false,
      standardFontDataUrl: origin + "/vendor/standard_fonts/",
      cMapUrl: origin + "/vendor/cmaps/",
      cMapPacked: true,
      stopAtErrors: true,
    });
    pdf = await loadingTask.promise;
    if (pdf.numPages > DOCUMENT_LIMITS.pages)
      throw new Error("PDF exceeds 100 pages; split it first");
    if ((await pdf.getJSActions()) || (await pdf.getAttachments()))
      throw new Error(
        "Remove PDF scripts or embedded attachments before importing",
      );
    let content = "",
      ocrPages = 0;
    const confidence = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      progress({ page: n, total: pdf.numPages });
      const page = await pdf.getPage(n);
      const text = await page.getTextContent();
      let value = text.items
        .map((i) => i.str + (i.hasEOL ? "\n" : " "))
        .join("");
      if (value.replace(/\s/g, "").length < 30) {
        if (++ocrPages > DOCUMENT_LIMITS.ocrPages)
          throw new Error("Scanned PDF exceeds 30 OCR pages; split it first");
        const viewport = page.getViewport({ scale: 2.5 });
        const width = Math.ceil(viewport.width),
          height = Math.ceil(viewport.height);
        const pixels = width * height;
        if (!Number.isFinite(pixels) || pixels > DOCUMENT_LIMITS.pixels)
          throw new Error("PDF page exceeds the rendering pixel limit");
        const canvas = createCanvas(width, height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport })
          .promise;
        if (!ocr) {
          if (createOCR) ocr = await createOCR();
          else {
            const { createWorker } = await import("tesseract.js");
            ocr = await createWorker("eng", 1, {
              workerPath: origin + "/vendor/tesseract/worker.min.js",
              corePath: origin + "/vendor/tesseract/core",
              langPath: origin + "/vendor/tesseract/lang",
              workerBlobURL: false,
              gzip: true,
            });
          }
        }
        const image = canvas.convertToBlob
          ? new Uint8Array(
              await (
                await canvas.convertToBlob({ type: "image/png" })
              ).arrayBuffer(),
            )
          : canvas.toBuffer("image/png");
        const result = await ocr.recognize(image);
        value = result.data.text;
        confidence.push(result.data.confidence);
        canvas.width = canvas.height = 1;
      }
      content += value + "\n\n";
      if (content.length > DOCUMENT_LIMITS.characters)
        throw new Error(
          "Extracted text exceeds 200,000 characters; split the PDF",
        );
      page.cleanup();
    }
    return finishText(content, name, {
      format: "pdf",
      pages: pdf.numPages,
      ocr_pages: ocrPages,
      needs_review: ocrPages > 0,
      ocr_confidence: confidence.length
        ? Math.round(confidence.reduce((n, v) => n + v, 0) / confidence.length)
        : null,
      warnings: ocrPages
        ? ["Review OCR text before using it as company knowledge."]
        : [],
    });
  } finally {
    await Promise.allSettled([loadingTask?.destroy?.(), ocr?.terminate?.()]);
  }
}
