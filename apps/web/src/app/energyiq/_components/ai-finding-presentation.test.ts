import { describe, expect, it } from "vitest";

import { parseAiFindingPresentation } from "./ai-finding-presentation";

describe("parseAiFindingPresentation", () => {
  it("lets the analyst compose multiple useful blocks", () => {
    expect(parseAiFindingPresentation({
      version: "1",
      blocks: [
        { type: "metric", prominence: "primary", label: "Latest day", value: 418.2, unit: "kWh", evidenceRefs: ["horizon:1d"] },
        {
          type: "comparison",
          prominence: "supporting",
          title: "Current versus previous period",
          unit: "kWh",
          items: [
            { label: "Current", value: 2801 },
            { label: "Previous", value: 2450 },
          ],
          evidenceRefs: ["horizon:28d"],
        },
        {
          type: "callout",
          tone: "caution",
          text: "The increase is concentrated in closed hours.",
        },
      ],
    })).toEqual({
      version: "1",
      blocks: [
        { type: "metric", prominence: "primary", label: "Latest day", value: 418.2, unit: "kWh", evidenceRefs: ["horizon:1d"] },
        {
          type: "comparison",
          prominence: "supporting",
          title: "Current versus previous period",
          unit: "kWh",
          items: [
            { label: "Current", value: 2801 },
            { label: "Previous", value: 2450 },
          ],
          evidenceRefs: ["horizon:28d"],
        },
        {
          type: "callout",
          tone: "caution",
          text: "The increase is concentrated in closed hours.",
        },
      ],
    });
  });

  it("omits invalid blocks locally instead of rejecting the Finding", () => {
    expect(parseAiFindingPresentation({
      version: "1",
      blocks: [
        { type: "metric", label: "Broken", value: "not-a-number" },
        {
          type: "ranking",
          items: [
            { label: "Centre E", value: 549.36 },
            { label: "Centre N", value: 544.05 },
          ],
          evidenceSqlIndexes: [1],
        },
      ],
    })).toEqual({
      version: "1",
      blocks: [{
        type: "ranking",
        items: [
          { label: "Centre E", value: 549.36 },
          { label: "Centre N", value: 544.05 },
        ],
        evidenceSqlIndexes: [1],
      }],
    });
  });

  it("drops a quantitative block without its own Evidence binding", () => {
    expect(parseAiFindingPresentation({
      version: "1",
      blocks: [
        { type: "metric", label: "Unbound number", value: 42, unit: "kWh" },
        { type: "callout", tone: "insight", text: "Investigate the operating pattern." },
      ],
    })).toEqual({
      version: "1",
      blocks: [{ type: "callout", tone: "insight", text: "Investigate the operating pattern." }],
    });
  });

  it("allows the analyst to omit presentation when prose is clearer", () => {
    expect(parseAiFindingPresentation(undefined)).toBeNull();
    expect(parseAiFindingPresentation({ version: "1", blocks: [] })).toBeNull();
  });

  it("drops a block with an invalid presentation prominence", () => {
    expect(parseAiFindingPresentation({
      version: "1",
      blocks: [
        { type: "metric", prominence: "hero", label: "Invalid", value: 42, evidenceRefs: ["metric:invalid"] },
        { type: "callout", prominence: "primary", tone: "insight", text: "Keep this verified explanation." },
      ],
    })).toEqual({
      version: "1",
      blocks: [{ type: "callout", prominence: "primary", tone: "insight", text: "Keep this verified explanation." }],
    });
  });
});
