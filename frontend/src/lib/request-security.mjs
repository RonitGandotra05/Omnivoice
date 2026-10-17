export function sameOrigin(request, env = process.env) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const supplied = request.headers.get("origin");
  if (!supplied) return true; // Server-to-server callers still require authentication.
  try {
    return (
      new URL(supplied).origin ===
      new URL(env.PUBLIC_APP_URL || request.url).origin
    );
  } catch {
    return false;
  }
}

export async function boundedBody(request, maximum = 24 * 1024 * 1024) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > maximum)
    throw new Error("Request too large");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
