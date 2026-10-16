import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "public/vendor");
await mkdir(dest, { recursive: true });
const pdf = path.dirname(require.resolve("pdfjs-dist/package.json"));
await cp(
  path.join(pdf, "legacy/build/pdf.worker.min.mjs"),
  path.join(dest, "pdf.worker.min.mjs"),
);
for (const name of ["standard_fonts", "cmaps"])
  await cp(path.join(pdf, name), path.join(dest, name), { recursive: true });
const t = path.dirname(require.resolve("tesseract.js/package.json"));
const td = path.join(dest, "tesseract");
await mkdir(td, { recursive: true });
await cp(path.join(t, "dist/worker.min.js"), path.join(td, "worker.min.js"));
const core = path.dirname(require.resolve("tesseract.js-core/package.json"));
await cp(core, path.join(td, "core"), { recursive: true });
const lang = path.dirname(
  require.resolve("@tesseract.js-data/eng/package.json"),
);
await mkdir(path.join(td, "lang"), { recursive: true });
await cp(
  path.join(lang, "4.0.0_best_int/eng.traineddata.gz"),
  path.join(td, "lang/eng.traineddata.gz"),
);
console.log("Local PDF/OCR worker assets prepared.");

await cp(path.join(pdf, "LICENSE"), path.join(dest, "PDFJS-LICENSE.txt"));
await cp(path.join(t, "LICENSE.md"), path.join(td, "LICENSE.md"));
await cp(
  path.join(lang, "package.json"),
  path.join(td, "lang", "SOURCE-package.json"),
);
