/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale, type Translations } from "./energyiq-messages";
import { ProjectActions } from "./project-actions";
import { ReportActionPanel } from "./report-action-panel";
import { InsightReview } from "./insight-review";
import { EnergySelect } from "./energy-select";
import * as projectBooks from "./project-actions-messages";
import * as panelBooks from "./report-action-panel-messages";
vi.mock("./action-result-notices", () => ({ ActionResultNotices: () => null }));
vi.mock("./key-points", () => ({ ActionSiteQuestion: () => null }));

afterEach(() => { localStorage.clear(); document.documentElement.lang = "en"; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function renderIn(locale: EnergyIqLocale, node: ReactNode) {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const buttons = (host: HTMLElement) => [...host.querySelectorAll("button")].map(b => b.textContent);

const finding = { id: "f", title: "Persistent night load", summary: "Demand continues overnight.", actionIds: ["a"], sources: [{ reportId: "r", sourceQuote: "Demand continues overnight." }] };
const action = { id: "a", title: "Review the operating hours", recommendation: "Confirm the schedule", state: "paused", sourceReportId: "r", canPrioritise: true, sources: [], priority: { revision: 0, level: "medium", reason: "Check first" } };

describe("Action plan in other languages", () => {
  it("reads the action plan in Simplified Chinese, keeping the report's own words", async () => {
    vi.spyOn(configApi, "reportActionRequest").mockResolvedValue({ insights: [finding], actions: [action] } as never);
    const { host, unmount } = await renderIn("zh-Hans", <ProjectActions projectId="p" />);
    try {
      expect(host.querySelector("h1")?.textContent).toBe("行动计划");
      expect(host.textContent).toContain("需要关注的事项1 项发现");
      expect(host.textContent).toContain("待处理 / 重要性：中 / 紧急程度：常规");
      expect(host.textContent).toContain("中优先级");
      expect(host.textContent).toContain("已暂停");
      expect(host.textContent).toContain("查看依据 · 1 份报告");
      expect(host.querySelector('[aria-label="从发现到结果"]')).not.toBeNull();
      expect(buttons(host)).toEqual(expect.arrayContaining(["全部行动", "进行中的行动", "查看行动", "设置优先级"]));
      // Findings and actions come from the reports and stay as written.
      expect(host.textContent).toContain("Persistent night load");
      expect(host.textContent).toContain("Review the operating hours");
      await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "设置优先级")!.click());
      expect(buttons(host)).toEqual(expect.arrayContaining(["高", "中", "低", "保存优先级", "取消"]));
    } finally { await unmount(); }
  });

  it("reads an action's detail panel in Bahasa Melayu with local dates", async () => {
    vi.spyOn(configApi, "reportActionRequest").mockImplementation(async (_project, path) => {
      if (path?.includes("progress-drafts")) return { items: [] } as never;
      if (path?.includes("estimates")) return { items: [], canGenerate: false } as never;
      return {
        actions: [{ id: "a", title: "LED shutdown", recommendation: "Close at 19:00", state: "implemented", revision: 2, visibility: "project",
          events: [{ type: "implemented", effectiveAt: "2026-09-14T11:00:00.000Z", details: "Timer changed", recordedAt: "2026-09-14T12:00:00.000Z", actorName: "Alex" }] }],
        meters: [], baseline: { from: "2026-09-01", toExclusive: "2026-09-10", snapshotId: "s" }, timezone: "Asia/Singapore",
      } as never;
    });
    const { host, unmount } = await renderIn("ms", <ReportActionPanel projectId="p" reportId="r" actionId="a" />);
    try {
      expect(host.textContent).toContain("Dikongsi dengan pasukan projek");
      expect(host.textContent).toContain("Selesai");
      expect(host.querySelector("h2")?.textContent).toBe("Perubahan anda sedang dipantau");
      expect(buttons(host)).toEqual(expect.arrayContaining(["Rekodkan kemas kini", "Lihat penilaian AI", "Kemas kini saya", "Manfaat dijangka", "Hasil"]));
      expect(host.querySelector('[aria-label="Beritahu kami apa yang berubah"]')).not.toBeNull();
      expect(host.textContent).toContain("Sejarah kemajuan (1)");
      const effective = host.querySelector("time")!.closest("p")!;
      expect(effective.textContent).toMatch(/^Berkuat kuasa .*2026.* \(Asia\/Singapore\)$/);
      expect(host.querySelector("time")?.textContent).toBe(new Date("2026-09-14T11:00:00.000Z").toLocaleString("ms-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }));
      expect(host.textContent).toContain("Timer changed");
    } finally { await unmount(); }
  });

  it("translates finding assessment choices while saving the same values", async () => {
    const request = vi.spyOn(configApi, "reportActionRequest").mockResolvedValue({} as never);
    const review = { revision: 1, status: "monitoring", importance: "high", urgency: "soon", reason: "Awaiting comparable observations" };
    const { host, unmount } = await renderIn("zh-Hans", <InsightReview projectId="p" insight={{ id: "i", title: "Night load", review }} onSaved={() => undefined} />);
    try {
      expect(host.querySelector("h3")?.textContent).toBe("评估这项发现");
      expect(host.querySelector('[aria-label="发现的状态"]')?.textContent).toBe("监测中");
      expect(host.querySelector('[aria-label="发现的紧急程度"]')?.textContent).toBe("尽快");
      await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(request).toHaveBeenCalledWith("p", "insights/i/review", { method: "POST", body: JSON.stringify(review) });
    } finally { await unmount(); }
  });

  it("gives the shared select control a translated fallback prompt", async () => {
    const { host, unmount } = await renderIn("ms", <EnergySelect ariaLabel="Meter" value="" options={[{ value: "a", label: "Office lights" }]} onValueChange={() => undefined} />);
    try { expect(host.querySelector('[role="combobox"]')?.textContent).toBe("Pilih satu pilihan"); } finally { await unmount(); }
  });
});

describe("Action plan wording", () => {
  const books = Object.entries({ ...projectBooks, ...panelBooks }).filter((entry): entry is [string, Translations<string>] => typeof entry[1] === "object" && entry[1] !== null && "en" in entry[1]);
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

  it("fills the same blanks in every language", () => {
    expect(books.length).toBeGreaterThan(5);
    for (const [name, book] of books) for (const key of Object.keys(book.en)) for (const locale of ["zh-Hans", "ms"] as const) {
      expect(book[locale][key]?.trim(), `${name}.${key} (${locale})`).toBeTruthy();
      expect(placeholders(book[locale][key]!), `${name}.${key} (${locale})`).toEqual(placeholders(book.en[key]!));
    }
  });

  it("shows unknown API values as they are and splits sentences around an element", () => {
    const t = (key: string) => projectBooks.projectActionsMessages["zh-Hans"][key as never];
    expect(projectBooks.labelFor(t, projectBooks.projectActionsMessages, "state.paused", "paused")).toBe("已暂停");
    expect(projectBooks.labelFor(t, projectBooks.projectActionsMessages, "state.archived", "archived")).toBe("archived");
    expect(projectBooks.around("生效时间：{time}（Asia/Singapore）", "time")).toEqual(["生效时间：", "（Asia/Singapore）"]);
    expect(projectBooks.around("No placeholder", "time")).toEqual(["No placeholder", ""]);
  });
});
