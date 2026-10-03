"use client";
import { ResponsiveContainer, Sankey, Tooltip, type SankeyLinkProps, type SankeyNodeProps } from "recharts";
import type { AnalysisData, ScopeData } from "./analysis-data";
import { CATEGORY_COLORS, CATEGORY_ORDER, type AnalysisCategory } from "./analysis-model";
import { categoryLabel } from "./analysis-messages";
import { energyFlowMessages } from "./energy-flow-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";

export type FlowNode = { name: string; kind: "site" | "space" | "unsplit" | "type"; category?: AnalysisCategory };
export type FlowData = { nodes: FlowNode[]; links: Array<{ source: number; target: number; value: number }>; totalKwh: number };

/** Below this share a remainder is rounding between meters, not a flow worth a band. */
const MIN_SHARE = 0.005;

/**
 * Site total → each space → its types of use. Energy the spaces' meters do not account for becomes one "not measured
 * by space" band, and a space's energy without a type goes to "Other", so every band adds up to the site total.
 */
export function energyFlowData(project: ScopeData, spaces: ScopeData[], words: { site: string; unsplit: string; type: (category: AnalysisCategory) => string }): FlowData | null {
  const total = project.usageKwh ?? 0;
  const measured = spaces.filter(space => (space.usageKwh ?? 0) > 0);
  if (total <= 0 || measured.length === 0) return null;
  const nodes: FlowNode[] = [{ name: words.site, kind: "site" }];
  const links: FlowData["links"] = [];
  const typeIndex = new Map<AnalysisCategory, number>();
  const typeNode = (category: AnalysisCategory) => {
    if (!typeIndex.has(category)) { typeIndex.set(category, nodes.length); nodes.push({ name: words.type(category), kind: "type", category }); }
    return typeIndex.get(category)!;
  };
  // A space's split by type; whatever its typed meters miss is "other".
  const split = (kwh: number, types: Partial<Record<AnalysisCategory, number>>) => {
    const typed = CATEGORY_ORDER.map(category => [category, Math.max(0, types[category] ?? 0)] as const).filter(([, value]) => value > 0);
    const sum = typed.reduce((acc, [, value]) => acc + value, 0);
    // Typed meters can overlap a little with the space total; scale down rather than overflow the band.
    const scale = sum > kwh ? kwh / sum : 1;
    const parts = typed.map(([category, value]) => [category, value * scale] as const);
    const rest = kwh - parts.reduce((acc, [, value]) => acc + value, 0);
    return rest > kwh * MIN_SHARE ? [...parts.filter(([category]) => category !== "other"), ["other" as const, rest + (parts.find(([category]) => category === "other")?.[1] ?? 0)] as const] : parts;
  };
  const addBranch = (node: FlowNode, kwh: number, types: Partial<Record<AnalysisCategory, number>>) => {
    const index = nodes.length;
    nodes.push(node);
    links.push({ source: 0, target: index, value: kwh });
    for (const [category, value] of split(kwh, types)) {
      if (value > total * MIN_SHARE / 10) links.push({ source: index, target: typeNode(category), value });
    }
  };
  const spaceSum = measured.reduce((acc, space) => acc + space.usageKwh!, 0);
  const scale = spaceSum > total ? total / spaceSum : 1;
  for (const space of [...measured].sort((left, right) => right.usageKwh! - left.usageKwh!)) {
    const kwh = space.usageKwh! * scale;
    const types = Object.fromEntries(Object.entries(space.typeTotals).map(([category, value]) => [category, (value ?? 0) * scale]));
    addBranch({ name: space.name, kind: "space" }, kwh, types);
  }
  const unsplit = total - spaceSum * scale;
  if (unsplit > total * MIN_SHARE) {
    const types = Object.fromEntries(CATEGORY_ORDER.map(category => [category,
      Math.max(0, (project.typeTotals[category] ?? 0) - measured.reduce((acc, space) => acc + (space.typeTotals[category] ?? 0) * scale, 0))]));
    addBranch({ name: words.unsplit, kind: "unsplit" }, unsplit, types);
  }
  return { nodes, links, totalKwh: total };
}

const NODE_COLORS = { site: "#276854", space: "#5f7f72", unsplit: "#b6c2bc" } as const;

/** One plain sentence a reader can take away without reading the chart: the biggest space and the biggest use. */
export function energyFlowSummary(flow: FlowData): { space?: { name: string; share: number }; type?: { category: AnalysisCategory; share: number } } {
  const into = (index: number) => flow.links.filter(link => link.target === index).reduce((sum, link) => sum + link.value, 0);
  const share = (kwh: number) => Math.round(kwh / flow.totalKwh * 100);
  const spaces = flow.nodes.map((node, index) => ({ node, kwh: into(index) })).filter(({ node }) => node.kind === "space").sort((a, b) => b.kwh - a.kwh);
  const types = flow.nodes.map((node, index) => ({ node, kwh: into(index) })).filter(({ node }) => node.kind === "type").sort((a, b) => b.kwh - a.kwh);
  return {
    ...(spaces[0] ? { space: { name: spaces[0].node.name, share: share(spaces[0].kwh) } } : {}),
    ...(types[0]?.node.category ? { type: { category: types[0].node.category, share: share(types[0].kwh) } } : {}),
  };
}

export function EnergyFlow({ data }: { data: AnalysisData }) {
  const t = useMessages(energyFlowMessages);
  const { locale } = useEnergyIqLocale();
  const flow = energyFlowData(data.current.project, data.current.spaces, {
    site: t("site"),
    unsplit: t("unsplit"),
    type: category => categoryLabel(category, locale),
  });
  const number = (value: number) => value.toLocaleString(intlLocale(locale), { maximumFractionDigits: value < 100 ? 1 : 0 });
  const percent = (value: number) => flow ? `${Math.round(value / flow.totalKwh * 100)}%` : "";
  const summary = flow ? energyFlowSummary(flow) : {};
  return <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <h3 className="text-sm font-semibold text-slate-900">{t("title")}</h3>
    <p className="mt-1 text-sm text-slate-600">{t("body")}</p>
    {flow && (summary.space || summary.type) ? <p className="mt-2 text-sm text-slate-900">
      {summary.space ? t("summarySpace", { space: summary.space.name, share: String(summary.space.share) }) : ""}{" "}
      {summary.type ? t("summaryType", { type: categoryLabel(summary.type.category, locale), share: String(summary.type.share) }) : ""}
    </p> : null}
    {!flow ? <p className="mt-3 text-sm text-slate-600">{t("needsSpaces")}</p>
      : <>
        <div className="mt-3 grid grid-cols-3 text-[11px] font-medium uppercase tracking-wide text-slate-500" aria-hidden>
          <span>{t("columnSite")}</span><span className="text-center">{t("columnSpaces")}</span><span className="text-right">{t("columnUses")}</span>
        </div>
        <div className="mt-1 h-80 w-full" role="img" aria-label={t("chartLabel")}>
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={flow}
              nodePadding={18}
              nodeWidth={12}
              margin={{ top: 8, right: 170, bottom: 8, left: 8 }}
              link={(props: SankeyLinkProps) => <FlowLink {...props} />}
              node={(props: SankeyNodeProps) => <FlowNodeShape {...props} payload={props.payload as unknown as FlowNode & { value?: number }} label={(node) => `${node.name} · ${number(node.value ?? 0)} kWh (${percent(node.value ?? 0)})`} />}
              iterations={0}
            >
              <Tooltip content={({ payload }) => {
                const item = payload?.[0]?.payload as { payload?: { source?: FlowNode; target?: FlowNode; value?: number; name?: string; kind?: string; value_?: number } } | undefined;
                const link = item?.payload;
                if (!link?.value) return null;
                const text = link.source && link.target ? t("tooltipLink", { from: link.source.name, to: link.target.name }) : link.name ?? "";
                return <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 shadow-sm">
                  <p className="font-medium">{text}</p>
                  <p>{t("tooltip", { kwh: number(link.value), share: percent(link.value).replace("%", "") })}</p>
                </div>;
              }} />
            </Sankey>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-slate-500">{t("howToRead")}</p>
      </>}
  </section>;
}

/** A band coloured by what its energy is used for, so each use can be followed back to the spaces it comes from. */
function FlowLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }: SankeyLinkProps) {
  const target = payload.target as unknown as FlowNode;
  const color = target.kind === "type" && target.category ? CATEGORY_COLORS[target.category] : "#9fbcae";
  return <path
    d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
    fill="none"
    stroke={color}
    strokeOpacity={target.kind === "type" ? 0.45 : 0.3}
    strokeWidth={Math.max(linkWidth, 1)}
  />;
}

type FlowNodeProps = { x?: number; y?: number; width?: number; height?: number; payload?: FlowNode & { value?: number } };
function FlowNodeShape({ x = 0, y = 0, width = 0, height = 0, payload, label }: FlowNodeProps & { label: (node: FlowNode & { value?: number }) => string }) {
  if (!payload) return null;
  const fill = payload.kind === "type" && payload.category ? CATEGORY_COLORS[payload.category] : NODE_COLORS[payload.kind as keyof typeof NODE_COLORS];
  // Labels sit on a white backing so a band passing behind does not make them hard to read.
  const text = label(payload);
  const labelX = x + width + 6;
  return <g>
    <rect x={x} y={y} width={width} height={Math.max(height, 1)} fill={fill} rx={2} />
    <rect x={labelX - 3} y={y + height / 2 - 9} width={text.length * 6.2 + 6} height={18} rx={3} fill="#ffffff" fillOpacity={0.85} />
    <text x={labelX} y={y + height / 2} dominantBaseline="middle" fontSize={12} fill="#1e293b">{text}</text>
  </g>;
}
