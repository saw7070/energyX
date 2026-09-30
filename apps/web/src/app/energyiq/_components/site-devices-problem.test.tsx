/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/energyiq/project-configuration" }));
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { SiteDevices } from "./site-devices";

it("says which location has no meter instead of 'could not be loaded'", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  vi.spyOn(configApi, "executeEnergyScopeAnalysis").mockRejectedValue(new Error("ENERGYIQ_PUBLISHED_METER_ROUTE_REQUIRED:space-3:electricity"));
  vi.spyOn(configApi, "getEnergyProjectInformation").mockResolvedValue({ locations: [{ id: "space-3", name: "Space 3 - Boss Room" }] } as never);
  try {
    await act(async () => root.render(<EnergyIqLocaleProvider><SiteDevices projectId="office" boardNames={new Map()} /></EnergyIqLocaleProvider>));
    await act(async () => undefined);
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Space 3 - Boss Room has no meter yet");
    // What to do about it, in order, with a way back to the page that fixes it.
    expect(Array.from(alert.querySelectorAll("li")).length).toBe(3);
    expect(alert.textContent).toContain("Move meters here");
    expect(alert.querySelector("a")?.getAttribute("href")).toContain("tab=structure");
    expect(alert.textContent).toContain("Try again");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
