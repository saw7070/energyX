/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { configApi } from "../../../lib/config-api";
import { KeyPoints } from "./key-points";
// The fixed report loads its own readings; here it only has to feed the heading, the plain names and the dates.
const site = vi.hoisted(() => ({ periods: [] as unknown[], saved: null as null | { reportId: string; cadence: string; period: { from: string; toExclusive: string }; generatedAt: string; coverage: number | null }, newerReadings: false, report: {
  title: { before: "Three-quarters of the office load ", emphasis: "never switches off" },
  headline: "About S$655 of the estimated S$868 monthly bill pays for equipment that stays on around the clock, even when nobody is there.",
  circuits: [{ code: "DB1 L1 Light", name: "Office area lights", meterIds: ["m1"] }],
} }));
// The Overview asks whether this reader may change the report schedule; these tests render it without the provider.
vi.mock("./energyiq-access", () => ({ useEnergyIqAccess: () => ({ activeProject: null }) }));
vi.mock("./site-report", async importOriginal => ({
  ...(await importOriginal<typeof import("./site-report")>()),
  useSiteReport: (_projectId: string, period: unknown, enabled: boolean) => { if (enabled) site.periods.push(period); return { state: { report: site.report }, saved: site.saved, newerReadings: site.newerReadings, retry: () => {} }; },
  SiteReportPanel: ({ saved }: { saved?: { reportId: string } | null }) => <p data-site-report>{saved ? saved.reportId : "built here"}</p>,
}));
afterEach(() => { site.saved = null; site.newerReadings = false; site.periods.length = 0; });
it("leads with the report headline and links to the explanation in Analysis instead of showing priority cards", async () => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);vi.stubGlobal("React",React);
 const request=vi.spyOn(configApi,"reportActionRequest").mockResolvedValue({
  publication:{reportId:"r",selection:{active:[{actionId:"a",sourceReportId:"original-report",issue:"Light",benefit:"Could save SGD 144–216/year if Office Load 4 Fan ISOL 1/2 is approved",annualBenefit:{referenceYear:2027,method:"Comparable working days",assumptions:["Same opening hours"]},nextStep:"Check a 20:00 DB1 L1 Light rule",evidenceFrom:"2026-09-01",evidenceToExclusive:"2026-09-02"}],featuredActionIds:["a"]}},
  metrics:{projectName:"Office",period:{from:"2026-09-01",toExclusive:"2026-09-02"},energyKwh:0,peakKw:0,coverage:1,cost:null,outsideHoursPercent:null}
 });
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {await act(async()=>root.render(<KeyPoints projectId="p"/>));
 expect(host.querySelector("[data-site-report]")).not.toBeNull();
 // No published source dates: the report covers the latest 4 weeks.
 expect(site.periods.at(-1)).toBeNull();
 expect(host.querySelector("h2")?.textContent).toBe("Three-quarters of the office load never switches off");
 expect(host.textContent).toContain("About S$655 of the estimated S$868 monthly bill");
 // No priority cards and no Action plan link: the headline leads to the explanation in Analysis.
 expect(host.querySelector('a[href^="/energyiq/actions"]')).toBeNull();
 expect(host.querySelector('a[href^="/energyiq/analysis"]')?.textContent).toBe("See why in Analysis →");
 expect(host.textContent).not.toContain("Check a 20:00");expect(host.textContent).not.toContain("Review action");expect(host.textContent).not.toContain("Evidence & calculation");
 expect(host.querySelector('[aria-label="Project energy overview"]')).toBeNull();
 expect(host.textContent).not.toContain("Electricity used");expect(host.textContent).not.toContain("Highest demand");
 expect(host.textContent).not.toContain("Could save");
 // The Overview no longer carries a standing "no safety alerts" box; the caveat lives in the Devices method note.
 expect(host.querySelector('[aria-label="Safety status"]')).toBeNull();
 expect(host.textContent).not.toContain("not a site safety inspection");
 expect(host.textContent).not.toContain("Estimated electricity cost");expect(host.textContent).not.toContain("Outside operating hours");
 } finally {await act(async()=>root.unmount());host.remove();request.mockRestore();vi.unstubAllGlobals();}
});

it("adds one short line by top-level group under the headline, worded as each group's share of all use", async () => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);vi.stubGlobal("React",React);
 const report = site.report as typeof site.report & { groups?: { summary: string } };
 report.groups = { summary: "Block 1B 40% · Block 1A 38% · Common area 22% — biggest single group: Entrance" };
 const request=vi.spyOn(configApi,"reportActionRequest").mockResolvedValue({ publication:{reportId:"r",selection:{active:[],featuredActionIds:[]}}, metrics:{projectName:"Estate",period:{from:"2026-09-01",toExclusive:"2026-09-02"},energyKwh:0,peakKw:0,coverage:1,cost:null,outsideHoursPercent:null} });
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {await act(async()=>root.render(<KeyPoints projectId="p"/>));
 // Not a split of the daytime share in the headline above it: each group's share of all the site's use.
 expect(host.textContent).toContain("Share of all use: Block 1B 40% · Block 1A 38% · Common area 22% — biggest single group: Entrance");
 expect(host.textContent).not.toContain("By group:");
 } finally {delete report.groups;await act(async()=>root.unmount());host.remove();request.mockRestore();vi.unstubAllGlobals();}
});

it("leads with the average day, then where it goes by group, each top-level group opening onto its groups", async () => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);vi.stubGlobal("React",React);
 type Row = { key: string; name: string; kind: "group" | "meter" | "unmetered"; kwh: number; share: number; pct: number; perDay: number | null; rows: Row[] };
 const row = (key: string, name: string, share: number, rows: Row[] = []): Row => ({ key, name, kind: "group", kwh: share * 100, share, pct: Math.round(share * 100), perDay: share * 47, rows });
 const report = site.report as typeof site.report & { averageDay?: { kwh: number; cost: number | null; text: string }; groups?: { summary: string; breakdown: Row[] } };
 report.averageDay = { kwh: 47, cost: 13, text: "Uses about 47 kWh a day (about S$13)" };
 report.groups = { summary: "Block A 40% · Block B 40% · Common area 20%", breakdown: [
  row("a", "Block A", 0.4, [row("a-gf", "Ground floor", 0.1), row("a-bl", "Block lighting", 0.3)]),
  row("b", "Block B", 0.4),
  row("c", "Common area", 0.2, [row("drive", "Driveway", 0.08), row("play", "Playground", 0.05), row("pav", "Pavilion", 0.03), row("gate", "Entrance", 0.04)]),
 ] };
 const request=vi.spyOn(configApi,"reportActionRequest").mockResolvedValue({ publication:{reportId:"r",selection:{active:[],featuredActionIds:[]}}, metrics:{projectName:"Estate",period:{from:"2026-09-01",toExclusive:"2026-09-02"},energyKwh:0,peakKw:0,coverage:1,cost:null,outsideHoursPercent:null} });
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {await act(async()=>root.render(<KeyPoints projectId="p"/>));
 expect(host.querySelector("h2")?.textContent).toBe("Uses about 47 kWh a day (about S$13)");
 // The finding follows the average day and the split.
 expect(host.textContent).toContain("Three-quarters of the office load never switches off");
 expect(host.textContent).not.toContain("Share of all use:");
 const split=host.querySelector('section[aria-labelledby]')!;
 expect(split.querySelector("h3")?.textContent).toBe("Where it goes");
 const buttons=[...split.querySelectorAll("button")];
 // Saved order, each with its kWh a day and share of the whole site; a group with nothing inside it is not a button.
 expect(buttons.map(button=>button.textContent)).toEqual(["Block A18.8 kWh a day · 40%", "Common area9.4 kWh a day · 20%"]);
 expect(split.textContent).toContain("Block B18.8 kWh a day · 40%");
 const common=buttons[1]!;
 const inside=host.querySelector(`#${CSS.escape(common.getAttribute("aria-controls")!)}`) as HTMLElement;
 expect(common.getAttribute("aria-expanded")).toBe("false");
 expect(inside.hidden).toBe(true);
 expect(inside.getAttribute("aria-label")).toBe("Inside Common area");
 await act(async()=>common.click());
 expect(common.getAttribute("aria-expanded")).toBe("true");
 expect(inside.hidden).toBe(false);
 expect([...inside.querySelectorAll("li")].map(item=>item.textContent)).toEqual(["Driveway3.8 kWh a day · 8%", "Playground2.4 kWh a day · 5%", "Pavilion1.4 kWh a day · 3%", "Entrance1.9 kWh a day · 4%"]);
 await act(async()=>common.click());
 expect(inside.hidden).toBe(true);
 } finally {delete report.groups;delete report.averageDay;await act(async()=>root.unmount());host.remove();request.mockRestore();vi.unstubAllGlobals();}
});

it("lists the lights that were on in the daytime under a daytime warning, and nothing extra when the lights ran as planned", async () => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);vi.stubGlobal("React",React);
 const report = site.report as typeof site.report & { headlineTopic?: string; daytime?: { heading: string; items: string[]; more: string | null; none: string | null; alwaysOn: string | null; rule: string } };
 report.daytime = { heading: "On in the daytime", items: ["Corridor lights: on 6–7 pm on 14 days, 8.4 kWh", "Driveway lamp: on 7–9 am on 3 days, 3.0 kWh"], more: "and 2 more", none: null, alwaysOn: "Always on by design, so left out of daytime use: Emergency lights.", rule: "" };
 const request=vi.spyOn(configApi,"reportActionRequest").mockResolvedValue({ publication:{reportId:"r",selection:{active:[],featuredActionIds:[]}}, metrics:{projectName:"Estate",period:{from:"2026-09-01",toExclusive:"2026-09-02"},energyKwh:0,peakKw:0,coverage:1,cost:null,outsideHoursPercent:null} });
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {
  report.headlineTopic = "daytime";
  await act(async()=>root.render(<KeyPoints projectId="p"/>));
  const items=[...host.querySelectorAll("li")].map(item=>item.textContent);
  expect(items).toEqual(["Corridor lights: on 6–7 pm on 14 days, 8.4 kWh", "Driveway lamp: on 7–9 am on 3 days, 3.0 kWh", "and 2 more"]);
  expect(host.textContent).toContain("Always on by design, so left out of daytime use: Emergency lights.");
  await act(async()=>root.unmount());
  report.headlineTopic = "night";
  const again=createRoot(host);
  await act(async()=>again.render(<KeyPoints projectId="p"/>));
  expect(host.textContent).not.toContain("On in the daytime");
  await act(async()=>again.unmount());
 } finally {delete report.daytime;delete report.headlineTopic;host.remove();request.mockRestore();vi.unstubAllGlobals();}
});

// The heading and the document below it are one saved report, so the page names that report and nothing else.
it("names the saved report the heading comes from, links to it in Reports and warns when newer readings exist", async () => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);vi.stubGlobal("React",React);
 site.saved = { reportId: "site-monthly", cadence: "monthly", period: { from: "2026-08-01", toExclusive: "2026-09-01" }, generatedAt: "2026-09-22T10:00:00Z", coverage: 99.4 };
 site.newerReadings = true;
 const request=vi.spyOn(configApi,"reportActionRequest").mockResolvedValue({
  publication:{reportId:"r",selection:{active:[],featuredActionIds:[]}},
  // The priorities come from an older report of their own; the Overview still describes the saved site report.
  source:{reportId:"advisor-1",category:"scheduled",version:1,createdAt:"2026-07-02T00:00:00Z",finishedAt:"2026-07-02T00:00:00Z",period:{from:"2026-06-01",toExclusive:"2026-07-01"},newerDataAvailable:false},
  metrics:{projectName:"Office",period:{from:"2026-06-01",toExclusive:"2026-07-01"},energyKwh:0,peakKw:0,coverage:1,cost:null,outsideHoursPercent:null}
 });
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {await act(async()=>root.render(<KeyPoints projectId="p"/>));
 expect(host.querySelector("[data-site-report]")?.textContent).toBe("site-monthly");
 const source=host.querySelector('[aria-label="Where these figures come from"]');
 expect(source?.querySelector("p")?.textContent).toBe("Your saved report of 22 Sep 2026 · covers 1–31 Aug 2026 · 99.4% of readings received");
 expect(source?.querySelector("strong")?.textContent).toBe("22 Sep 2026");
 expect(source?.querySelector("a")?.getAttribute("href")).toBe("/energyiq/library?projectId=p&reportId=site-monthly");
 // Not the advisor report the priorities came from.
 expect(host.textContent).not.toContain("From the automatic report");
 expect(host.textContent).toContain("Readings have arrived for days after this report. The Overview changes when the next report is saved.");
 // Analysis opens on the dates of the report on screen, not the priorities' own dates.
 expect(host.querySelector('a[href^="/energyiq/analysis"]')?.getAttribute("href")).toContain("from=2026-08-01&to=2026-08-31");
 } finally {await act(async()=>root.unmount());host.remove();request.mockRestore();vi.unstubAllGlobals();}
});
