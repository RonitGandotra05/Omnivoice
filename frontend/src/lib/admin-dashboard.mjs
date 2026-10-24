export async function adminRequest(path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl("/api/admin/" + path, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw Error(
      response.ok
        ? "The server returned an unreadable response. Your last confirmed data is still shown."
        : `The server could not complete this request (${response.status}). Refresh and try again.`,
    );
  }
  if (!response.ok)
    throw Error(
      body?.error || `Administration request failed (${response.status}).`,
    );
  if (!body || typeof body !== "object")
    throw Error(
      "The server returned an empty response. Refresh and try again.",
    );
  return body;
}
export function replaceConfirmedAccount(current, updated) {
  return current
    ? {
        ...current,
        accounts: current.accounts.map((account) =>
          account.id === updated.id ? updated : account,
        ),
      }
    : current;
}
export const actionLabel = {
  set_minutes: "Allowance changed",
  reset_minutes: "Minutes reset",
  suspend: "Account suspended",
  restore: "Account restored",
  revoke: "Sessions revoked",
};
export const securityLabel = {
  success: "Successful sign-ins",
  attempt: "Sign-in requests",
  failure: "Unsuccessful sign-ins",
  locked: "Blocked sign-ins",
};
