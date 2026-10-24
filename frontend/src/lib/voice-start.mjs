// Lifecycle scenarios informed by TEN's Apache-2.0 agent integration tests.
// Our implementation guards the app's HTTP preflight; the voice SDK owns media.
export function createVoiceStartGuard() {
  let active = null;
  return {
    begin() {
      if (active) return null;
      const attempt = { controller: new AbortController() };
      active = attempt;
      return attempt;
    },
    current(attempt) {
      return active === attempt && !attempt.controller.signal.aborted;
    },
    finish(attempt) {
      if (active === attempt) active = null;
    },
    cancel() {
      active?.controller.abort();
      active = null;
    },
  };
}

// Works with SDKs whose startSession returns void: readiness is event-driven.
export function waitForVoiceConnection(signal, timeoutMs = 45000) {
  let resolve, reject;
  let settled = false;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (error) reject(error);
    else resolve();
  };
  const abort = () =>
    finish(
      signal.reason || new DOMException("Connection cancelled", "AbortError"),
    );
  const timer = setTimeout(
    () => finish(new DOMException("Connection timed out", "TimeoutError")),
    timeoutMs,
  );
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return {
    promise,
    connected: () => finish(),
    failed: (error) =>
      finish(
        error instanceof Error
          ? error
          : new Error("The voice connection ended before it was ready."),
      ),
  };
}

export const canStartVoice = (status) =>
  status === "disconnected" || status === "error";
