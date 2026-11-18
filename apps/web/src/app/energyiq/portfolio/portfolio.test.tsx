/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnergyPortfolioDto, EnergyPortfolioSiteDto, EnergyReportSchedulesDto } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "../_components/energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "../_components/energyiq-messages";
import { presetPeriod } from "./portfolio-client";
import { PortfolioView, type PortfolioSiteAverage } from "./portfolio-view";
import { ReportSchedulesView } from "./report-schedules";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

beforeEach(() => { vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; localStorage.clear(); });

const render = async (node: React.ReactNode) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
};

const grid = { basis: "grid" as const, grid: "SG" as const, kgCo2ePerKwh: 0.402, year: 2024, source: "Energy Market Authority, Singapore Energy Statistics" };
const site = (overrides: Partial<EnergyPortfolioSiteDto>): EnergyPortfolioSiteDto => ({
  projectId: "p", name: "Site", timezone: "Asia/Singapore", status: "ok", usageKwh: 1000, averageDailyKwh: 33, peakKw: 12, previousUsageKwh: 900,
  changePct: 11.1, carbonKg: 402, carbonFactor: grid, coveragePct: 100, dataStatus: "complete", ...overrides,
});
const portfolio: EnergyPortfolioDto = {
  workspaceId: "w", workspaceName: "Acme", period: { from: "2026-09-01", to: "2026-09-30" }, generatedAt: "2026-10-01T00:00:00Z",
  sites: [
    site({ projectId: "a", name: "Raffles HQ", usageKwh: 5000, averageDailyKwh: 166.67, readingDays: 30, dailyKwh: Array.from({ length: 30 }, (_, day) => 160 + day),
      cost: { amount: 1500, currency: "SGD" }, afterHoursSharePct: 31, carbonKg: 2010,
      budget: { month: "2026-09", daysInMonth: 30, actualKwh: 5000, forecastKwh: 5000, actualCost: 1500, forecastCost: 1500, currency: "SGD", budgetAmount: 1200, status: "over" } }),
    // Connected on 10 September: 21 days of readings in the 30-day period.
    site({ projectId: "b", name: "KL Office", country: "MY", usageKwh: 8000, averageDailyKwh: 380.95, readingDays: 21, dailyKwh: [...Array(9).fill(null), ...Array(21).fill(380.95)], changePct: -5, cost: { amount: 2600, currency: "MYR" }, carbonKg: 5920, coveragePct: 88.5, dataStatus: "partial",
      carbonFactor: { basis: "grid", grid: "MY-PENINSULAR", kgCo2ePerKwh: 0.74, year: 2024, source: "Energy Commission Malaysia", provisional: true } }),
    site({ projectId: "c", name: "Tuas Depot", status: "unavailable", usageKwh: 0, previousUsageKwh: 0, changePct: null, carbonKg: 0, coveragePct: 0, dataStatus: "unavailable" }),
  ],
  totals: { usageKwh: 13000, previousUsageKwh: 12000, averageDailyKwh: 547.62, carbonKg: 7930, costByCurrency: { SGD: 1500, MYR: 2600 }, sitesWithData: 2, sitesOverBudget: 1, sitesAtRisk: 0 },
};

describe("Portfolio view", () => {
  it("adds up every site without mixing currencies and compares them side by side", async () => {
    const { host, root } = await render(<PortfolioView portfolio={portfolio} />);
    expect(host.textContent).toContain("13,000 kWh");
    expect(host.textContent).toContain("+8% on the previous period");
    expect(host.textContent).toContain("S$1,500.00 + RM2,600.00");
    expect(host.textContent).toContain("7.9 tCO2e");
    expect(host.textContent).toContain("1 over · 0 heading over");
    const names = () => Array.from(host.querySelectorAll("tbody th a")).map(cell => cell.textContent);
    expect(names()).toEqual(["KL Office", "Raffles HQ", "Tuas Depot"]);
    expect(host.textContent).toContain("No readings for this period");
    expect(host.textContent).toContain("89% of readings");
    expect(host.querySelector('a[href="/energyiq/key-points?projectId=a"]')).not.toBeNull();
    expect(host.textContent).toContain("0.74 kg CO2e/kWh · Energy Commission Malaysia · 2024 (provisional) — KL Office");

    // Sorting by name puts them in order; sites without figures stay last.
    await act(async () => (host.querySelector('button[aria-label="Sort by Site"]') as HTMLButtonElement).click());
    expect(names()).toEqual(["KL Office", "Raffles HQ", "Tuas Depot"]);
    await act(async () => (host.querySelector('button[aria-label="Sort by Carbon (t)"]') as HTMLButtonElement).click());
    expect(names()).toEqual(["KL Office", "Raffles HQ", "Tuas Depot"]);
    await act(async () => (host.querySelector('button[aria-label="Sort by Carbon (t)"]') as HTMLButtonElement).click());
    expect(names()).toEqual(["Raffles HQ", "KL Office", "Tuas Depot"]);
    await act(async () => root.unmount());
  });

  it("shows each site's average day, a daily trend line with words for it, and the whole portfolio's average day", async () => {
    const { host, root } = await render(<PortfolioView portfolio={portfolio} />);
    const tile = Array.from(host.querySelectorAll("strong")).find(value => value.parentElement?.textContent?.includes("Average a day"))!;
    expect(tile.textContent).toBe("548 kWh");
    expect(host.textContent).toContain("All sites together on an average day");
    const row = (name: string) => Array.from(host.querySelectorAll("tbody tr")).find(item => item.querySelector("th")?.textContent?.includes(name))!;
    const headers = Array.from(host.querySelectorAll("thead th")).map(cell => cell.textContent);
    // The trend column says it is one point a day, over which days, and what the dashed line is.
    expect(headers.slice(0, 4)).toEqual(["Site", "Energy (kWh) ↓", "Average a day (kWh)", "Daily trendeach day, 1–30 Sepdashed line = average day"]);
    // KL Office started part-way through, so its average is over its 21 days of readings and says so.
    expect(row("KL Office").querySelectorAll("td")[1]!.textContent).toBe("381over 21 days of readings");
    expect(row("Raffles HQ").querySelectorAll("td")[1]!.textContent).toBe("167");
    const spark = row("Raffles HQ").querySelector<HTMLElement>('[role="group"]')!;
    expect(spark.getAttribute("aria-label")).toBe("Daily use from 1 Sep to 30 Sep: lowest 160.0 kWh on 1 Sep, highest 189.0 kWh on 30 Sep.");
    expect(spark.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(row("KL Office").querySelectorAll("polyline")).toHaveLength(1);
    // Under the line, in words: the latest day and how it compares with the site's average day.
    expect(row("Raffles HQ").querySelectorAll("td")[2]!.lastElementChild?.textContent).toBe("Latest day 189.0 kWh13% above average");
    expect(row("Tuas Depot").textContent).toContain("No readings for this period");

    await act(async () => (host.querySelector('button[aria-label="Sort by Average a day (kWh)"]') as HTMLButtonElement).click());
    expect(Array.from(host.querySelectorAll("tbody th a")).map(cell => cell.textContent)).toEqual(["KL Office", "Raffles HQ", "Tuas Depot"]);
    await act(async () => (host.querySelector('button[aria-label="Sort by Average a day (kWh)"]') as HTMLButtonElement).click());
    expect(Array.from(host.querySelectorAll("tbody th a")).map(cell => cell.textContent)).toEqual(["Raffles HQ", "KL Office", "Tuas Depot"]);
    await act(async () => root.unmount());
  });

  it("reads out one day's date and kWh on hover, tap or the arrow keys", async () => {
    const { host, root } = await render(<PortfolioView portfolio={portfolio} />);
    const row = (name: string) => Array.from(host.querySelectorAll("tbody tr")).find(item => item.querySelector("th")?.textContent?.includes(name))!;
    const spark = row("Raffles HQ").querySelector<HTMLElement>('[role="group"]')!;
    spark.getBoundingClientRect = () => ({ left: 100, right: 204, top: 0, bottom: 28, width: 104, height: 28, x: 100, y: 0, toJSON() {} }) as DOMRect;
    const tip = () => spark.querySelector<HTMLElement>('[aria-hidden="true"]:not(svg)')?.textContent ?? null;
    const pointer = (type: string, clientX: number, pointerType = "mouse") => {
      const event = new MouseEvent(type, { bubbles: true, clientX });
      Object.defineProperty(event, "pointerType", { value: pointerType });
      spark.dispatchEvent(event);
    };
    expect(tip()).toBeNull();
    // The left end is 1 September (160 kWh); the right end is 30 September (189 kWh).
    await act(async () => pointer("pointerover", 101));
    await act(async () => pointer("pointermove", 101));
    expect(tip()).toBe("Tue, 1 Sep: 160.0 kWh");
    await act(async () => pointer("pointermove", 203));
    expect(tip()).toBe("Wed, 30 Sep: 189.0 kWh");
    expect(spark.querySelector("circle")).not.toBeNull();
    await act(async () => pointer("pointerout", 300));
    expect(tip()).toBeNull();

    // A tap on a phone leaves the day showing until somewhere else is tapped.
    await act(async () => pointer("pointerdown", 152, "touch"));
    expect(tip()).toBe("Wed, 16 Sep: 175.0 kWh");
    await act(async () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(tip()).toBeNull();

    // With the keyboard: focus starts on the latest day, and the arrow keys step through the days.
    await act(async () => spark.focus());
    expect(tip()).toBe("Wed, 30 Sep: 189.0 kWh");
    await act(async () => spark.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(tip()).toBe("Tue, 29 Sep: 188.0 kWh");
    expect(spark.querySelector('[aria-live="polite"]')?.textContent).toBe("Tue, 29 Sep: 188.0 kWh");
    await act(async () => spark.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(tip()).toBe("Tue, 1 Sep: 160.0 kWh");

    // A day without readings says so.
    const office = row("KL Office").querySelector<HTMLElement>('[role="group"]')!;
    await act(async () => office.focus());
    await act(async () => office.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(office.querySelector('[aria-live="polite"]')?.textContent).toBe("Tue, 1 Sep: no readings");
    await act(async () => root.unmount());
  });

  it("leads each site with its average full day, as on its Overview, and says which average each figure is", async () => {
    // What a newer server adds to each site; the shared response type does not list it yet.
    const averaged = (overrides: Partial<EnergyPortfolioSiteDto> & PortfolioSiteAverage) => site(overrides as Partial<EnergyPortfolioSiteDto>);
    const sites = [
      // Overview: "Uses about 47 kWh a day", from the 25 days every meter read in full.
      averaged({ projectId: "sktc", name: "SKTC", usageKwh: 1380, averageDailyKwh: 47.02, averageBasis: "full-days", fullDays: 25, readingDays: 30, dailyKwh: Array(30).fill(46) }),
      // Connected three days ago with a meter that keeps dropping out: no complete day yet.
      averaged({ projectId: "new", name: "New Depot", usageKwh: 40, averageDailyKwh: 12.5, averageBasis: "reading-days", fullDays: 0, readingDays: 3.2, dailyKwh: [...Array(27).fill(null), 12, 13, 12] }),
      // Not even a day of readings: no average at all.
      averaged({ projectId: "late", name: "Late Site", usageKwh: 2, averageDailyKwh: 0, fullDays: 0, readingDays: 0.4, dailyKwh: [...Array(29).fill(null), 2] }),
    ];
    const newer: EnergyPortfolioDto = { ...portfolio, sites, totals: { ...portfolio.totals, usageKwh: 1422, averageDailyKwh: 59.52 } };
    const row = (host: HTMLElement, name: string) => Array.from(host.querySelectorAll("tbody tr")).find(item => item.querySelector("th")?.textContent?.includes(name))!;
    const tileValue = (host: HTMLElement) => Array.from(host.querySelectorAll("strong")).find(value => value.parentElement?.textContent?.includes("Average a day"))!.textContent;

    const mixed = await render(<PortfolioView portfolio={newer} />);
    expect(row(mixed.host, "SKTC").querySelectorAll("td")[1]!.textContent).toBe("47.0an average full day");
    expect(row(mixed.host, "New Depot").querySelectorAll("td")[1]!.textContent).toBe("12.5average of days with readings");
    expect(row(mixed.host, "Late Site").querySelectorAll("td")[1]!.textContent).toBe("—");
    // The all-sites tile adds up each site's average day, and says one of them is not an average full day.
    expect(tileValue(mixed.host)).toBe("59.5 kWh");
    expect(mixed.host.textContent).toContain("All sites together on an average full day (1 of them from the average of days with readings)");
    // The dashed line and the latest-day words use the same average full day as the figure.
    expect(row(mixed.host, "SKTC").querySelectorAll("td")[2]!.lastElementChild?.textContent).toBe("Latest day 46.0 kWhabout average");
    await act(async () => mixed.root.unmount());

    const allFull = await render(<PortfolioView portfolio={{ ...newer, sites: [sites[0]!], totals: { ...newer.totals, averageDailyKwh: 47.02 } }} />);
    expect(allFull.host.textContent).toContain("All sites together on an average full day");
    expect(allFull.host.textContent).not.toContain("days with readings");
    await act(async () => allFull.root.unmount());

    const allReadings = await render(<PortfolioView portfolio={{ ...newer, sites: [sites[1]!], totals: { ...newer.totals, averageDailyKwh: 12.5 } }} />);
    expect(allReadings.host.textContent).toContain("All sites together, from the average of days with readings");
    await act(async () => allReadings.root.unmount());

    // The same words in Chinese and Malay.
    for (const [locale, fullDay, readingDays, tile] of [
      ["zh-Hans", "按完整日平均", "按有读数的日子平均", "所有场地合计，按完整日平均每天的用电（其中 1 个按有读数的日子平均）"],
      ["ms", "purata hari penuh", "purata hari yang ada bacaan", "Semua tapak bersama pada purata hari penuh (1 tapak menggunakan purata hari yang ada bacaan)"],
    ] as const) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
      const translated = await render(<EnergyIqLocaleProvider><PortfolioView portfolio={newer} /></EnergyIqLocaleProvider>);
      await act(async () => { await Promise.resolve(); });
      expect(row(translated.host, "SKTC").querySelectorAll("td")[1]!.textContent).toContain(fullDay);
      expect(row(translated.host, "New Depot").querySelectorAll("td")[1]!.textContent).toContain(readingDays);
      expect(translated.host.textContent).toContain(tile);
      await act(async () => translated.root.unmount());
    }
  });

  it("copes with an older server that sends no daily figures", async () => {
    const older: EnergyPortfolioDto = { ...portfolio, sites: [site({ projectId: "a", name: "Raffles HQ", averageDailyKwh: 0 })], totals: Object.fromEntries(Object.entries(portfolio.totals).filter(([key]) => key !== "averageDailyKwh")) as EnergyPortfolioDto["totals"] };
    const { host, root } = await render(<PortfolioView portfolio={older} />);
    const cells = host.querySelectorAll("tbody td");
    expect(cells[1]!.textContent).toBe("—");
    expect(cells[2]!.textContent).toBe("—No daily readings");
    await act(async () => root.unmount());
  });

  it("picks whole periods in the sites' time zone", () => {
    const now = new Date("2026-10-10T03:00:00Z");
    expect(presetPeriod("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetPeriod("thisMonth", now)).toEqual({ from: "2026-10-01", to: "2026-10-09" });
    expect(presetPeriod("last3Months", now)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(presetPeriod("thisYear", now)).toEqual({ from: "2026-01-01", to: "2026-10-09" });
    // Early on the 1st in Singapore is still the 1st: "this month" is just today.
    expect(presetPeriod("thisMonth", new Date("2026-09-30T17:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });
});

describe("Scheduled report emails", () => {
  const data: EnergyReportSchedulesDto = {
    schedules: [{
      id: "s1", workspaceId: "w", name: "Monthly summary", frequency: "monthly", projectIds: [], recipientUserIds: ["u1"], localHour: 8,
      timezone: "Asia/Singapore", enabled: true, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
      lastDelivery: { periodKey: "month:2026-09", status: "sent", attempts: 1, recipientCount: 1, updatedAt: "2026-10-01T00:05:00Z" },
      nextPeriod: { from: "2026-09-01", to: "2026-09-30", key: "month:2026-09", dueDate: "2026-10-01" },
    }],
    team: [
      { userId: "u1", email: "ops@acme.test", name: "Ops Lead", canReadReports: true },
      { userId: "u2", email: "cfo@acme.test", canReadReports: true },
      { userId: "u3", email: "contractor@acme.test", canReadReports: false },
    ],
    sites: [{ id: "a", name: "Raffles HQ" }, { id: "b", name: "KL Office" }],
    defaultTimezone: "Asia/Singapore",
    emailMode: "test",
  };

  it("creates a weekly report for chosen people and sites, and asks before deleting", async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    const onDelete = vi.fn().mockResolvedValue(true);
    const props = { data, busy: false, error: null, notice: null, onCreate, onUpdate: vi.fn().mockResolvedValue(true), onDelete, onSend: vi.fn().mockResolvedValue(true) };
    const { host, root } = await render(<ReportSchedulesView {...props} />);
    expect(host.textContent).toContain("Emails are in test mode");
    expect(host.textContent).toContain("Monthly · 1 people · all sites · at 08:00");
    expect(host.textContent).not.toContain("contractor@acme.test");

    const button = (text: string) => Array.from(host.querySelectorAll("button")).find(candidate => candidate.textContent?.includes(text)) as HTMLButtonElement;
    await act(async () => button("New scheduled report").click());
    const form = host.querySelector("form")!;
    await act(async () => {
      const frequency = form.querySelector("select") as HTMLSelectElement;
      frequency.value = "weekly";
      frequency.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const labelled = (text: string) => Array.from(form.querySelectorAll("label")).find(label => label.textContent?.includes(text))!.querySelector("input") as HTMLInputElement;
    await act(async () => labelled("Chosen sites").click());
    await act(async () => labelled("KL Office").click());
    await act(async () => labelled("cfo@acme.test").click());
    await act(async () => (form.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    expect(onCreate).toHaveBeenCalledWith({ name: "Energy summary", frequency: "weekly", projectIds: ["b"], recipientUserIds: ["u2"], localHour: 8 });

    await act(async () => button("Delete").click());
    expect(host.textContent).toContain("Delete \"Monthly summary\"?");
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => Array.from(host.querySelectorAll('[role="group"] button')).find(candidate => candidate.textContent === "Delete")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onDelete).toHaveBeenCalledWith("s1");
    await act(async () => root.unmount());
  });
});
