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
