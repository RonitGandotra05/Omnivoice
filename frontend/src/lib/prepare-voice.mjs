import { profileError } from "./workspace.mjs";

// Prepare saved, reviewed knowledge without requiring a separate publishing visit.
export async function prepareVoiceWorkspace({
  request,
  profile,
  documents,
  tickets,
  mode,
  signal,
  onSaved,
}) {
  const validation = profileError(profile);
  if (validation) throw new Error(validation);
  signal?.throwIfAborted();
  const options = {
    method: "PUT",
    signal,
    headers: { "Content-Type": "application/json" },
  };
  if (mode === "postgres")
    await request("profile", { ...options, body: JSON.stringify(profile) });
  else
    await request("workspace/save", {
      ...options,
      body: JSON.stringify({ profile, documents, tickets }),
    });
  onSaved?.();
  let job = await request("voice/publish", { signal });
  if (job.status === "complete" && !job.result?.needs_publish) return job;
  if (!["running", "queued"].includes(job.status))
    job = await request("voice/publish", { method: "POST", signal });
  const deadline = Date.now() + 150000;
  while (["running", "queued"].includes(job.status)) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline)
      throw new Error(
        "Your agent is still preparing. Try again shortly; completed work is saved.",
      );
    await new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, 1500);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    job = await request("voice/publish", { signal });
  }
  if (job.status !== "complete" || job.result?.needs_publish)
    throw new Error(
      job.error ||
        "Your workspace changed or could not be prepared. Review your documents and try again.",
    );
  return job;
}
