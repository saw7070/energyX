import { describe, expect, it } from "vitest";

import { deriveProjectDeliveryProgress } from "./project-delivery-progress";

const baseSignals = {
  hasBasics: true,
  hasStructure: true,
  hasSource: false,
  hasConfirmedMapping: false,
  hasMaterializedFacts: false,
  hasAnalysisConfiguration: false,
  hasPublishedRevision: false,
};

describe("deriveProjectDeliveryProgress", () => {
  it("sends a structured project to its first data source", () => {
    const progress = deriveProjectDeliveryProgress(baseSignals);

    expect(progress.nextLabel).toBe("Connect the first data source");
    expect(progress.stages[2]?.state).toBe("Not configured");
  });

  it("opens Review & Publish after analysis configuration is available", () => {
    const progress = deriveProjectDeliveryProgress({
      ...baseSignals,
      hasSource: true,
      hasConfirmedMapping: true,
      hasMaterializedFacts: true,
      hasAnalysisConfiguration: true,
    });

    expect(progress.nextSection).toBe("project-overview");
    expect(progress.nextLabel).toBe("Review and publish");
    expect(progress.stages[3]?.state).toBe("Configured");
    expect(progress.stages[4]).toMatchObject({ state: "Ready", enabled: true });
  });

  it("sends an inspected source to meter mapping", () => {
    const progress = deriveProjectDeliveryProgress({ ...baseSignals, hasSource: true });

    expect(progress.nextSection).toBe("meter-mapping");
    expect(progress.nextLabel).toBe("Complete meter mapping");
    expect(progress.stages[2]?.state).toBe("Source inspected");
  });

  it("sends confirmed mapping back to data sources to build facts", () => {
    const progress = deriveProjectDeliveryProgress({
      ...baseSignals,
      hasSource: true,
      hasConfirmedMapping: true,
    });

    expect(progress.nextSection).toBe("data-sources");
    expect(progress.nextLabel).toBe("Build interval facts");
    expect(progress.stages[2]?.state).toBe("Mapping confirmed");
  });

  it("opens analysis only after facts are materialized", () => {
    const progress = deriveProjectDeliveryProgress({
      ...baseSignals,
      hasSource: true,
      hasConfirmedMapping: true,
      hasMaterializedFacts: true,
    });

    expect(progress.nextSection).toBe("templates");
    expect(progress.nextLabel).toBe("Configure analysis");
    expect(progress.stages[2]?.state).toBe("Facts ready");
    expect(progress.stages[3]?.state).toBe("Ready to configure");
  });
});
