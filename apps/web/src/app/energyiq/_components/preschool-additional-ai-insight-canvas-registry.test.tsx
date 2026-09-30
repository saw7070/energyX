import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { InsightCanvasQuantitativeBlock } from "@datafoundry/contracts";

import { resolvePreschoolAdditionalCanvasRenderer } from "./preschool-additional-ai-insight-canvas-registry";

describe("Preschool Additional Insight Canvas renderer registry", () => {
  it.each(["metric", "comparison", "trend"] as const)(
    "renders only the registered %s primitive from accepted bindings",
    (visualization) => {
      const Renderer = resolvePreschoolAdditionalCanvasRenderer(visualization);
      expect(Renderer).not.toBeNull();
      if (!Renderer) throw new Error(`registered ${visualization} renderer required`);
      const markup = renderToStaticMarkup(<Renderer block={block(visualization)} />);

      expect(markup).toContain(`data-additional-canvas="${visualization}"`);
      expect(markup).toContain("31");
      expect(markup).toContain("preschool-project");
      expect(markup).not.toContain("dangerouslySetInnerHTML");
    },
  );

  it.each([
    "table",
    "custom-chart",
    "https://example.test/chart",
    "<script>alert(1)</script>",
  ])("has no renderer for an unregistered declaration: %s", (visualization) => {
    expect(resolvePreschoolAdditionalCanvasRenderer(visualization)).toBeNull();
  });
});

const block = (
  visualization: InsightCanvasQuantitativeBlock["visualization"],
): InsightCanvasQuantitativeBlock => ({
  id: `canvas-block:${visualization}`,
  kind: "quantitative",
  visualization,
  title: `${visualization} block`,
  bindings: [{
    evidenceRef: "fact:standby-share",
    entityId: "preschool-project",
    metricId: "energy.standby-share",
    value: 31,
    unit: "%",
  }],
});
