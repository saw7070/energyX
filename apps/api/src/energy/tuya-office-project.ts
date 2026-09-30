import { TUYA_OFFICE_METER_PRESENTATION } from "./tuya-office-meter-presentation.js";
import type { EnergyIqProjectSetupDocument } from "@datafoundry/metadata";

import type { TuyaDeviceBinding } from "./tuya-openapi-client.js";

export const TUYA_OFFICE_PROJECT_ID = "tuya-office" as const;
export const TUYA_OFFICE_WORKSPACE_ID = "tuya-office" as const;

type TuyaOfficeMeter = {
  id: string;
  sourceLabel: string;
  boardId: "tuya-office-db1" | "tuya-office-db2" | "tuya-office-db3";
  displayName: string;
  category: "load" | "light" | "other";
  coverage: "whole" | "partial";
  meterRole: "total" | "component";
  aggregationUsage: "official" | "excluded";
};

const meters: readonly TuyaOfficeMeter[] = [
  meter("panel-a-total", "Panel A Total", "tuya-office-db1", "Panel A Total", "load", "whole", "total", "official"),
  meter("panel-a-lighting", "Panel A Lighting", "tuya-office-db1", "Panel A Lighting", "light", "whole", "total", "official"),
  meter("panel-a-meter-03", "Panel A Meter 03", "tuya-office-db1", "Meter 03", "load"),
  meter("panel-a-meter-04", "Panel A Meter 04", "tuya-office-db1", "Meter 04", "load"),
  meter("panel-a-meter-05", "Panel A Meter 05", "tuya-office-db1", "Meter 05", "load"),
  meter("panel-a-meter-06", "Panel A Meter 06", "tuya-office-db1", "Meter 06", "load"),
  meter("panel-a-meter-07", "Panel A Meter 07", "tuya-office-db1", "Meter 07", "load"),

  meter("panel-b-total", "Panel B Total", "tuya-office-db2", "Panel B Total", "load", "whole", "total", "official"),
  meter("panel-b-lighting", "Panel B Lighting", "tuya-office-db2", "Panel B Lighting", "light", "whole", "total", "official"),
  meter("panel-b-meter-03", "Panel B Meter 03", "tuya-office-db2", "Meter 03", "load"),
  meter("panel-b-meter-04", "Panel B Meter 04", "tuya-office-db2", "Meter 04", "load"),
  meter("panel-b-meter-05", "Panel B Meter 05", "tuya-office-db2", "Meter 05", "load"),
  meter("panel-b-meter-06", "Panel B Meter 06", "tuya-office-db2", "Meter 06", "load"),
  meter("panel-b-meter-07", "Panel B Meter 07", "tuya-office-db2", "Meter 07", "load"),
  meter("panel-b-meter-08", "Panel B Meter 08", "tuya-office-db2", "Meter 08", "load"),
  meter("panel-b-meter-09", "Panel B Meter 09", "tuya-office-db2", "Meter 09", "load"),
  meter("panel-b-meter-10", "Panel B Meter 10", "tuya-office-db2", "Meter 10", "load"),

  meter("panel-c-meter-01", "Panel C Meter 01", "tuya-office-db3", "Meter 01", "other", "partial", "component", "official"),
  meter("panel-c-meter-02", "Panel C Meter 02", "tuya-office-db3", "Meter 02", "other", "partial", "component", "official"),
  meter("panel-c-meter-03", "Panel C Meter 03", "tuya-office-db3", "Meter 03", "other", "partial", "component", "official"),
] as const;

/** Synthetic bindings are test fixtures only. Production bindings come from protected Connector configuration. */
export const TUYA_OFFICE_EXAMPLE_DEVICE_BINDINGS: readonly TuyaDeviceBinding[] = meters.map((value, index) => ({
  deviceId: `exampledevice${String(index + 1).padStart(3, "0")}`,
  sourceLabel: value.sourceLabel,
}));

export const TUYA_OFFICE_METER_POINTS: ReadonlyArray<{
  meterPointId: string;
  sourceLabel: string;
}> = meters.map((value) => ({
  meterPointId: value.id,
  sourceLabel: value.sourceLabel,
}));

export const buildTuyaOfficeSetup = (): EnergyIqProjectSetupDocument => ({
  project: {
    name: "Tuya Office",
    timezone: "Asia/Singapore",
  },
  tier_structure_locked: true,
  tiers: [
    {
      id: "tuya-office-tier-distribution-board",
      ordinal: 1,
      alias: "Distribution Board",
      description: "Electrical distribution board used as the lowest structural analysis scope.",
    },
    {
      id: "tuya-office-tier-space",
      ordinal: 2,
      alias: "Space",
      description: "Office or showroom area that owns one or more distribution boards.",
    },
  ],
  nodes: [
    node("tuya-office-space-1", "tuya-office-tier-space", "Space 1 - Office Area", 10),
    node("tuya-office-space-2", "tuya-office-tier-space", "Space 2 - Shared Area", 20),
    node("tuya-office-db1", "tuya-office-tier-distribution-board", "DB1", 10, "tuya-office-space-1"),
    node("tuya-office-db2", "tuya-office-tier-distribution-board", "DB2", 10, "tuya-office-space-2"),
    node("tuya-office-db3", "tuya-office-tier-distribution-board", "DB3", 20, "tuya-office-space-2"),
  ],
  meter_mapping: {
    schema_version: 2,
    source_kind: "tuya",
    confirmed: true,
    rows: meters.map((value) => ({
      id: value.id,
      source_label: value.sourceLabel,
      scope_id: value.boardId,
      navigation_scope_id: value.boardId,
      display_name: value.displayName,
      presentation: TUYA_OFFICE_METER_PRESENTATION[value.id]!,
      resource: "electricity" as const,
      category: value.category,
      coverage: value.coverage,
      meter_role: value.meterRole,
      aggregation_usage: value.aggregationUsage,
    })),
    official_aggregation_routes: [
      route("tuya-office-db1", "load", ["panel-a-total"]),
      route("tuya-office-db1", "light", ["panel-a-lighting"]),
      route("tuya-office-space-1", "load", ["panel-a-total"]),
      route("tuya-office-space-1", "light", ["panel-a-lighting"]),
      route("tuya-office-db2", "load", ["panel-b-total"]),
      route("tuya-office-db2", "light", ["panel-b-lighting"]),
      route("tuya-office-db3", "other", ["panel-c-meter-01", "panel-c-meter-02", "panel-c-meter-03"]),
      route("tuya-office-space-2", "load", ["panel-b-total"]),
      route("tuya-office-space-2", "light", ["panel-b-lighting"]),
      route("tuya-office-space-2", "other", ["panel-c-meter-01", "panel-c-meter-02", "panel-c-meter-03"]),
      route("project", "load", ["panel-a-total", "panel-b-total"]),
      route("project", "light", ["panel-a-lighting", "panel-b-lighting"]),
      route("project", "other", ["panel-c-meter-01", "panel-c-meter-02", "panel-c-meter-03"]),
    ],
    virtual_meters: [
      {
        id: "tuya-office-db1-other-load",
        presentation: TUYA_OFFICE_METER_PRESENTATION["tuya-office-db1-other-load"]!,
        display_name: "DB1 Other Load",
        scope_id: "tuya-office-db1",
        resource: "electricity",
        category: "load",
        terms: [
          term("panel-a-total", 1),
          term("panel-a-meter-03", -1),
          term("panel-a-meter-04", -1),
          term("panel-a-meter-05", -1),
          term("panel-a-meter-06", -1),
          term("panel-a-meter-07", -1),
        ],
      },
      {
        id: "tuya-office-db2-other-load",
        presentation: TUYA_OFFICE_METER_PRESENTATION["tuya-office-db2-other-load"]!,
        display_name: "DB2 Other Load",
        scope_id: "tuya-office-db2",
        resource: "electricity",
        category: "load",
        terms: [
          term("panel-b-total", 1),
          term("panel-b-meter-03", -1),
          term("panel-b-meter-04", -1),
          term("panel-b-meter-05", -1),
          term("panel-b-meter-06", -1),
          term("panel-b-meter-07", -1),
          term("panel-b-meter-08", -1),
          term("panel-b-meter-09", -1),
          term("panel-b-meter-10", -1),
        ],
      },
      {
        id: "tuya-office-db3-led-total",
        presentation: TUYA_OFFICE_METER_PRESENTATION["tuya-office-db3-led-total"]!,
        display_name: "Panel C Meter Total",
        scope_id: "tuya-office-db3",
        resource: "electricity",
        category: "other",
        terms: [
          term("panel-c-meter-01", 1),
          term("panel-c-meter-02", 1),
          term("panel-c-meter-03", 1),
        ],
      },
    ],
  },
});

function meter(
  id: string,
  sourceLabel: string,
  boardId: TuyaOfficeMeter["boardId"],
  displayName: string,
  category: TuyaOfficeMeter["category"],
  coverage: TuyaOfficeMeter["coverage"] = "partial",
  meterRole: TuyaOfficeMeter["meterRole"] = "component",
  aggregationUsage: TuyaOfficeMeter["aggregationUsage"] = "excluded",
): TuyaOfficeMeter {
  return { id, sourceLabel, boardId, displayName, category, coverage, meterRole, aggregationUsage };
}

function node(
  id: string,
  tierDefinitionId: string,
  name: string,
  sortOrder: number,
  parentId?: string,
): EnergyIqProjectSetupDocument["nodes"][number] {
  return {
    id,
    tier_definition_id: tierDefinitionId,
    ...(parentId ? { parent_id: parentId } : {}),
    name,
    sort_order: sortOrder,
    metadata_status: "confirmed",
  };
}

function route(
  scopeId: string,
  category: "load" | "light" | "other",
  meterPointIds: string[],
) {
  return { scope_id: scopeId, resource: "electricity" as const, category, meter_point_ids: meterPointIds };
}

function term(mappingRowId: string, coefficient: 1 | -1) {
  return { mapping_row_id: mappingRowId, coefficient };
}
