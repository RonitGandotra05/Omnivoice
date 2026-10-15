/**
 * Safe client-side environment variables.
 * Only expose non-sensitive values to the browser.
 */
export const clientEnv = {
  BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000",
};
