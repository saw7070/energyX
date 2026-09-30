import { expect, it } from "vitest";
import type { EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { projectExplorerMeters } from "./energy-explorer-meters.js";

it("uses published navigation attachments, preserves missing meters and separates overlapping reference/virtual meters", () => {
  const document = {
    project: { name: "Office", timezone: "Asia/Singapore" },
    tier_structure_locked: true,
    tiers: [],
    nodes: [],
    meter_mapping: {
      schema_version: 2,
      source_kind: "excel",
      confirmed: true,
      rows: [
        {
          id: "main",
          source_label: "main", aggregation_usage: "official",
          display_name: "DB main",
          presentation: { circuit_name: "DB1 L1 Power", group: "Total Power" },
          scope_id: "old",
          navigation_scope_id: "db",
          resource: "electricity",
          meter_role: "total",
          coverage: "whole",
          category: "overall",
        },
        {
          id: "missing",
          source_label: "missing", aggregation_usage: "excluded",
          display_name: "No readings",
          presentation: { device_name: "Director Room Power", circuit_name: "L1P15", group: "Plug Load" },
          scope_id: "db",
          resource: "electricity",
          meter_role: "component",
          coverage: "reference",
          category: "load",
        },
        {
          id: "outside",
          source_label: "outside", aggregation_usage: "official", coverage: "whole", category: "overall",
          display_name: "Other space",
          scope_id: "other",
          resource: "electricity",
          meter_role: "total",
        },
        {
          id: "water",
          source_label: "water", aggregation_usage: "official", coverage: "whole", category: "overall",
          display_name: "Water",
          scope_id: "db",
          resource: "water",
          meter_role: "total",
        },
      ],
      virtual_meters: [
        {
          id: "virtual",
          display_name: "Balance",
          scope_id: "db",
          resource: "electricity",
          category: "load",
          terms: [
            { mapping_row_id: "main", coefficient: 1 },
            { mapping_row_id: "missing", coefficient: -1 },
          ],
        },
      ],
    },
  } satisfies EnergyIqProjectSetupDocument;
  const meters = projectExplorerMeters({
    document,
    scopeIds: new Set(["db"]),
    resource: "electricity",
    officialMeterIds: new Set(["main"]),
  });
  expect(meters.map((meter) => meter.id)).toEqual([
    "main",
    "missing",
    "virtual",
  ]);
  expect(meters[0]).toMatchObject({
    scopeId: "db",
    name: "DB1 L1 Power",
    displayGroup: "Total Power",
    includedInOfficialTotal: true,
  });
  expect(meters[1]).toMatchObject({
    name: "Director Room Power",
    circuitName: "L1P15",
    displayGroup: "Plug Load",
    coverage: "reference",
    includedInOfficialTotal: false,
  });
  expect(meters[2]).toMatchObject({
    kind: "virtual",
    name: "Balance",
    formula: "DB1 L1 Power − Director Room Power",
    includedInOfficialTotal: false,
  });
});
