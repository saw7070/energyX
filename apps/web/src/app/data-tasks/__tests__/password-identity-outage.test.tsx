/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/energyiq/overview", useSearchParams: () => new URLSearchParams() }));

import { configApi } from "../../../lib/config-api";
import { DataTaskIdentityProvider } from "../data-task-identity";

const me = { user: { id: "u1", email: "u@x.test", displayName: "U" }, workspace: { id: "w1" } };

beforeEach(() => {
  vi.stubGlobal("React", React);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE", "password");
  router.replace.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const render = async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<DataTaskIdentityProvider><p>Dashboard</p></DataTaskIdentityProvider>));
  return { host, root };
};

it("sends a signed-out visitor to the sign-in page", async () => {
  vi.spyOn(configApi, "getMe").mockRejectedValue(new Error("Authentication required"));
  const { root } = await render();
  expect(router.replace).toHaveBeenCalledWith("/login");
  await act(async () => root.unmount());
});

it("keeps a signed-in person on the page and offers a retry when the server cannot be reached, then recovers", async () => {
  const getMe = vi.spyOn(configApi, "getMe").mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValue(me as never);
  const { host, root } = await render();
  expect(router.replace).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Can't reach the server");
  await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Try again")!.click());
  expect(getMe).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Dashboard");
  expect(router.replace).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
