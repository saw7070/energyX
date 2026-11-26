/**
 * When a signed-in page learns its session has ended (unused past the idle limit, signed out on another device, or
 * the account disabled), the reader goes straight to the sign-in page, which says the session ended, and comes back to
 * the same page once signed in. Before this, every panel on the page showed its own "Your session has ended" error and
 * the reader had to find the sign-in page themselves.
 */

/** The sign-in page shows "Your session has ended" when it is opened with `?session=ended`. */
export const SESSION_ENDED_QUERY = { name: "session", value: "ended" } as const;

/** Pages that need a signed-in reader. Anywhere else (the sign-in page itself, the legal pages) a 401 is left alone. */
const SIGNED_IN_AREAS = ["/energyiq", "/data-tasks"];

export function isSignedInArea(pathname: string): boolean {
  return SIGNED_IN_AREAS.some((area) => pathname === area || pathname.startsWith(`${area}/`));
}

/** The sign-in page address for someone leaving `location`. Only EnergyX pages are returned to (see login-client.tsx). */
export function signInPath(location: { pathname: string; search: string }, options: { sessionEnded: boolean }): string {
  const params = new URLSearchParams();
  if (options.sessionEnded) params.set(SESSION_ENDED_QUERY.name, SESSION_ENDED_QUERY.value);
  if (location.pathname.startsWith("/energyiq/")) params.set("returnTo", `${location.pathname}${location.search}`);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

/**
 * True when this browser still holds the cookie a sign-in leaves behind. Signing out clears it, so finding it on a
 * page that is no longer signed in means the session ended rather than the visitor never having signed in.
 */
export function hasSessionCookie(cookie: string = typeof document === "undefined" ? "" : document.cookie): boolean {
  return cookie.split(";").some((part) => {
    const trimmed = part.trim();
    return trimmed.startsWith("df_csrf=") && trimmed.length > "df_csrf=".length;
  });
}

type SignInWindow = { location: { pathname: string; search: string; replace: (url: string) => void } };

// A page usually has several requests in flight when the session ends; only the first one leaves.
const leavingWindows = new WeakSet<object>();

/** Leaves a signed-in page for the sign-in page, saying the session ended. Does nothing outside the signed-in pages. */
export function leaveForSignIn(win: SignInWindow | undefined = typeof window === "undefined" ? undefined : window): void {
  if (!win || leavingWindows.has(win) || !isSignedInArea(win.location.pathname)) return;
  leavingWindows.add(win);
  win.location.replace(signInPath(win.location, { sessionEnded: true }));
}
