/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ admin: vi.fn(), library: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mock.replace, push: mock.push }), useSearchParams: () => new URLSearchParams("projectId=p1"), usePathname: () => "/energyiq/library" }));
vi.mock("./energyiq-access", () => ({ useEnergyIqAccess: () => ({ access: { role: "admin", user: { id: "u1" }, activeWorkspaceId: "w1", projects: [{ id: "p1", workspaceId: "w1", status: "published", capabilities: { manageAutomation: true } }] }, activeProject: { id: "p1", name: "Harbour Estate" }, loading: false, error: null, selectProject: vi.fn() }) }));
vi.mock("../../../lib/config-api", () => ({ configApi: { reportAgentRequest: mock.admin, reportLibraryRequest: mock.library } }));
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";
import { ReportLibraryView } from "./report-library";
import { ReportAgentPanel } from "./report-agent-panel";

const library = {
  reports: [
    { id: "review-11111111", title: "Weekly Management Review — 10 August 2026 to 16 August 2026", version: 1, category: "scheduled", kind: "report", source: "site", cadence: "weekly", style: "management", period: { from: "2026-08-10", toExclusive: "2026-08-17" }, createdAt: "2026-08-17T02:00:00Z" },
    { id: "custom-22222222", title: "Custom Site Report — 1 August 2026 to 7 August 2026", version: 1, category: "custom", kind: "report", source: "site", period: { from: "2026-08-01", toExclusive: "2026-08-08" }, createdAt: "2026-08-17T03:00:00Z" },
  ],
  skills: [], tools: [], canChat: true, canManageProject: false, overviewCadence: "weekly",
};
const settings = { contextNotes: "", fileRefIds: [], useProjectData: true, skill: "Method", revision: 1, frequency: "weekly", localHour: 3, scheduledPrompt: "", timezone: "Asia/Singapore" };
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const fn of [mock.admin, mock.library, mock.replace, mock.push]) fn.mockReset();
  mock.library.mockImplementation(async (_id: string, path = "") => path.startsWith("output/") ? { content: "<html><body>Report</body></html>" } : library);
  mock.admin.mockImplementation(async (_id: string, path = "", init?: RequestInit) => path === "site-reports" ? { id: "new-report-33333333" }
    : path === "settings" ? { ...JSON.parse(String(init?.body)), revision: 2 } : path.includes("events") ? { events: [] }
    : { canChat: true, canManageProject: true, settings, sessions: [], runs: [], files: [] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); document.querySelectorAll("[role='listbox']").forEach(element => element.remove()); vi.unstubAllGlobals(); });
async function render(node: ReactNode, locale: EnergyIqLocale = "en") {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
}
const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === text);
const setValue = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("create a report", () => {
  it("writes a site report on the chosen dates in the chosen style, then opens it", async () => {
    await render(<ReportLibraryView projectId="p1" view="reports" />);
    await act(async () => button("Create a report")!.click());
    const dialog = container.querySelector('dialog[aria-label="Create a report"]')!;
    expect(dialog.textContent).toContain("From your meter readings");
    const radios = [...dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    // Today's full report stays the default.
    expect(radios.map(radio => [radio.value, radio.checked])).toEqual([["full", true], ["management", false]]);
    const [from, to] = [...dialog.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    await setValue(from!, "2026-08-10");
    await setValue(to!, "2026-08-16");
    await act(async () => radios[1]!.click());
    await act(async () => button("Create report")!.click());
    const call = mock.admin.mock.calls.find(item => item[1] === "site-reports")!;
    expect(call[2].method).toBe("POST");
    expect(JSON.parse(call[2].body)).toEqual({ period: { from: "2026-08-10", toExclusive: "2026-08-17" }, style: "management" });
    expect(mock.replace).toHaveBeenCalledWith("/energyiq/library?projectId=p1&reportId=new-report-33333333", { scroll: false });
    expect(container.querySelector('dialog[aria-label="Create a report"]')).toBeNull();
  });

  it("refuses an end date before the start date without asking the server", async () => {
    await render(<ReportLibraryView projectId="p1" view="reports" />);
    await act(async () => button("Create a report")!.click());
    const [from, to] = [...container.querySelectorAll<HTMLInputElement>('dialog input[type="date"]')];
    await setValue(from!, "2026-08-16");
    await setValue(to!, "2026-08-10");
    await act(async () => button("Create report")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Choose an end date on or after the start date.");
    expect(mock.admin.mock.calls.some(item => item[1] === "site-reports")).toBe(false);
  });

  it("still offers the energy advisor for questions", async () => {
    await render(<ReportLibraryView projectId="p1" view="reports" />);
    await act(async () => button("Create a report")!.click());
    await act(async () => button("Open the energy advisor")!.click());
    expect(mock.push).toHaveBeenCalledWith("/energyiq/reports?projectId=p1&sessionId=new");
  });

  it("marks management reviews in the list, and never puts a custom report on the Overview", async () => {
    await render(<ReportLibraryView projectId="p1" view="reports" />);
    const review = container.querySelector('[aria-label="Open Weekly Management Review — 10 August 2026 to 16 August 2026"]')!;
    expect(review.textContent).toContain("Management review");
    expect(review.textContent).toContain("Shown on your Overview");
    const custom = container.querySelector('[aria-label="Open Custom Site Report — 1 August 2026 to 7 August 2026"]')!;
    expect(custom.textContent).toContain("Site report");
    expect(custom.textContent).not.toContain("Shown on your Overview");
    expect(custom.textContent).not.toContain("Management review");
  });

  it("speaks Chinese and Malay", async () => {
    await render(<ReportLibraryView projectId="p1" view="reports" />, "zh-Hans");
    await act(async () => button("创建报告")!.click());
    const dialog = container.querySelector('dialog[aria-label="创建报告"]')!;
    expect(dialog.textContent).toContain("根据电表读数");
    expect(dialog.textContent).toContain("管理层回顾");
    expect(dialog.textContent).not.toMatch(/Management review|Full report/);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(<ReportLibraryView projectId="p1" view="reports" />, "ms");
    await act(async () => button("Cipta laporan")!.click());
    expect(container.querySelector('dialog[aria-label="Cipta laporan"]')!.textContent).toContain("Semakan pengurusan");
  });
});

describe("automatic reports: site report style", () => {
  it("defaults to the full report and saves the management review when chosen", async () => {
    await render(<ReportAgentPanel projectId="p1" settingsMode="automation" />);
    const select = container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Site report style"]')!;
    expect(select.textContent).toContain("Full report");
    await act(async () => select.click());
    const option = [...document.querySelectorAll<HTMLButtonElement>("[role='option']")].find(item => item.textContent?.includes("Management review"))!;
    await act(async () => option.click());
    await act(async () => button("Save schedule")!.click());
    const put = mock.admin.mock.calls.find(item => item[1] === "settings" && item[2]?.method === "PUT")!;
    expect(JSON.parse(put[2].body)).toMatchObject({ siteReportStyle: "management", frequency: "weekly" });
  });
});
