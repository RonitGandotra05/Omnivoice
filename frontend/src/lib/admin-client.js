export async function adminFetch(path, options = {}) {
  const token = localStorage.getItem("authToken");
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || ""}`,
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok)
    throw Error(
      body.error || body.message || "The request could not be completed.",
    );
  return body;
}
