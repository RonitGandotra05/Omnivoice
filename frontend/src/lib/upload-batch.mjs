export const UPLOAD_LIMITS = {
  documents: 100,
  characters: 5_000_000,
  fileBytes: 10 * 1024 * 1024,
};

export function retryDelay(header, now = Date.now()) {
  if (!header) return 0;
  const seconds = Number(header);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(header) - now) || 0;
}

export async function uploadBatch(
  files,
  upload,
  {
    concurrency = 2,
    onUpdate = () => {},
    signal,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const results = Array.from(files, (file, index) => ({
    index,
    name: file.name,
    status: "queued",
    file,
  }));
  let cursor = 0;
  const publish = (record, status, extra = {}) => {
    Object.assign(record, { status }, extra);
    onUpdate(results.map((item) => ({ ...item })));
  };
  async function worker() {
    while (cursor < results.length) {
      const record = results[cursor++];
      if (signal?.aborted) {
        publish(record, "cancelled");
        continue;
      }
      if (record.file.size > UPLOAD_LIMITS.fileBytes) {
        publish(record, "failed", { error: "Maximum file size is 10 MB." });
        continue;
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) {
          publish(record, "cancelled");
          break;
        }
        publish(record, attempt ? "retrying" : "processing", {
          attempt: attempt + 1,
        });
        try {
          const document = await upload(record.file, signal);
          publish(
            record,
            document.duplicate
              ? "duplicate"
              : document.status === "needs_review"
                ? "needs_review"
                : "ready",
            { document },
          );
          break;
        } catch (error) {
          if (signal?.aborted || error.name === "AbortError") {
            publish(record, "cancelled");
            break;
          }
          const transient =
            [429, 502, 503, 504].includes(error.status) ||
            error instanceof TypeError;
          const delay = Math.max(error.retryAfterMs || 0, 500 * 2 ** attempt);
          if (!transient || attempt === 2 || delay > 30_000) {
            publish(record, "failed", { error: error.message });
            break;
          }
          publish(record, "retrying", { error: "Temporarily busy. Retrying…" });
          await sleep(delay);
        }
      }
    }
  }
  onUpdate(results.map((item) => ({ ...item })));
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), results.length) },
      worker,
    ),
  );
  return results;
}
