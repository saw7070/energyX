/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLocalDevAdminAvailable } from "../../lib/config-api/client";
import { LoginClient } from "./login-client";

const navigation = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.searchParams,
}));

describe("local administrator login", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("React", React);
    process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE = "dev";
    window.history.replaceState({}, "", "/login");
    navigation.replace.mockReset();
    navigation.searchParams = new URLSearchParams();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container.remove();
    delete process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE;
    vi.unstubAllGlobals();
  });

  it("offers one local-only administrator button in dev auth mode", async () => {
    await act(async () => root?.render(<LoginClient />));
    await act(async () => undefined);

    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("Continue as Local Administrator"));
    expect(button).toBeDefined();

    await act(async () => button?.click());
    expect(navigation.replace).toHaveBeenCalledWith("/energyiq/admin");
  });

  it("fails closed outside loopback hosts or in password auth mode", () => {
    expect(isLocalDevAdminAvailable("127.0.0.1")).toBe(true);
    expect(isLocalDevAdminAvailable("localhost")).toBe(true);
    expect(isLocalDevAdminAvailable("energyiq.example.com")).toBe(false);
    process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE = "password";
    expect(isLocalDevAdminAvailable("127.0.0.1")).toBe(false);
  });
});
