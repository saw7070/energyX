import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Cross-origin access to the API. The web app reaches the API through its own same-origin proxy, so browsers never
 * need cross-origin access in production; other origins are allowed only when listed in API_ALLOWED_ORIGINS
 * (comma separated). Outside production, local development origins on any port are allowed so a web app pointed
 * straight at the API keeps working.
 */
export const allowedCorsOrigin = (
  origin: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null => {
  if (!origin) return null;
  const listed = (env.API_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim().replace(/\/+$/u, "")).filter(Boolean);
  if (listed.includes(origin.replace(/\/+$/u, ""))) return origin;
  if (env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/u.test(origin)) return origin;
  return null;
};

/** Headers every API response carries, plus the cross-origin ones for an allowed caller. */
export const applyApiSecurityHeaders = (
  request: IncomingMessage,
  response: ServerResponse,
  env: Record<string, string | undefined> = process.env,
): void => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  const origin = allowedCorsOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined, env);
  if (!origin) return;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Vary", "Origin");
};
