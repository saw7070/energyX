import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configApi } from "../client";
import { hasSessionCookie, isSignedInArea, leaveForSignIn, signInPath } from "../session-ended";

const fakeWindow = (path: string) => {
  const url = new URL(path, "https://energyiq.example.com");
  return { location: { pathname: url.pathname, search: url.search, replace: vi.fn<(href: string) => void>() } };
};

const notSignedIn = () => new Response(
  JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Authentication required." } }),
  { status: 401, headers: { "Content-Type": "application/json" } },
);

describe("session-ended helpers", () => {
  it("builds the sign-in address, returning only to EnergyX pages", () => {
    expect(signInPath({ pathname: "/energyiq/portfolio", search: "" }, { sessionEnded: true }))
      .toBe("/login?session=ended&returnTo=%2Fenergyiq%2Fportfolio");
    expect(signInPath({ pathname: "/energyiq/key-points", search: "?projectId=p1" }, { sessionEnded: false }))
      .toBe("/login?returnTo=%2Fenergyiq%2Fkey-points%3FprojectId%3Dp1");
    expect(signInPath({ pathname: "/data-tasks", search: "" }, { sessionEnded: true })).toBe("/login?session=ended");
    expect(signInPath({ pathname: "/", search: "" }, { sessionEnded: false })).toBe("/login");
  });

  it("knows which pages need a signed-in reader", () => {
    expect(isSignedInArea("/energyiq/portfolio")).toBe(true);
    expect(isSignedInArea("/data-tasks")).toBe(true);
    expect(isSignedInArea("/login")).toBe(false);
    expect(isSignedInArea("/legal/terms")).toBe(false);
    expect(isSignedInArea("/energyiqx")).toBe(false);
  });

  it("reads the sign-in cookie, ignoring an emptied one", () => {
    expect(hasSessionCookie("theme=dark; df_csrf=abc123")).toBe(true);
    expect(hasSessionCookie("df_csrf=")).toBe(false);
    expect(hasSessionCookie("theme=dark")).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
  });

  it("leaves a signed-in page once, however many requests fail", () => {
    const win = fakeWindow("/energyiq/portfolio");
    leaveForSignIn(win);
    leaveForSignIn(win);
    expect(win.location.replace).toHaveBeenCalledTimes(1);
    expect(win.location.replace).toHaveBeenCalledWith("/login?session=ended&returnTo=%2Fenergyiq%2Fportfolio");
  });

  it("stays put outside the signed-in pages", () => {
    const win = fakeWindow("/login");
    leaveForSignIn(win);
    expect(win.location.replace).not.toHaveBeenCalled();
  });
});

describe("config API requests when the session has ended", () => {
  let win: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE", "password");
    win = fakeWindow("/energyiq/portfolio");
    vi.stubGlobal("window", win);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the reader to sign in, and still rejects so the page stops loading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notSignedIn()));
    await expect(configApi.getEnergyPortfolio({ from: "2026-10-01", to: "2026-10-31" })).rejects.toMatchObject({ status: 401 });
    expect(win.location.replace).toHaveBeenCalledWith("/login?session=ended&returnTo=%2Fenergyiq%2Fportfolio");
  });

  it("does the same for downloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notSignedIn()));
    await expect(configApi.downloadEnergyPortfolio("pdf", { from: "2026-10-01", to: "2026-10-31" })).rejects.toMatchObject({ status: 401 });
    expect(win.location.replace).toHaveBeenCalledTimes(1);
  });

  it("leaves a wrong password, and the page-load account check, to the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Current password is invalid." } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )));
    await expect(configApi.changePassword({ currentPassword: "x", newPassword: "y" })).rejects.toBeTruthy();
    vi.stubGlobal("fetch", vi.fn(async () => notSignedIn()));
    await expect(configApi.getMe()).rejects.toBeTruthy();
    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it("treats a refused profile change as a session that ended", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notSignedIn()));
    await expect(configApi.updateMe({ displayName: "Ann" })).rejects.toBeTruthy();
    expect(win.location.replace).toHaveBeenCalledTimes(1);
  });

  it("ignores other refusals", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "ENERGYIQ_WORKSPACE_FORBIDDEN" } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    )));
    await expect(configApi.getEnergyPortfolio({ from: "2026-10-01", to: "2026-10-31" })).rejects.toBeTruthy();
    expect(win.location.replace).not.toHaveBeenCalled();
  });
});
