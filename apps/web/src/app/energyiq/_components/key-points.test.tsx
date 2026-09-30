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
