import React, { type ComponentType } from "react";

import type { InsightCanvasQuantitativeBlock } from "@datafoundry/contracts";

type CanvasRenderer = ComponentType<{ block: InsightCanvasQuantitativeBlock }>;

const PRESCHOOL_ADDITIONAL_CANVAS_RENDERERS = {
  metric: MetricCanvasBlock,
  comparison: ComparisonCanvasBlock,
  trend: TrendCanvasBlock,
} satisfies Record<InsightCanvasQuantitativeBlock["visualization"], CanvasRenderer>;

export function resolvePreschoolAdditionalCanvasRenderer(value: unknown): CanvasRenderer | null {
  if (typeof value !== "string"
    || !Object.prototype.hasOwnProperty.call(PRESCHOOL_ADDITIONAL_CANVAS_RENDERERS, value)) return null;
  return PRESCHOOL_ADDITIONAL_CANVAS_RENDERERS[value as InsightCanvasQuantitativeBlock["visualization"]];
}

function MetricCanvasBlock({ block }: { block: InsightCanvasQuantitativeBlock }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3" data-additional-canvas="metric" aria-label={block.title}>
      <p className="text-xs font-semibold text-muted">{block.title}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        {block.bindings.map((binding) => (
          <div key={`${binding.evidenceRef}:${binding.entityId}`} className="rounded-lg bg-surface-subtle px-3 py-2">
            <p className="text-lg font-semibold text-foreground">{formatCanvasValue(binding.value)} {binding.unit}</p>
            <p className="mt-0.5 text-[10px] text-muted">{binding.entityId}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ComparisonCanvasBlock({ block }: { block: InsightCanvasQuantitativeBlock }) {
  const maximum = Math.max(...block.bindings.map(({ value }) => Math.abs(value)), 1);
  return (
    <section className="rounded-lg border border-border bg-surface p-3" data-additional-canvas="comparison" aria-label={block.title}>
      <p className="text-xs font-semibold text-muted">{block.title}</p>
      <ul className="mt-3 space-y-2">
        {block.bindings.map((binding) => (
          <li key={`${binding.evidenceRef}:${binding.entityId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs">
            <div>
              <div className="flex items-center justify-between gap-2"><span>{binding.entityId}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.abs(binding.value) / maximum * 100)}%` }} />
              </div>
            </div>
            <span className="font-semibold text-foreground">{formatCanvasValue(binding.value)} {binding.unit}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrendCanvasBlock({ block }: { block: InsightCanvasQuantitativeBlock }) {
  const values = block.bindings.map(({ value }) => value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const denominator = Math.max(block.bindings.length - 1, 1);
  const points = block.bindings.map(({ value }, index) => `${index / denominator * 100},${40 - (value - minimum) / span * 36}`).join(" ");
  return (
    <section className="rounded-lg border border-border bg-surface p-3" data-additional-canvas="trend" aria-label={block.title}>
      <p className="text-xs font-semibold text-muted">{block.title}</p>
      <svg className="mt-2 h-12 w-full text-primary" viewBox="0 0 100 44" role="img" aria-label={`${block.title} trend`} preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-2 text-[10px] leading-4 text-muted">
        {block.bindings.map(({ entityId, value, unit }) => `${entityId}: ${formatCanvasValue(value)} ${unit}`).join(" · ")}
      </p>
    </section>
  );
}

function formatCanvasValue(value: number): string {
  return new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 }).format(value);
}
