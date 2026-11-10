/**
 * The advisor's view of the project's groups: meters filed by what they serve, each group with the energy it used in
 * the analysis period and its share of the group above. A meter counts only in its own group, wherever it is wired
 * from, so the advisor can say "the Entrance is the biggest share of the common area and has no sub-meter below it"
 * without guessing from panel names.
 *
 * The figures come from the very CSV the advisor is given, read before it is compressed, so they always match it.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { buildMeterGroupTree, type MeterGroupNode } from "@datafoundry/site-report";
import { projectMeterDisplayName, projectMeterFullName } from "../energy/energy-explorer-meters.js";

export type MeterUsage = { byMeter: Map<string, number>; officialKwh: number };

/** One CSV line into fields, honouring double-quoted fields with doubled quotes inside. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") { field += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { fields.push(field); field = ""; }
    else field += char;
  }
  fields.push(field);
  return fields;
}

/**
 * Each meter's accepted usage in the period (usage_kwh on rows whose quality is ok or gap), and the official total
 * (the same rows, only where official_aggregation_eligible). Missing columns read as no usage rather than failing.
 */
export async function meterUsageFromCsv(path: string): Promise<MeterUsage> {
  const byMeter = new Map<string, number>();
  let officialKwh = 0;
  let columns: { meter: number; usage: number; quality: number; official: number } | null = null;
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const fields = splitCsvLine(line);
    if (!columns) {
      const at = (name: string) => fields.indexOf(name);
      columns = { meter: at("meter_node_id"), usage: at("usage_kwh"), quality: at("quality_status"), official: at("official_aggregation_eligible") };
      continue;
    }
    if (columns.meter < 0 || columns.usage < 0) continue;
    const usage = Number(fields[columns.usage]);
    const quality = columns.quality < 0 ? "ok" : fields[columns.quality];
    if (fields[columns.usage] === "" || !Number.isFinite(usage) || (quality !== "ok" && quality !== "gap")) continue;
    const meter = fields[columns.meter]!;
    byMeter.set(meter, (byMeter.get(meter) ?? 0) + usage);
    if (columns.official >= 0 && /^(true|1)$/i.test(fields[columns.official] ?? "")) officialKwh += usage;
  }
  return { byMeter, officialKwh };
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

type AdvisorGroup = {
  id: string; name: string; path: string; kWh: number; sharePctOfParent: number; parent: string; meterCount: number;
  singleMeter: boolean; meters: Array<{ meterId: string; displayName: string; fullName?: string; panel?: string; kWh: number; sharePctOfGroup: number }>;
  groups: AdvisorGroup[];
};

/**
 * The group tree for the advisor, or null when the project has no groups or no usage was read. Main meters (whole-site
 * totals) are left out of the parts, so the groups never count the same energy twice; what the main meter recorded
 * beyond the sub-meters is reported as `notMeasuredBySubMeterKWh`.
 */
export function advisorMeterGroups(document: EnergyIqProjectSetupDocument | undefined, usage: MeterUsage | null) {
  const nodes = document?.nodes ?? [];
  const rows = (document?.meter_mapping?.rows ?? []).filter(row => row.resource === "electricity");
  if (!usage || !nodes.length || !rows.length) return null;
  const isMain = (row: typeof rows[number]) => row.category === "overall" || row.meter_role === "total";
  const parts = rows.filter(row => !isMain(row));
  const tree = buildMeterGroupTree({
    groups: nodes.map(node => ({ id: node.id, name: node.name, parentId: node.parent_id ?? null })),
    meters: parts.map(row => ({
      id: row.id, name: projectMeterDisplayName(row), groupId: row.navigation_scope_id ?? row.scope_id, kwh: usage.byMeter.get(row.id) ?? 0,
      ...(row.presentation?.short_name?.trim() ? { fullName: projectMeterFullName(row) } : {}),
      ...(row.presentation?.panel?.trim() ? { panel: row.presentation.panel.trim() } : {}),
    })),
    name: document?.project.name ?? "Project",
    totalKwh: usage.officialKwh,
    unmeteredLabel: "Not measured by a sub-meter",
  });
  const convert = (node: MeterGroupNode, parent: MeterGroupNode, path: string[]): AdvisorGroup => ({
    id: node.id, name: node.name, path: [...path, node.name].join(" › "), kWh: round(node.kwh, 4), sharePctOfParent: round(node.share * 100, 1), parent: parent.name,
    meterCount: node.meterCount, singleMeter: node.singleMeter,
    meters: node.meters.filter(meter => !meter.unmetered).map(meter => ({ meterId: meter.id, displayName: meter.name, ...(meter.fullName ? { fullName: meter.fullName } : {}), ...(meter.panel ? { panel: meter.panel } : {}), kWh: round(meter.kwh, 4), sharePctOfGroup: round(meter.share * 100, 1) })),
    groups: node.children.map(child => convert(child, node, [...path, node.name])),
  });
  return {
    basis: "analysis_period",
    totalKWh: round(tree.kwh, 4),
    notMeasuredBySubMeterKWh: round(tree.unmeteredKwh, 4),
    groups: tree.children.map(child => convert(child, tree, [])),
    metersNotInAGroup: tree.meters.filter(meter => !meter.unmetered).map(meter => ({ meterId: meter.id, displayName: meter.name, kWh: round(meter.kwh, 4) })),
    instructions: "Groups file meters by what they serve, not by the electrical panel they are wired from. A meter counts only in its own group. Describe where energy goes by group name with kWh and share of the group above (sharePctOfParent). singleMeter=true means one meter measures the whole group, so it has no sub-meter below it: say so instead of guessing what inside it uses the energy. Panels are wiring details only. kWh is accepted usage_kwh (quality ok or gap) in the analysis period from meter-intervals.csv; main meters are not added to the groups.",
  };
}
