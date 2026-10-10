import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

import type { Portfolio, PortfolioSite } from "./energy-portfolio.js";
import { pdfText, portfolioPdfFileName, renderPortfolioPdf } from "./energy-portfolio-pdf.js";

const SG_FACTOR: PortfolioSite["carbonFactor"] = {
  kgCo2ePerKwh: 0.402,
  year: 2024,
  source: "Energy Market Authority, Singapore Energy Statistics",
  basis: "grid",
  grid: "SG",
};
const MY_FACTOR: PortfolioSite["carbonFactor"] = {
  kgCo2ePerKwh: 0.74,
  year: 2024,
  source: "Energy Commission Malaysia, Grid Emission Factor (Peninsular)",
  provisional: true,
  basis: "grid",
  grid: "MY-PENINSULAR",
};

const site = (overrides: Partial<PortfolioSite> & Pick<PortfolioSite, "projectId" | "name">): PortfolioSite => ({
  timezone: "Asia/Singapore",
  status: "ok",
  usageKwh: 1000,
  averageDailyKwh: 33.3,
  peakKw: 12.5,
  previousUsageKwh: 950,
  changePct: 5.3,
  carbonKg: 402,
  carbonFactor: SG_FACTOR,
  coveragePct: 100,
  dataStatus: "complete",
  ...overrides,
});

const portfolioOf = (sites: PortfolioSite[], workspaceName = "Acme Holdings"): Portfolio => {
  const costByCurrency: Record<string, number> = {};
  for (const entry of sites) {
    if (entry.cost) costByCurrency[entry.cost.currency] = (costByCurrency[entry.cost.currency] ?? 0) + entry.cost.amount;
  }
  return {
    workspaceId: "ws-acme",
    workspaceName,
    period: { from: "2026-09-01", to: "2026-09-30" },
    generatedAt: "2026-10-01T01:15:00.000Z",
    sites,
    totals: {
      usageKwh: sites.reduce((sum, entry) => sum + entry.usageKwh, 0),
      previousUsageKwh: sites.reduce((sum, entry) => sum + entry.previousUsageKwh, 0),
      carbonKg: sites.reduce((sum, entry) => sum + entry.carbonKg, 0),
      costByCurrency,
      sitesWithData: sites.filter((entry) => entry.status === "ok" && entry.usageKwh > 0).length,
      sitesOverBudget: sites.filter((entry) => entry.budget?.status === "over").length,
      sitesAtRisk: sites.filter((entry) => entry.budget?.status === "at-risk").length,
    },
  };
};

const threeSites = (): Portfolio => portfolioOf([
  site({
    projectId: "p-raffles",
    name: "Raffles Place HQ",
    country: "SG",
    usageKwh: 48_250.4,
    previousUsageKwh: 43_100,
    changePct: 11.9,
    peakKw: 182.4,
    cost: { amount: 13_410.22, currency: "SGD" },
    afterHoursKwh: 15_054,
    afterHoursSharePct: 31.2,
    carbonKg: 19_396.7,
    floorAreaSqm: 2400,
    kwhPerSqm: 20.1,
    budget: {
      month: "2026-10",
      dataThrough: "2026-09-30",
      daysInMonth: 31,
      actualKwh: 40_100,
      forecastKwh: 51_000,
      actualCost: 12_800,
      forecastCost: 14_900,
      currency: "SGD",
      budgetAmount: 12_000,
      status: "over",
    },
  }),
  site({
    projectId: "p-kl",
    name: "吉隆坡 Office",
    country: "MY",
    timezone: "Asia/Kuala_Lumpur",
    usageKwh: 21_980,
    previousUsageKwh: 23_400,
    changePct: -6.1,
    peakKw: 95.3,
    cost: { amount: 9_870.5, currency: "MYR" },
    afterHoursSharePct: 18.4,
    carbonKg: 16_265.2,
    carbonFactor: MY_FACTOR,
    coveragePct: 88.5,
    dataStatus: "partial",
    budget: {
      month: "2026-10",
      daysInMonth: 31,
      actualKwh: 18_000,
      forecastKwh: 23_500,
      currency: "MYR",
      budgetAmount: 9_000,
      budgetKwh: 22_000,
      status: "at-risk",
      costNote: "tariff-unavailable",
    },
  }),
  site({
    projectId: "p-depot",
    name: "Tuas Depot",
    status: "unavailable",
    reason: "ENERGYIQ_NO_READINGS",
    usageKwh: 0,
    averageDailyKwh: 0,
    peakKw: 0,
    previousUsageKwh: 0,
    changePct: null,
    carbonKg: 0,
    coveragePct: 0,
    dataStatus: "unavailable",
    budget: { month: "2026-10", daysInMonth: 31, actualKwh: 0, forecastKwh: 0, currency: "SGD", budgetAmount: 2_000, status: "no-data" },
  }),
]);

const manySites = (count: number): Portfolio => portfolioOf(Array.from({ length: count }, (_, index) => site({
  projectId: `p-${index}`,
  name: `Preschool centre ${String(index + 1).padStart(2, "0")}`,
  usageKwh: 20_000 - index * 250,
  cost: { amount: 5_000 - index * 60, currency: "SGD" },
  carbonKg: (20_000 - index * 250) * 0.402,
  ...(index % 7 === 0 ? { kwhPerSqm: 12.5 } : {}),
  ...(index % 11 === 0 ? { coveragePct: 90, dataStatus: "partial" as const } : {}),
})));

const textOf = async (pdf: Buffer): Promise<{ totalPages: number; text: string }> => {
  const document = await getDocumentProxy(new Uint8Array(pdf));
  const { totalPages, text } = await extractText(document, { mergePages: true });
  return { totalPages, text };
};

/** Page objects in the file (not the /Pages tree node). */
const pageCount = (pdf: Buffer): number => pdf.toString("latin1").match(/\/Type \/Page(?!s)/gu)?.length ?? 0;

describe("portfolio PDF", () => {
  it("renders a report with every section and safe text for names the built-in font cannot draw", async () => {
    const pdf = await renderPortfolioPdf(threeSites(), { frequencyLabel: "Monthly report" });

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2048);

    const { totalPages, text } = await textOf(pdf);
    expect(pageCount(pdf)).toBe(totalPages);
    for (const expected of [
      "Energy portfolio report",
      "Acme Holdings",
      "1 Sep 2026 – 30 Sep 2026",
      "Monthly report",
      "Generated 1 Oct 2026",
      "Sites compared",
      "Raffles Place HQ",
      "??? Office",
      "No readings for this period",
      "S$13,410.22",
      "RM9,870.50",
      "Energy by site",
      "Monthly budgets",
      "Compared on kWh: the electricity price is not set",
      "Key points",
      "Raffles Place HQ used the most energy",
      "1 site over budget (Raffles Place HQ); 1 site heading over (??? Office)",
      "Emission factors used",
      "Energy Market Authority, Singapore Energy Statistics",
      "0.402",
      "Official grid",
      "Sites: Raffles Place HQ",
      "(provisional)",
      "location-based method",
      "Readings 88.5% complete",
      `Page 1 of ${totalPages}`,
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("吉隆坡");
  });

  it("repeats the table header and numbers the pages when the sites run over several pages", async () => {
    const pdf = await renderPortfolioPdf(manySites(60));

    const { totalPages, text } = await textOf(pdf);
    expect(totalPages).toBeGreaterThan(1);
    expect(pageCount(pdf)).toBe(totalPages);
    expect(text).toContain("Sites compared (continued)");
    expect(text).toContain(`Page 2 of ${totalPages}`);
    expect(text).toContain("Preschool centre 60");
  });

  it("renders a workspace with no sites", async () => {
    const pdf = await renderPortfolioPdf(portfolioOf([]), { title: "Quarterly energy review" });

    const { text } = await textOf(pdf);
    expect(text).toContain("Quarterly energy review");
    expect(text).toContain("No sites in this report.");
    expect(text).toContain("No budgets set");
  });
});

describe("portfolio PDF file name", () => {
  it("is plain ASCII built from the workspace and the period", () => {
    const safe = /^[A-Za-z0-9-]+\.pdf$/u;
    expect(portfolioPdfFileName(threeSites())).toBe("EnergyX-acme-holdings-2026-09-01-to-2026-09-30.pdf");
    expect(portfolioPdfFileName(portfolioOf([], "Café Zürich / 吉隆坡 Sdn. Bhd."))).toBe("EnergyX-cafe-zurich-sdn-bhd-2026-09-01-to-2026-09-30.pdf");
    expect(portfolioPdfFileName(portfolioOf([], "吉隆坡"))).toBe("EnergyX-portfolio-2026-09-01-to-2026-09-30.pdf");
    expect(portfolioPdfFileName(portfolioOf([], "吉隆坡 Office"))).toMatch(safe);
  });
});

describe("PDF text", () => {
  it("keeps what Helvetica can draw and marks everything else", () => {
    expect(pdfText("吉隆坡 Office")).toBe("??? Office");
    expect(pdfText("Café Zürich – O’Brien")).toBe("Café Zürich – O’Brien");
    expect(pdfText("Site 🌿")).toBe("Site ?");
    expect(pdfText("Line\none")).toBe("Line one");
  });
});
