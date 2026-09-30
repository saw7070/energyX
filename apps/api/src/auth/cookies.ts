import type { IncomingMessage, ServerResponse } from "node:http";

export const SESSION_COOKIE = "df_session";
export const CSRF_COOKIE = "df_csrf";

export function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [name, ...rest] = part.trim().split("=");
      return [name, decodeURIComponent(rest.join("="))];
    }).filter(([name]) => Boolean(name))
  );
}

export function appendAuthCookies(response: ServerResponse, input: {
  csrfToken: string;
  maxAgeSeconds: number;
  sessionToken: string;
}): void {
  appendSetCookie(response, serializeCookie(SESSION_COOKIE, input.sessionToken, {
    httpOnly: true,
    maxAgeSeconds: input.maxAgeSeconds
  }));
  appendSetCookie(response, serializeCookie(CSRF_COOKIE, input.csrfToken, {
    httpOnly: false,
    maxAgeSeconds: input.maxAgeSeconds
  }));
}

export function appendClearAuthCookies(response: ServerResponse): void {
  appendSetCookie(response, serializeCookie(SESSION_COOKIE, "", { httpOnly: true, maxAgeSeconds: 0 }));
  appendSetCookie(response, serializeCookie(CSRF_COOKIE, "", { httpOnly: false, maxAgeSeconds: 0 }));
}

function appendSetCookie(response: ServerResponse, cookie: string): void {
  const current = response.getHeader("Set-Cookie");
  const cookies = Array.isArray(current)
    ? [...current, cookie]
    : typeof current === "string"
      ? [current, cookie]
      : [cookie];
  response.setHeader("Set-Cookie", cookies);
}

function serializeCookie(name: string, value: string, input: { httpOnly: boolean; maxAgeSeconds: number }): string {
  const secure = process.env.NODE_ENV === "production";
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${input.maxAgeSeconds}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    ...(input.httpOnly ? ["HttpOnly"] : [])
  ].join("; ");
}
