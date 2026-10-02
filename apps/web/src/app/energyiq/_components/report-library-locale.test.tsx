/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ admin: vi.fn(), library: vi.fn(), create: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams("projectId=p1"), usePathname: () => "/energyiq/library" }));
vi.mock("./energyiq-access", () => ({ useEnergyIqAccess: () => ({ access: { role: "admin", user: { id: "u1" }, activeWorkspaceId: "w1", projects: [{ id: "p1", workspaceId: "w1", status: "published" }] }, activeProject: { id: "p1", name: "Harbour Office" }, loading: false, error: null, selectProject: vi.fn() }) }));
vi.mock("../../../lib/config-api", () => ({ configApi: { reportAgentRequest: mock.admin, reportLibraryRequest: mock.library, createEnergyProject: mock.create } }));
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";
import { ReportLibraryView } from "./report-library";
import { ReportAgentPanel } from "./report-agent-panel";
import { CreateProjectDialog } from "./create-project-dialog";

const library = {
  reports: [{ id: "report-one-11111111", title: "Scheduled office report", version: 1, category: "scheduled", kind: "report", period: { from: "2026-09-01", toExclusive: "2026-09-08" }, createdAt: "2026-09-08T10:00:00Z" }],
  skills: [{ id: "method", revision: 7, scope: "general", category: "analysis", name: "Office method", version: "v3", content: "Analyze the baseline", projectId: "p1" }],
  tools: [], canChat: true, canManageProject: true,
};
const overview = {
  canChat: true, canManageProject: true,
  settings: { contextNotes: "", fileRefIds: [], useProjectData: true, skill: "", revision: 1, frequency: "off", localHour: 1, scheduledPrompt: "", timezone: "Asia/Singapore" },
  sessions: [], runs: [], files: [],
  periodOptions: { defaultPeriod: { from: "2026-08-16", toExclusive: "2026-09-13" }, availablePeriod: { from: "2026-01-01", toExclusive: "2026-09-13" } },
};
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mock.admin.mockReset(); mock.library.mockReset(); mock.create.mockReset();
  mock.library.mockImplementation(async (_id: string, path = "") => path.startsWith("output/") ? { content: "<html><body>Project report</body></html>" } : library);
  mock.admin.mockImplementation(async (_id: string, path = "") => path.includes("events") ? { events: [] } : overview);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); sessionStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals(); });
async function render(locale: EnergyIqLocale, node: ReactNode) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
}

describe("reports library and energy advisor in other languages", () => {
  it("shows the reports library in Chinese while report titles stay as written", async () => {
    await render("zh-Hans", <ReportLibraryView projectId="p1" view="reports" />);
    expect(container.querySelector("h1")?.textContent).toBe("报告");
    expect(container.textContent).toContain("Harbour Office · 已保存 1 份报告");
    expect(container.querySelector('input[type="search"]')?.getAttribute("placeholder")).toBe("按标题或日期搜索，例如 2026年9月…");
    const card = container.querySelector('[aria-label="打开“Scheduled office report”"]')!;
    expect(card.textContent).toContain("Scheduled office report");
    expect(card.textContent).toContain("自动生成");
    expect(card.textContent).toContain("2026年9月1日–7日");
    // The heading says these are creation dates, so a reader does not read them as the period covered.
    expect(container.querySelector('[aria-label="2026-09-08 生成的报告"] h2')?.textContent).toBe("生成于 2026年9月8日");
    expect(container.textContent).not.toContain("Automatically generated");
  });

  it("shows the Advisor guidelines page in Malay", async () => {
    await render("ms", <ReportLibraryView projectId="p1" view="skills" />);
    expect(container.querySelector("h1")?.textContent).toBe("Garis panduan penasihat");
    const skill = container.querySelector('[aria-label="Buka Office method"]')!;
    // The category, who can use it and the version are separate pills, so check each one.
    expect(Array.from(skill.querySelectorAll("span span")).map(pill => pill.textContent)).toEqual(expect.arrayContaining(["Analisis", "Terbina dalam", "v3"]));
    expect(container.textContent).toContain("1 disimpan");
    expect(container.textContent).toContain("Guna semula kaedah analisis");
  });

  it("shows the advisor chat chrome in Chinese but sends a starter prompt as written", async () => {
    await render("zh-Hans", <ReportAgentPanel projectId="p1" initialSessionId="new" />);
    expect(container.querySelector("h1")?.textContent).toBe("能源顾问");
    expect(container.textContent).toContain("您想了解什么？");
    expect(container.textContent).toContain("询问Harbour Office的用电情况");
    expect(container.textContent).toContain("可用读数：2026年1月1日 – 9月12日");
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="报告说明"]')!;
    expect(input.getAttribute("placeholder")).toBe("提出问题、请求报告，或描述您想探索的内容…");
    expect(container.querySelector('[aria-label="发送消息"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="了解用电情况"]')!.click());
    expect(input.value).toBe("Summarise energy consumption for the selected period.");
  });

  it("labels task progress in Malay", async () => {
    mock.admin.mockImplementation(async (_id: string, path = "") => path.includes("events") ? { events: [] } : { ...overview, sessions: [{ id: "s1", createdAt: "2026-09-11" }], runs: [{ id: "r1", sessionId: "s1", status: "failed", kind: "chat", prompt: "Kenapa penggunaan tinggi?", createdAt: "2026-09-11T00:00:00Z", period: { from: "2026-09-01", toExclusive: "2026-09-08" } }] });
    await render("ms", <ReportAgentPanel projectId="p1" initialSessionId="s1" />);
    expect(container.textContent).toContain("Kenapa penggunaan tinggi?");
    expect(container.querySelector('[aria-label="Status tugasan"]')?.textContent).toContain("Tugasan ini tidak selesai.");
    expect(container.textContent).toContain("Gagal");
    expect(container.textContent).toContain("Cuba semula tugasan");
  });

  it("asks for a new project name in Malay", async () => {
    await render("ms", <CreateProjectDialog workspaceName="School FM" onCreated={async () => {}} onClose={() => {}} />);
    expect(container.querySelector("dialog")?.getAttribute("aria-label")).toBe("Cipta projek");
    expect(container.textContent).toContain("Dicipta dalam School FM · waktu Singapura.");
    expect(container.querySelector("input")?.getAttribute("placeholder")).toBe("Contohnya, Harbour Office");
  });
});
