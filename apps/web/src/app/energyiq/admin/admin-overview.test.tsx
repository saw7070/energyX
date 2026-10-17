/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import { AdminOverview } from "./admin-overview";

describe("Admin overview", () => {
  it("shows real problems first and sends each Fix to where it is fixed", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("React", React);
    const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
    const client = { getSystemHealth: vi.fn().mockResolvedValue({ checkedAt: "2026-10-17T02:00:00Z", checks: [
      { id: "email", group: "Email", title: "Email delivery", status: "warning", detail: "Test mode." },
      { id: "ai-model", group: "AI advisor", title: "AI model", status: "problem", detail: "No AI model is set up." },
      { id: "advisor-worker", group: "AI advisor", title: "Advisor worker", status: "ok", detail: "Installed." },
      { id: "p1:data", group: "Tuya Office", title: "Meter data", status: "problem", detail: "Newest reading 18 days ago.", projectId: "p1", organisation: "Harbour", lastReadingAt: "2026-09-29T17:45:00Z" },
    ] }) };
    const setSection = vi.fn(); const chooseAdminProject = vi.fn();
    const projects = [{ id: "p1", workspaceId: "w1", name: "Tuya Office", status: "published" as const, timezone: "Asia/Singapore" }];
    try {
      await act(async () => { root.render(<AdminOverview projects={projects} chooseAdminProject={chooseAdminProject} setSection={setSection} client={client} />); });
      const items = [...div.querySelectorAll("li[data-status]")].map(li => li.querySelector("strong")?.textContent);
      expect(items).toEqual(["AI model", "Tuya Office · Meter data", "Email delivery"]);
      expect(div.textContent).toContain("Not ready");
      expect(div.querySelector("tbody")?.textContent).toContain("Harbour");
      const fix = (index: number) => [...div.querySelectorAll("li[data-status] button")][index] as HTMLButtonElement;
      await act(async () => fix(0).click());
      expect(setSection).toHaveBeenLastCalledWith("models");
      await act(async () => fix(1).click());
      expect(chooseAdminProject).toHaveBeenCalledWith("p1");
      expect(setSection).toHaveBeenLastCalledWith("data-sources");
    } finally { act(() => root.unmount()); div.remove(); }
  });
});
