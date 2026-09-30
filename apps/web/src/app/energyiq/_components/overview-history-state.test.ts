import { describe, expect, it } from "vitest";

import {
  overviewHistoryStateFromSearchParams,
  overviewUrlWithHistory,
} from "./overview-history-state";

describe("Overview History URL state", () => {
  const current = "projectId=preschool-demo&scopeId=project&resource=electricity&grain=day";

  it("opens the active Project history without replacing the current Overview context", () => {
    expect(overviewUrlWithHistory(current, { open: true, selectedAnalysisId: null })).toBe(
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&history=1",
    );
  });

  it("deep-links one saved result and restores that modal state after reload", () => {
    const href = overviewUrlWithHistory(current, {
      open: true,
      selectedAnalysisId: "saved-analysis-2",
    });

    expect(href).toBe(
      "/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity&grain=day&history=1&savedAnalysisId=saved-analysis-2",
    );
    expect(overviewHistoryStateFromSearchParams(new URL(href, "http://energyiq.local").searchParams)).toEqual({
      open: true,
      selectedAnalysisId: "saved-analysis-2",
    });
  });

  it("closes History without changing the Current Overview context", () => {
    const withHistory = `${current}&history=1&savedAnalysisId=saved-analysis-2`;

    expect(overviewUrlWithHistory(withHistory, { open: false, selectedAnalysisId: null })).toBe(
      `/energyiq/overview?${current}`,
    );
  });
});
