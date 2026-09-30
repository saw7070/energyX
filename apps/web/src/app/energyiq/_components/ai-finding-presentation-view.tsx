import React from "react";

import type {
  AiFindingPresentation,
  AiPresentationBlock,
  AiPresentationValueItem,
} from "./ai-finding-presentation";

export function AiFindingPresentationView({ presentation }: { presentation?: AiFindingPresentation | null }) {
  if (!presentation || presentation.blocks.length === 0) return null;
  const primaryBlocks = presentation.blocks.filter((block) => block.prominence !== "supporting");
  const supportingBlocks = presentation.blocks.filter((block) => block.prominence === "supporting");
  return (
    <div
      className="mt-5"
      data-ai-presentation="true"
      aria-label="AI-selected visual explanation"
    >
      {primaryBlocks.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2" data-ai-presentation-primary="true">
          {primaryBlocks.map((block, index) => (
            <PresentationBlock key={`${block.type}-primary-${index}`} block={block} />
          ))}
        </div>
      ) : null}
      {supportingBlocks.length > 0 ? (
        <details className={`${primaryBlocks.length > 0 ? "mt-3 " : ""}rounded-xl border border-border bg-surface`} data-ai-supporting-visuals="true">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-inset">
            Supporting visuals ({supportingBlocks.length})
          </summary>
          <div className="grid gap-3 border-t border-border px-4 py-4 sm:grid-cols-2">
            {supportingBlocks.map((block, index) => (
              <PresentationBlock key={`${block.type}-${index + 1}`} block={block} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function PresentationBlock({ block }: { block: AiPresentationBlock }) {
  if (block.type === "metric") {
    return (
      <section data-presentation-type={block.type} className="rounded-xl border border-primary/15 bg-primary/[0.04] px-4 py-4">
        <p className="text-xs font-semibold text-muted">{block.label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">
          {formatValue(block.value)}{block.unit ? <>{" "}<span className="text-sm font-medium tracking-normal text-muted">{block.unit}</span></> : null}
        </p>
        {block.context ? <p className="mt-2 text-xs leading-5 text-muted">{block.context}</p> : null}
      </section>
    );
  }
  if (block.type === "callout") {
    return (
      <section data-presentation-type={block.type} className={`rounded-xl border px-4 py-4 ${calloutClass(block.tone)}`}>
        <p className="text-sm font-semibold leading-6">{block.text}</p>
      </section>
    );
  }
  if (block.type === "trend") return <TrendBlock block={block} />;
  if (block.type === "heatmap") return <HeatmapBlock block={block} />;
  if (block.type === "table") return <TableBlock block={block} />;
  return <BarBlock block={block} />;
}

function BarBlock({ block }: { block: Extract<AiPresentationBlock, { type: "comparison" | "ranking" | "share" | "distribution" }> }) {
  const total = block.items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const maximum = Math.max(...block.items.map((item) => Math.abs(item.value)), 1);
  return (
    <section data-presentation-type={block.type} className="rounded-xl border border-border bg-surface-subtle px-4 py-4 sm:col-span-2">
      {block.title ? <h5 className="text-sm font-semibold text-foreground">{block.title}</h5> : null}
      <div className={block.title ? "mt-4 space-y-3" : "space-y-3"}>
        {block.items.map((item, index) => {
          const width = block.type === "share"
            ? (total > 0 ? Math.max(2, (Math.max(0, item.value) / total) * 100) : 0)
            : Math.max(2, (Math.abs(item.value) / maximum) * 100);
          return (
            <div key={`${item.label}-${index}`}>
              <div className="flex items-baseline justify-between gap-4 text-xs">
                <span className="min-w-0 truncate font-medium text-foreground">{item.label}</span>
                <span className="shrink-0 tabular-nums text-muted">{formatWithUnit(item.value, block.unit)}</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${barTone(index, block.type)}`}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TrendBlock({ block }: { block: Extract<AiPresentationBlock, { type: "trend" }> }) {
  const values = block.points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const points = block.points.map((point, index) => {
    const x = block.points.length === 1 ? 300 : 24 + (index / (block.points.length - 1)) * 552;
    const y = 150 - ((point.value - minimum) / range) * 120;
    return `${x},${y}`;
  }).join(" ");
  return (
    <section data-presentation-type={block.type} className="rounded-xl border border-border bg-surface-subtle px-4 py-4 sm:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {block.title ? <h5 className="text-sm font-semibold text-foreground">{block.title}</h5> : <span />}
        <p className="text-xs tabular-nums text-muted">{formatWithUnit(values.at(-1) ?? 0, block.unit)}</p>
      </div>
      <svg viewBox="0 0 600 180" role="img" aria-label={block.title ?? "AI-selected trend"} className="mt-3 h-auto w-full overflow-visible">
        <title>{block.title ?? "AI-selected trend"}</title>
        <desc>{block.points.map((point) => `${point.label}: ${formatWithUnit(point.value, block.unit)}`).join("; ")}</desc>
        <line x1="24" y1="150" x2="576" y2="150" className="stroke-border" strokeWidth="1" />
        <polyline points={points} fill="none" className="stroke-primary" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {block.points.map((point, index) => {
          const [x, y] = points.split(" ")[index]!.split(",");
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="4" className="fill-surface stroke-primary" strokeWidth="3" />;
        })}
      </svg>
      <ul className="sr-only" data-presentation-a11y="trend">
        {block.points.map((point, index) => (
          <li key={`${point.label}-accessible-${index}`}>{point.label}: {formatWithUnit(point.value, block.unit)}</li>
        ))}
      </ul>
      <div className="mt-1 flex justify-between gap-4 text-[10px] text-muted">
        <span>{block.points[0]?.label}</span>
        <span>{block.points.at(-1)?.label}</span>
      </div>
    </section>
  );
}

function HeatmapBlock({ block }: { block: Extract<AiPresentationBlock, { type: "heatmap" }> }) {
  const flat = block.values.flat();
  const minimum = Math.min(...flat);
  const maximum = Math.max(...flat);
  const range = maximum - minimum || 1;
  return (
    <section data-presentation-type={block.type} className="overflow-x-auto rounded-xl border border-border bg-surface-subtle px-4 py-4 sm:col-span-2">
      {block.title ? <h5 className="text-sm font-semibold text-foreground">{block.title}</h5> : null}
      <div
        className="mt-4 min-w-max"
        role="grid"
        aria-label={block.title ?? "AI-selected heatmap"}
        style={{ display: "grid", gridTemplateColumns: `minmax(72px, auto) repeat(${block.xLabels.length}, minmax(24px, 1fr))`, gap: "4px" }}
      >
        <span />
        {block.xLabels.map((label) => <span key={label} role="columnheader" className="text-center text-[9px] text-muted">{label}</span>)}
        {block.yLabels.flatMap((label, rowIndex) => [
          <span key={`${label}-label`} role="rowheader" className="self-center truncate pr-2 text-[10px] font-medium text-muted">{label}</span>,
          ...block.values[rowIndex]!.map((value, columnIndex) => {
            const intensity = 0.12 + ((value - minimum) / range) * 0.72;
            const accessibleLabel = `${label}, ${block.xLabels[columnIndex]}: ${formatWithUnit(value, block.unit)}`;
            return (
              <span
                key={`${label}-${columnIndex}`}
                role="gridcell"
                aria-label={accessibleLabel}
                title={accessibleLabel}
                className="aspect-square min-h-6 rounded-[3px]"
                style={{ backgroundColor: `rgba(37, 99, 235, ${intensity})` }}
              ><span className="sr-only">{accessibleLabel}</span></span>
            );
          }),
        ])}
      </div>
    </section>
  );
}

function TableBlock({ block }: { block: Extract<AiPresentationBlock, { type: "table" }> }) {
  return (
    <section data-presentation-type={block.type} className="overflow-x-auto rounded-xl border border-border bg-surface-subtle px-4 py-4 sm:col-span-2">
      {block.title ? <h5 className="text-sm font-semibold text-foreground">{block.title}</h5> : null}
      <table className={`${block.title ? "mt-3" : ""} w-full min-w-[420px] text-left text-xs`}>
        <caption className="sr-only">{block.title ?? "AI-selected data table"}</caption>
        <thead><tr>{block.columns.map((column) => <th key={column} scope="col" className="border-b border-border px-2 py-2 font-semibold text-muted">{column}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-border/70 px-2 py-2.5 tabular-nums text-foreground">{typeof cell === "number" ? formatValue(cell) : cell}</td>)}</tr>)}</tbody>
      </table>
    </section>
  );
}

function formatValue(value: number): string {
  return value.toLocaleString("en-SG", { maximumFractionDigits: 2 });
}

function formatWithUnit(value: number, unit?: string): string {
  return `${formatValue(value)}${unit ? ` ${unit}` : ""}`;
}

function barTone(index: number, type: "comparison" | "ranking" | "share" | "distribution"): string {
  if (type === "comparison") return index === 0 ? "bg-primary" : "bg-blue-400";
  return ["bg-primary", "bg-blue-500", "bg-teal-500", "bg-amber-500", "bg-slate-400"][index % 5]!;
}

function calloutClass(tone: "insight" | "caution" | "positive" | "neutral"): string {
  if (tone === "caution") return "border-amber-200 bg-amber-50 text-amber-950";
  if (tone === "positive") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (tone === "insight") return "border-blue-200 bg-blue-50 text-blue-950";
  return "border-border bg-surface-subtle text-foreground";
}
