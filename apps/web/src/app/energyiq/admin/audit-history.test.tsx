/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";
import { AuditHistory } from "./audit-history";

beforeEach(() => { vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

it("shows who did what in plain words, marks failed sign-ins, and pages through older entries", async () => {
  const list = vi.spyOn(configApi, "listEnergyAuditEvents")
    .mockResolvedValueOnce({
      events: [
        { id: "1", at: "2026-10-09T03:00:00.000Z", type: "energyiq.electricity_rate_published", email: "admin@example.test", project: "KL office", organisation: "Elite IOT", ip: "203.0.113.9", details: {} },
        { id: "2", at: "2026-10-09T02:00:00.000Z", type: "auth.login_failed", email: "someone@example.test", details: {} },
      ],
      next: "cursor-1",
    })
    .mockResolvedValueOnce({ events: [{ id: "3", at: "2026-10-01T02:00:00.000Z", type: "energyiq.user_updated", email: "admin@example.test", target: "viewer@example.test", details: {} }] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AuditHistory />));
  expect(host.textContent).toContain("Changed the electricity rate");
  expect(host.textContent).toContain("Elite IOT · KL office");
  expect(Array.from(host.querySelectorAll("span")).find(span => span.textContent === "Failed sign-in attempt")!.className).toContain("text-rose-700");
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String), limit: 100 }));

  await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Show more")!.click());
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ before: "cursor-1" }));
  expect(host.textContent).toContain("viewer@example.test");
  expect(host.textContent).toContain("Showing 3 entries");
  await act(async () => root.unmount());
});
