/** @vitest-environment happy-dom */
/**
 * The layouts offered in Create project → Reports, each drawn from the made-up sample site. Every layout must come out
 * whole (no blanks, no "undefined", no NaN), from four weeks of readings ending the day before, in the reader's language.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEnergyReview, sampleSiteAnalysisData } from "@datafoundry/site-report";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";
import ReportLayoutPreview, { SampleReport, type ReportLayout } from "./report-layout-preview";

const NOW = new Date("2026-11-26T04:00:00Z");
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("React", React);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  document.documentElement.lang = "en";
  vi.unstubAllGlobals();
});

const draw = async (layout: ReportLayout, locale: EnergyIqLocale = "en") => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  await act(async () => root.render(<EnergyIqLocaleProvider><SampleReport layout={layout} now={NOW} /></EnergyIqLocaleProvider>));
  return container.textContent ?? "";
};

describe("the sample site", () => {
  it("holds four whole weeks of readings ending the day before, with every meter named", () => {
    const data = sampleSiteAnalysisData(NOW);
    expect(data.projectName).toBe("Sample site");
    expect(data.current.project.dates).toHaveLength(28);
    expect(data.current.project.dates[0]).toBe("2026-10-29");
    expect(data.current.project.dates.at(-1)).toBe("2026-11-25");
    expect(data.current.project.meters.map(meter => meter.name)).toContain("Linkway lights");
    expect(data.current.spaces.map(space => space.name)).toEqual(["Block 101", "Block 102", "Common area"]);
    expect(data.current.project.usageKwh).toBeGreaterThan(1000);
  });

  it("gives the energy review something to say in each of its sections", () => {
    const review = buildEnergyReview(sampleSiteAnalysisData(NOW), null, NOW.toISOString());
    expect(review.questions).toEqual(expect.arrayContaining(["total", "groups", "profile", "perLight", "savings"]));
    expect(review.checks.map(check => check.key)).toEqual(expect.arrayContaining(["stopped:linkway", "standout:2026-11-16"]));
  });
});

describe("each layout drawn from the sample site", () => {
  it.each<ReportLayout>(["review", "full", "management"])("draws the %s layout whole", async layout => {
    const text = await draw(layout);
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.querySelector(`[data-site-report-style="${layout}"]`)).not.toBeNull();
    expect(text).toContain("Sample site");
    expect(text).not.toMatch(/undefined|NaN|\{\w+\}/);
    expect(text.length).toBeGreaterThan(1500);
  });

  it("speaks the reader's language", async () => {
    const text = await draw("review", "zh-Hans");
    expect(text).toMatch(/[一-鿿]/);
    expect(text).not.toMatch(/undefined|NaN/);
  });
});

describe("the preview window", () => {
  it("closes on Esc without closing Create project behind it, and can choose the layout", async () => {
    const outer = vi.fn();
    const close = vi.fn();
    const choose = vi.fn();
    await act(async () => root.render(<dialog onCancel={outer}><ReportLayoutPreview layout="management" onClose={close} onChoose={choose} /></dialog>));
    const preview = container.querySelector('dialog[aria-label="Sample: Management review"]')!;
    expect(preview.textContent).toContain("Made-up readings for a sample site");
    await act(async () => { preview.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(close).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    await act(async () => Array.from(preview.querySelectorAll("button")).find(button => button.textContent === "Use this layout")!.click());
    expect(choose).toHaveBeenCalledTimes(1);
  });
});

