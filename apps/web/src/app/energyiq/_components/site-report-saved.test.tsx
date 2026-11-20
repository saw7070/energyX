/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEnergyReview, buildManagementReview, buildSiteReport, managementReviewMessages, serializeSiteReportSnapshot, siteReportMessages,
  type AnalysisData, type SiteReportSnapshot, type TrendSeries,
} from "@datafoundry/site-report";
import { EnergyReviewDocument, renderEnergyReviewHtml } from "@datafoundry/site-report/energy-review-document";
import { ManagementReviewDocument, renderManagementReviewHtml } from "@datafoundry/site-report/management-review-document";
import type { ReportSectionFeedback } from "@datafoundry/site-report/section-feedback";
import { renderSiteReportHtml, SiteReportDocument } from "@datafoundry/site-report/site-report-document";
import { DATA, DATES, site } from "./standout-days.test-fixture";
import type { ReportFeedbackState } from "./report-feedback-model";
import { sectionFeedbackMessages } from "./report-section-feedback-messages";

const mock = vi.hoisted(() => ({ search: "projectId=p1", library: vi.fn(), feedback: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(mock.search) }));
vi.mock("./energyiq-access", () => ({ useEnergyIqAccess: () => ({ access: { role: "user", activeWorkspaceId: "w1", user: { id: "u1" }, projects: [{ id: "p1", workspaceId: "w1", status: "published" }] }, activeProject: { id: "p1" }, loading: false, error: null, selectProject: vi.fn() }) }));
vi.mock("../../../lib/config-api", async importOriginal => ({
  ConfigApiError: (await importOriginal<typeof import("../../../lib/config-api")>()).ConfigApiError,
  configApi: { reportAgentRequest: vi.fn(async () => ({})), reportLibraryRequest: mock.library, reportFeedbackRequest: mock.feedback },
}));
import { ReportLibraryView } from "./report-library";

// One day of the estate's readings: what "Create a report" writes for a single day (always the full report).
const DAY = DATES[0]!;
const cut = (series: TrendSeries): TrendSeries => ({ ...series, cells: series.cells.filter(cell => cell[0] === DAY) });
const ONE_DAY: AnalysisData = { ...DATA, current: { project: { ...site, dates: [DAY], total: cut(site.total), meters: site.meters.map(meter => ({ ...meter, series: cut(meter.series) })) }, spaces: [] } };
const GENERATED = "2026-11-17T02:00:00Z";
const snapshot = (data: AnalysisData, cadence: SiteReportSnapshot["cadence"], style?: "management" | "review"): SiteReportSnapshot => ({
  schemaVersion: 1, projectId: "p1", cadence, ...(style ? { style } : {}), period: { from: data.current.project.dates[0]!, toExclusive: "2026-11-16" },
  generatedAt: GENERATED, language: "en", reference: null, data,
});
const SNAPSHOTS: Record<string, SiteReportSnapshot> = {
  "site-day": snapshot(ONE_DAY, "custom"),
  "site-week-review": snapshot(DATA, "weekly", "review"),
  "site-month-management": snapshot(DATA, "monthly", "management"),
  "site-week-full": snapshot(DATA, "weekly"),
};
const report = (id: string, title: string, extra: Record<string, unknown>) => ({ id, title, version: 1, kind: "report", period: { from: DAY, toExclusive: "2026-11-16" }, createdAt: "2026-11-16T02:00:00Z", source: "site", canDiscuss: false, ...extra });
const LIBRARY = { skills: [], tools: [], canChat: true, overviewCadence: "weekly", reports: [
  report("site-day", "Custom site energy report", { category: "custom" }),
  report("site-week-review", "Weekly site energy review", { category: "scheduled", cadence: "weekly", style: "review" }),
  report("site-month-management", "Monthly site management review", { category: "scheduled", cadence: "monthly", style: "management" }),
  report("site-week-full", "Weekly site energy report", { category: "scheduled", cadence: "weekly" }),
  { id: "advisor-1", title: "Custom Energy Report", version: 1, kind: "report", category: "custom", period: { from: DAY, toExclusive: "2026-11-16" }, createdAt: "2026-11-16T03:00:00Z", source: "advisor", canDiscuss: true },
] };
const STATE: ReportFeedbackState = { canGive: true, canManage: false, aiAvailable: true, feedback: [], memory: [], followUps: [], dismissedChecks: [] };
const SENT = { id: "f1", text: "", about: null, authorUserId: "u1", authorName: "Ana", createdAt: GENERATED, status: "processed", reply: "Noted.", memoryIds: [], followUpIds: [], suggestions: [] };

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  mock.library.mockReset(); mock.feedback.mockReset();
  mock.library.mockImplementation(async (_projectId: string, path = "") => path.startsWith("output/") ? { content: "<html><body>Saved page</body></html>" }
    : path.startsWith("snapshot/") ? { snapshot: serializeSiteReportSnapshot(SNAPSHOTS[decodeURIComponent(path.slice("snapshot/".length))]!) }
    : LIBRARY);
  mock.feedback.mockImplementation(async (_projectId: string, _path: string, init?: RequestInit) => init?.method === "POST" ? { feedback: SENT, state: STATE } : STATE);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const settle = async () => { for (let tick = 0; tick < 6; tick += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
async function open(reportId: string) {
  mock.search = `projectId=p1&reportId=${reportId}`;
  await act(async () => root.render(<ReportLibraryView projectId="p1" view="reports" />));
  await settle();
  return container.querySelector<HTMLElement>("aside")!;
}
const type = async (field: HTMLTextAreaElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = async (form: HTMLFormElement) => act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
/** A section's heading as the report shows it. */
const heading = (pane: HTMLElement, id: string) => pane.querySelector(`section#${id} h2`)!.textContent;
/** What the page sent with the last feedback. */
const lastSent = () => JSON.parse(String(mock.feedback.mock.calls.filter(call => (call[2] as RequestInit | undefined)?.method === "POST").at(-1)![2].body));

describe("a site report opened in Reports takes feedback", () => {
  it("shows a created one-day full report on the page, with section buttons and the panel at the end", async () => {
    const pane = await open("site-day");
    expect(mock.library).toHaveBeenCalledWith("p1", "snapshot/site-day", expect.anything());
    expect(pane.querySelector("[data-site-report-style='full'] article.eiq-report")).not.toBeNull();
    // On the page, not in the sandboxed frame where highlighting reached nobody.
    expect(pane.querySelector("iframe")).toBeNull();
    const ids = [...pane.querySelectorAll<HTMLButtonElement>("button.rp-fb")].map(button => button.dataset.feedbackSection);
    expect(ids).toEqual(["headline", "site-profile", "estimate", "benchmark", "weekday-pattern", "screening"]);
    // The section anchors are the ones they always were.
    for (const id of ["site-profile", "estimate", "benchmark", "weekday-pattern", "screening"]) expect(pane.querySelector(`section#${id}`)).not.toBeNull();
    // Each named as the reader sees it, by its number and heading (a one-day report words its headings for one day).
    const estimate = pane.querySelector<HTMLButtonElement>("button[data-feedback-section='estimate']")!;
    expect(estimate.dataset.feedbackTitle).toBe(`2 ${heading(pane, "estimate")}`);
    expect(estimate.getAttribute("aria-label")).toBe(`Give feedback on 2 ${heading(pane, "estimate")}`);
    expect(pane.querySelector<HTMLButtonElement>("button[data-feedback-section='headline']")!.dataset.feedbackTitle).toBe(siteReportMessages.en["doc.feedback.headline"]);
    // "Tell the AI about this report" closes the report.
    const panel = pane.querySelector<HTMLElement>("#report-feedback")!;
    expect(panel.textContent).toContain("Tell the AI about this report");
    expect(pane.querySelector("article.eiq-report")!.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sends a section's feedback tied to that section, with this report's figures", async () => {
    const pane = await open("site-day");
    await act(async () => pane.querySelector<HTMLButtonElement>("button[data-feedback-section='benchmark']")!.click());
    const box = pane.querySelector<HTMLElement>("section#benchmark [role='group']")!;
    expect(box.textContent).toContain(`Feedback on 3 ${heading(pane, "benchmark")}`);
    await type(box.querySelector("textarea")!, "The base load is the lift lobby lights.");
    await submit(box.querySelector("form")!);
    const built = buildSiteReport(ONE_DAY, null, GENERATED, "en");
    expect(lastSent()).toMatchObject({ text: "The base load is the lift lobby lights.", about: { kind: "section", id: "benchmark", title: `3 ${heading(pane, "benchmark")}` },
      reportContext: { checks: [], figures: expect.arrayContaining([built.headline, `${built.keyFigures[0]!.label}: ${built.keyFigures[0]!.value}`]) } });
    expect(pane.querySelector("section#benchmark [role='status']")!.textContent).toContain("Noted.");
  });

  it("offers feedback on highlighted text and quotes it, tied to the section it is in", async () => {
    const pane = await open("site-day");
    const paragraph = pane.querySelector<HTMLElement>("section#estimate > p")!;
    const words = paragraph.textContent!.trim();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    await act(async () => { paragraph.dispatchEvent(new Event("pointerup", { bubbles: true })); });
    await settle();
    const pick = [...pane.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Give feedback on this")!;
    expect(pick).toBeDefined();
    await act(async () => pick.click());
    const box = pane.querySelector<HTMLElement>("section#estimate [role='group']")!;
    expect(box.querySelector("blockquote")!.textContent).toContain(words.replace(/\s+/g, " ").slice(0, 40));
    await type(box.querySelector("textarea")!, "This month had a public holiday.");
    await submit(box.querySelector("form")!);
    const sent = lastSent();
    expect(sent.about).toEqual({ kind: "section", id: "estimate", title: `2 ${heading(pane, "estimate")}` });
    expect(sent.text.startsWith(`“${words.replace(/\s+/g, " ").slice(0, 30)}`)).toBe(true);
    expect(sent.text.endsWith("\nThis month had a public holiday.")).toBe(true);
  });

  it("does the same on a saved weekly energy review, with its points to check", async () => {
    const pane = await open("site-week-review");
    expect(pane.querySelector("[data-site-report-style='review'] article.eiq-energy-review")).not.toBeNull();
    expect(pane.querySelectorAll("button.er-fb").length).toBeGreaterThan(3);
    const panel = pane.querySelector<HTMLElement>("#report-feedback")!;
    expect(panel.textContent).toContain("Tell the AI about this report");
    await type(panel.querySelector("textarea")!, "The pavilion fan is on a timer.");
    await submit(panel.querySelector("form")!);
    const review = buildEnergyReview(DATA, null, GENERATED, "en");
    expect(lastSent().reportContext.checks).toEqual(review.checks.filter(check => check.key).map(check => ({ key: check.key, title: check.title })));
  });

  it("does the same on a saved management review, with section buttons and its own figures", async () => {
    const pane = await open("site-month-management");
    expect(pane.querySelector("[data-site-report-style='management'] article.eiq-review")).not.toBeNull();
    const management = buildManagementReview(DATA, null, GENERATED, "en");
    const ids = [...pane.querySelectorAll<HTMLButtonElement>("button.rp-fb")].map(button => button.dataset.feedbackSection);
    expect(ids).toEqual(["headline", ...management.sections]);
    expect(pane.querySelector<HTMLButtonElement>("button[data-feedback-section='summary']")!.dataset.feedbackTitle).toBe(`1 ${managementReviewMessages.en["sec.summary"]}`);
    const panel = pane.querySelector<HTMLElement>("#report-feedback")!;
    await type(panel.querySelector("textarea")!, "Block 1B is being renovated.");
    await submit(panel.querySelector("form")!);
    expect(lastSent().reportContext.figures).toEqual(expect.arrayContaining([management.title, `${management.keyFigures[0]!.label}: ${management.keyFigures[0]!.value}`]));
  });

  it("shows the panel on a saved weekly full report too, and nothing to readers who may not give feedback", async () => {
    const pane = await open("site-week-full");
    expect(pane.querySelector("#report-feedback")).not.toBeNull();
    expect(pane.querySelectorAll("button.rp-fb").length).toBe(6);
    await act(async () => root.unmount());
    root = createRoot(container);
    mock.feedback.mockImplementation(async () => ({ ...STATE, canGive: false }));
    const readOnly = await open("site-week-full");
    expect(readOnly.querySelector("article.eiq-report")).not.toBeNull();
    expect(readOnly.querySelector("#report-feedback")).toBeNull();
    expect(readOnly.querySelectorAll("button.rp-fb")).toHaveLength(0);
  });

  it("keeps the saved page when the readings cannot be read, and leaves the advisor's own reports as they were", async () => {
    mock.library.mockImplementation(async (_projectId: string, path = "") => path.startsWith("output/") ? { content: "<html><body>Saved page</body></html>" }
      : path.startsWith("snapshot/") ? Promise.reject(new Error("SITE_REPORT_SNAPSHOT_NOT_FOUND")) : LIBRARY);
    const pane = await open("site-week-full");
    expect(pane.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
    await act(async () => root.unmount());
    root = createRoot(container);
    const advisor = await open("advisor-1");
    expect(mock.library).not.toHaveBeenCalledWith("p1", "snapshot/advisor-1", expect.anything());
    expect(advisor.querySelector("iframe")).not.toBeNull();
    expect(advisor.querySelector("#report-feedback")).toBeNull();
  });
});

describe("the saved and downloaded pages stay as they were", () => {
  const feedback: ReportSectionFeedback = { label: "Give feedback", ariaLabel: title => `Give feedback on ${title}`, open: () => undefined, slot: () => <p>box</p> };
  const full = buildSiteReport(ONE_DAY, null, GENERATED, "en");
  const management = buildManagementReview(DATA, null, GENERATED, "en");
  const review = buildEnergyReview(DATA, null, GENERATED, "en");
  it("never draws feedback on a standalone copy, even when handed it", () => {
    expect(renderToStaticMarkup(<SiteReportDocument report={full} standalone sectionFeedback={feedback} />)).toBe(renderToStaticMarkup(<SiteReportDocument report={full} standalone />));
    expect(renderToStaticMarkup(<ManagementReviewDocument review={management} standalone sectionFeedback={feedback} />)).toBe(renderToStaticMarkup(<ManagementReviewDocument review={management} standalone />));
    expect(renderToStaticMarkup(<EnergyReviewDocument review={review} standalone sectionFeedback={feedback} />)).toBe(renderToStaticMarkup(<EnergyReviewDocument review={review} standalone />));
    // On the live page the same document offers it.
    expect(renderToStaticMarkup(<SiteReportDocument report={full} sectionFeedback={feedback} />)).toContain('data-feedback-section="estimate"');
    expect(renderToStaticMarkup(<ManagementReviewDocument review={management} sectionFeedback={feedback} />)).toContain('data-feedback-section="summary"');
  });
  it("has no feedback buttons, styles or scripts in the files", () => {
    for (const html of [renderSiteReportHtml(full), renderManagementReviewHtml(management), renderEnergyReviewHtml(review)]) {
      expect(html).not.toContain("data-feedback-section");
      expect(html).not.toContain("rp-fb");
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<button[^>]*class="er-fb"/);
    }
  });
});

describe("wording", () => {
  it("has every feedback word in English, Chinese and Malay", () => {
    for (const book of [sectionFeedbackMessages, siteReportMessages, managementReviewMessages] as Array<Record<string, Record<string, string>>>) {
      for (const locale of ["zh-Hans", "ms"]) {
        const gaps = Object.keys(book.en!).filter(key => !book[locale]?.[key]?.trim());
        expect(gaps, locale).toEqual([]);
      }
    }
    expect(siteReportMessages["zh-Hans"]["doc.feedback.headline"]).not.toBe(siteReportMessages.en["doc.feedback.headline"]);
    expect(managementReviewMessages.ms["doc.feedback.headline"]).not.toBe(managementReviewMessages.en["doc.feedback.headline"]);
  });
  it("names the sections in the reader's language", () => {
    const zh = buildSiteReport(ONE_DAY, null, GENERATED, "zh-Hans");
    const markup = renderToStaticMarkup(<SiteReportDocument report={zh} sectionFeedback={{ ...feedback(), label: "反馈" }} />);
    expect(markup).toContain(`data-feedback-title="${siteReportMessages["zh-Hans"]["doc.feedback.headline"]}"`);
    expect(markup).toContain(`data-feedback-title="5 ${siteReportMessages["zh-Hans"]["doc.section.screening"]}"`);
  });
});

function feedback(): ReportSectionFeedback {
  return { label: "Give feedback", ariaLabel: title => title, open: () => undefined };
}
