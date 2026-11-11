import type { EnergyIqProjectSetupDocument } from "@datafoundry/metadata";

export type EnergyExplorerMeter = {
  id: string;
  name: string;
  scopeId: string;
  kind: "physical" | "virtual";
  role: string;
  coverage: string;
  category: string;
  includedInOfficialTotal: boolean;
  formula?: string;
  displayGroup?: string;
  circuitName?: string;
  /** The installer's full label, set only when a short name is shown as `name` instead. */
  fullName?: string;
  /** The electrical panel the meter is wired from, when someone recorded it. */
  panel?: string;
};

/** Project only the already-authorized published mapping, including meters without facts. */
export function projectExplorerMeters(input: {
  document: EnergyIqProjectSetupDocument;
  scopeIds: ReadonlySet<string>;
  resource: "electricity" | "water";
  officialMeterIds: ReadonlySet<string>;
}): EnergyExplorerMeter[] {
  const mapping = input.document.meter_mapping;
  if (!mapping || mapping.schema_version !== 2 || !mapping.confirmed) return [];
  const labels = (meter: { display_name: string; presentation?: { group?: string; circuit_name?: string; device_name?: string; short_name?: string; panel?: string } }) => ({
    ...(meter.presentation?.group ? { displayGroup: meter.presentation.group } : {}),
    ...(meter.presentation?.circuit_name ? { circuitName: meter.presentation.circuit_name } : {}),
    ...(meter.presentation?.short_name?.trim() ? { fullName: projectMeterFullName(meter) } : {}),
    ...(meter.presentation?.panel?.trim() ? { panel: meter.presentation.panel.trim() } : {}),
  });
  const names = new Map(mapping.rows.map((row) => [row.id, projectMeterDisplayName(row)]));
  return [
    ...mapping.rows
      .filter(
        (row) =>
          row.resource === input.resource &&
          input.scopeIds.has(row.navigation_scope_id ?? row.scope_id),
      )
      .map((row) => ({
        id: row.id,
        name: projectMeterDisplayName(row),
        ...labels(row),
        scopeId: row.navigation_scope_id ?? row.scope_id,
        kind: "physical" as const,
        role: row.meter_role,
        coverage: row.coverage,
        category: row.category,
        includedInOfficialTotal: input.officialMeterIds.has(row.id),
      })),
    ...(mapping.virtual_meters ?? [])
      .filter(
        (meter) =>
          meter.resource === input.resource &&
          input.scopeIds.has(meter.scope_id),
      )
      .map((meter) => ({
        id: meter.id,
        name: projectMeterDisplayName(meter),
        ...labels(meter),
        scopeId: meter.scope_id,
        kind: "virtual" as const,
        role: "derived",
        coverage: "reference",
        category: meter.category,
        includedInOfficialTotal: false,
        formula: meter.terms
          .map(
            (term, index) =>
              `${term.coefficient === -1 ? "− " : index ? "+ " : ""}${names.get(term.mapping_row_id) ?? "Unknown input meter"}`,
          )
          .join(" "),
      })),
  ];
}

/** The name readers see first: the short name when someone set one, else the installer's full label. */
export function projectMeterDisplayName(meter: { display_name: string; presentation?: { device_name?: string; circuit_name?: string; short_name?: string } }): string {
  return meter.presentation?.short_name?.trim() || projectMeterFullName(meter);
}

/** The installer's full label, shown under a short name (or alone when there is none). */
export function projectMeterFullName(meter: { display_name: string; presentation?: { device_name?: string; circuit_name?: string } }): string {
  return meter.presentation?.device_name?.trim() || meter.presentation?.circuit_name?.trim() || meter.display_name?.trim() || "Unnamed meter";
}

/** Equipment, areas, grouped loads and main meters are all valid identities. */
export function projectMeterNamingReadiness(document?: EnergyIqProjectSetupDocument) {
  const mapping = document?.meter_mapping;
  const rows = [...(mapping?.rows ?? []), ...(mapping?.virtual_meters ?? [])].filter(row => row.resource === "electricity");
  const missing = rows.filter(row => {
    const label = projectMeterDisplayName(row);
    return label === row.id || /^(?:(?:panel|db)\s*[-a-z0-9]+\s+)?(?:meter|device|circuit|channel|电表|设备|回路)\s*[-_#]?\s*0*\d+$/i.test(label)
      || /^(unnamed|unknown|unassigned|device name needs confirmation|待确认|未命名)(?:\s.*)?$/i.test(label);
  }).map(row => ({ meterId: row.id, sourceLabel: row.display_name, displayName: projectMeterDisplayName(row) }));
  return { ready: !!mapping?.confirmed && rows.length > 0 && missing.length === 0, missing,
    question: "What equipment, area or total does each listed meter measure? Reply in words or upload a labelled drawing. Publish confirmed names before creating a report." };
}
