/** Validate authentication headers before opening target metadata. Never log these values. */
export function replayTuyaAuthHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const cookie = env.ENERGYIQ_REPLAY_COOKIE;
  const authorization = env.ENERGYIQ_REPLAY_AUTHORIZATION;
  if (!cookie && !authorization) throw Error("REPLAY_API_AUTH_REQUIRED");
  const headers: Record<string, string> = authorization ? { Authorization: authorization } : {};
  if (cookie) {
    let csrf: string | undefined;
    try {
      for (const part of cookie.split(";")) {
        const [name, ...value] = part.trim().split("=");
        if (name === "df_csrf") csrf = decodeURIComponent(value.join("="));
      }
    } catch { throw Error("REPLAY_CSRF_COOKIE_INVALID"); }
    if (!csrf || /[\r\n]/.test(csrf)) throw Error("REPLAY_CSRF_COOKIE_REQUIRED");
    let origin: URL;
    try { origin = new URL(env.ENERGYIQ_REPLAY_ORIGIN ?? ""); }
    catch { throw Error("REPLAY_FRONTEND_ORIGIN_REQUIRED"); }
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw Error("REPLAY_FRONTEND_ORIGIN_INVALID");
    Object.assign(headers, { Cookie: cookie, "X-CSRF-Token": csrf, Origin: origin.origin });
  }
  return headers;
}
