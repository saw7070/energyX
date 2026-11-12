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
import { ReportScheduleNote } from "./report-schedule-note";

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

describe("automatic reports: daily reports", () => {
  it("offers daily reports alongside weekly and monthly ones, and saves the choice", async () => {
    await render(<ReportAgentPanel projectId="p1" settingsMode="automation" />);
    expect(container.textContent).toContain("The daily, weekly and monthly site reports are written straight from the meter readings. A daily report covers the day before.");
    const select = container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Report frequency"]')!;
    await act(async () => select.click());
    const options = [...document.querySelectorAll<HTMLButtonElement>("[role='option']")];
    expect(options.map(item => item.textContent)).toEqual(expect.arrayContaining(["Daily", "Weekly", "Monthly", "Weekly + monthly", "Daily + weekly + monthly"]));
    await act(async () => options.find(item => item.textContent === "Daily + weekly + monthly")!.click());
    await act(async () => button("Save schedule")!.click());
    const put = mock.admin.mock.calls.find(item => item[1] === "settings" && item[2]?.method === "PUT")!;
    expect(JSON.parse(put[2].body)).toMatchObject({ frequency: "daily-weekly-monthly", localHour: 3 });
  });

  it("names the choice in Chinese and Malay", async () => {
    await render(<ReportAgentPanel projectId="p1" settingsMode="automation" />, "zh-Hans");
    await act(async () => container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="报告频率"]')!.click());
    expect([...document.querySelectorAll("[role='option']")].map(item => item.textContent)).toContain("每天 + 每周 + 每月");
    expect(container.textContent).toContain("每天的报告涵盖前一天");
    await act(async () => root.unmount());
    document.querySelectorAll("[role='listbox']").forEach(element => element.remove());
    root = createRoot(container);
    await render(<ReportAgentPanel projectId="p1" settingsMode="automation" />, "ms");
    await act(async () => container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Kekerapan laporan"]')!.click());
    expect([...document.querySelectorAll("[role='option']")].map(item => item.textContent)).toContain("Harian + mingguan + bulanan");
    expect(container.textContent).toContain("Laporan harian merangkumi hari sebelumnya.");
  });

  it("lists a daily report as a site report, never as the one on the Overview", async () => {
    mock.library.mockImplementation(async (_id: string, path = "") => path.startsWith("output/") ? { content: "<html><body>Report</body></html>" } : { ...library, reports: [
      { id: "daily-44444444", title: "Daily Site Report — 17 August 2026", version: 1, category: "scheduled", kind: "report", source: "site", cadence: "daily", period: { from: "2026-08-17", toExclusive: "2026-08-18" }, createdAt: "2026-08-18T02:00:00Z" },
      ...library.reports,
    ] });
    await render(<ReportLibraryView projectId="p1" view="reports" />);
    const daily = container.querySelector('[aria-label="Open Daily Site Report — 17 August 2026"]')!;
    expect(daily.textContent).toContain("Site report");
    expect(daily.textContent).toContain("1 day");
    expect(daily.textContent).not.toContain("Shown on your Overview");
    // The weekly review is still the one on the Overview.
    expect(container.querySelector('[aria-label="Open Weekly Management Review — 10 August 2026 to 16 August 2026"]')!.textContent).toContain("Shown on your Overview");
  });

  it("says when the next report comes, in every language", async () => {
    const schedule = { frequency: "daily-weekly-monthly", localHour: 6, timezone: "Asia/Singapore" };
    const expected = { en: "A new report is created automatically every day, with weekly and monthly ones too, around 06:00.",
      "zh-Hans": "每天约 06:00 会自动生成一份新报告，另有每周和每月的报告。", ms: "Laporan baharu dijana secara automatik setiap hari, berserta laporan mingguan dan bulanan, sekitar 06:00." };
    for (const locale of ["en", "zh-Hans", "ms"] as const) {
      // The language is read when the page opens, so each language gets a fresh page.
      await act(async () => root.unmount());
      root = createRoot(container);
      await render(<ReportScheduleNote projectId="p1" schedule={schedule} />, locale);
      expect(container.textContent).toContain(expected[locale]);
    }
  });
});

describe("automatic reports: the note on the Overview", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-23T08:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  const note = (frequency: string, overview: boolean) => <ReportScheduleNote projectId="p1" schedule={{ frequency, localHour: 6, timezone: "Asia/Singapore" }} overview={overview} />;

  it("counts down to the weekly or monthly report the Overview shows, and says daily ones are kept in Reports", async () => {
    // Wednesday 23 September 2026, 16:00 in Singapore. Tomorrow's daily report goes to Reports; Monday's weekly one is next here.
    await render(note("daily-weekly-monthly", true));
    expect(container.textContent).toBe("A new report is created automatically every week and every month, around 06:00. A daily report is kept in Reports too. Next one: 28 Sep 2026, around 06:00.");
    await act(async () => root.render(<EnergyIqLocaleProvider>{note("daily", true)}</EnergyIqLocaleProvider>));
    expect(container.textContent).toBe("A daily report is created automatically around 06:00 and kept in Reports.");
    // Weekly and monthly alone read as before, and Reports itself still counts down to tomorrow's daily report.
    await act(async () => root.render(<EnergyIqLocaleProvider>{note("weekly-monthly", true)}</EnergyIqLocaleProvider>));
    expect(container.textContent).toBe("A new report is created automatically every week and every month, around 06:00. Next one: 28 Sep 2026, around 06:00.");
    await act(async () => root.render(<EnergyIqLocaleProvider>{note("daily-weekly-monthly", false)}</EnergyIqLocaleProvider>));
    expect(container.textContent).toContain("Next one: 24 Sep 2026, around 06:00.");
  });

  it("says so in Chinese and Malay", async () => {
    const expected = { "zh-Hans": ["每天的报告也会保存在“报告”中。", "每天约 06:00 会自动生成一份报告，保存在“报告”中。"],
      ms: ["Laporan harian juga disimpan di Laporan.", "Laporan harian dijana secara automatik sekitar 06:00 dan disimpan di Laporan."] };
    for (const locale of ["zh-Hans", "ms"] as const) {
      await act(async () => root.unmount());
      root = createRoot(container);
      await render(note("daily-weekly-monthly", true), locale);
      expect(container.textContent).toContain(expected[locale][0]);
      await act(async () => root.render(<EnergyIqLocaleProvider>{note("daily", true)}</EnergyIqLocaleProvider>));
      expect(container.textContent).toContain(expected[locale][1]);
    }
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
