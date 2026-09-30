import { describe, expect, it } from "vitest";
import { analysisLinkTarget } from "./analysis-view";
import { analysisHref } from "./key-points";

describe("Overview headline link to Analysis", () => {
  it("opens the same dates as the report, at the step that explains the headline", () => {
    const period = { from: "2026-08-14", toExclusive: "2026-09-11" };
    const href = new URL(analysisHref("tuya-office", period, "About S$655 of the estimated S$868 monthly bill pays for equipment that stays on around the clock, even when nobody is there."), "http://x");
    expect(href.pathname).toBe("/energyiq/analysis");
    expect(Object.fromEntries(href.searchParams)).toEqual({ projectId: "tuya-office", from: "2026-08-14", to: "2026-09-10", section: "story-on" });
    expect(new URL(analysisHref("p", null, "Energy use rose 12% this month."), "http://x").searchParams.get("section")).toBe("story-title");
  });
  it("accepts only well-formed dates and story sections from a link", () => {
    expect(analysisLinkTarget(new URLSearchParams("from=2026-08-14&to=2026-09-10&section=story-on"))).toEqual({ range: { kind: "custom", from: "2026-08-14", to: "2026-09-10" }, section: "story-on" });
    expect(analysisLinkTarget(new URLSearchParams("from=2026-09-10&to=2026-08-14&section=javascript:alert(1)"))).toEqual({ range: null, section: null });
    expect(analysisLinkTarget(null)).toEqual({ range: null, section: null });
  });
});
