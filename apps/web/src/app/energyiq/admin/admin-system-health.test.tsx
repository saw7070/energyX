/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import { AdminSystemHealth } from "./admin-system-health";

describe("Admin System health", () => {
  it("leads with what is not working, groups the checks and says what to do", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("React", React);
    const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
    const client = { getSystemHealth: vi.fn().mockResolvedValue({ checkedAt: "2026-10-17T02:00:00Z", checks: [
      { id: "ai-model", group: "AI advisor", title: "AI model", status: "problem", detail: "No AI model is set up.", fix: "Open Admin → Models." },
      { id: "email", group: "Email", title: "Email delivery", status: "warning", detail: "Test mode.", fix: "Set SMTP." },
      { id: "p1:data", group: "Tuya Office", title: "Meter data", status: "ok", detail: "Newest reading 2 hours ago.", fix: "never shown when ok" },
    ] }) };
    try {
      await act(async () => { root.render(<AdminSystemHealth client={client} />); });
      expect(div.querySelector("h2")?.textContent).toBe("1 thing is not working");
      expect([...div.querySelectorAll("h3")].map(h => h.textContent)).toEqual(["AI advisor", "Email", "Tuya Office"]);
      expect(div.textContent).toContain("What to do: Open Admin → Models.");
      expect(div.textContent).not.toContain("never shown when ok");
      await act(async () => [...div.querySelectorAll("button")].find(b => b.textContent === "Check again")!.click());
      expect(client.getSystemHealth).toHaveBeenCalledTimes(2);
    } finally { act(() => root.unmount()); div.remove(); }
  });
});
