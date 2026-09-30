import { describe, expect, it } from "vitest";

import type { EnergyImportBatchDto, EnergyProjectSetupDocumentDto } from "../../../lib/config-api";

import {
  addNode,
  addParentTier,
  applyMeterMappingRowEdit,
  branchNodeCount,
  buildAggregationReview,
  canLockTierStructure,
  createInitialMeterMapping,
  createMeterMappingFromSourceLabels,
  evaluateEnergyImportMaterializationGuard,
  hasSiblingNameConflict,
  inferMeterCategory,
  initialTierSelection,
  isTierStructureLocked,
  nodePathLabel,
  nodesForTierAndParent,
  pinEnergySourceManifest,
  removeNodeAndDescendants,
  removeHighestTier,
  sourceLabelsAcrossImportBatches,
  tiersTopDown,
} from "./project-setup-model";

describe("project setup model", () => {
  it("keeps internal ordinals independent from customer-facing aliases", () => {
    let document: EnergyProjectSetupDocumentDto = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: false,
      tiers: [],
      nodes: [],
    };
    document = addParentTier(document, "test");
    document = addParentTier(document, "test");
    document.tiers[0]!.alias = "Circuit";
    document.tiers[1]!.alias = "Room";
    expect(tiersTopDown(document).map((tier) => [tier.ordinal, tier.alias])).toEqual([
      [2, "Room"],
      [1, "Circuit"],
    ]);
  });

  it("locks only a complete unique Tier definition and removes only the highest empty Tier", () => {
    let document: EnergyProjectSetupDocumentDto = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: false,
      tiers: [],
      nodes: [],
    };
    document = addParentTier(document, "test");
    document.tiers[0]!.alias = "Circuit";
    document = addParentTier(document, "test");
    document.tiers[1]!.alias = "Level";
    expect(canLockTierStructure(document)).toBe(true);
    expect(isTierStructureLocked(document)).toBe(false);
    document.tiers[1]!.alias = " circuit ";
    expect(canLockTierStructure(document)).toBe(false);
    document.tiers[1]!.alias = "Level";
    expect(removeHighestTier(document).tiers.map((tier) => tier.alias)).toEqual(["Circuit"]);
  });

  it("browses an arbitrary tier tree and removes a branch safely", () => {
    const document = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "circuit", ordinal: 1, alias: "Circuit" },
        { id: "room", ordinal: 2, alias: "Room" },
        { id: "block", ordinal: 3, alias: "Block" },
      ],
      nodes: [
        { id: "b1", tier_definition_id: "block", name: "Block 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "r1", tier_definition_id: "room", parent_id: "b1", name: "Room 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "c1", tier_definition_id: "circuit", parent_id: "r1", name: "Circuit 1", sort_order: 1, metadata_status: "confirmed" as const },
      ],
    };
    expect(initialTierSelection(document)).toEqual({ block: "b1", room: "r1", circuit: "c1" });
    expect(nodesForTierAndParent(document, "room", "b1")).toHaveLength(1);
    expect(removeNodeAndDescendants(document, "r1").nodes).toEqual([document.nodes[0]]);
    expect(branchNodeCount(document, "r1")).toBe(2);
  });

  it("adds lower-tier nodes only under the selected immediate parent", () => {
    const document = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "circuit", ordinal: 1, alias: "Circuit" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l6", tier_definition_id: "level", name: "Level 6", sort_order: 1, metadata_status: "confirmed" as const },
      ],
    };
    const result = addNode(document, { projectId: "test", tierId: "circuit", parentId: "l6" });
    expect(result.document.nodes.at(-1)).toMatchObject({
      id: "test-circuit-1",
      parent_id: "l6",
      tier_definition_id: "circuit",
    });
  });

  it("treats display names as unique only within the same parent and tier", () => {
    const document = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "room", ordinal: 1, alias: "Room" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l1", tier_definition_id: "level", name: "Level 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "l2", tier_definition_id: "level", name: "Level 2", sort_order: 2, metadata_status: "confirmed" as const },
        { id: "r1-l1", tier_definition_id: "room", parent_id: "l1", name: "Room 1", sort_order: 1, metadata_status: "confirmed" as const },
        { id: "r3-l1", tier_definition_id: "room", parent_id: "l1", name: "Room 3", sort_order: 3, metadata_status: "confirmed" as const },
        { id: "r1-l2", tier_definition_id: "room", parent_id: "l2", name: "Room 1", sort_order: 1, metadata_status: "confirmed" as const },
      ],
    };

    expect(hasSiblingNameConflict(document, {
      tierId: "room",
      parentId: "l1",
      name: " room   1 ",
    })).toBe(true);
    expect(hasSiblingNameConflict(document, {
      tierId: "room",
      parentId: "l2",
      name: "Room 3",
    })).toBe(false);

    const result = addNode(document, { projectId: "test", tierId: "room", parentId: "l1" });
    expect(result.document.nodes.at(-1)?.name).toBe("Room 4");
  });

  it("creates a deterministic pilot Mapping with Circuit attachments and explicit ancestor routes", () => {
    const document: EnergyProjectSetupDocumentDto = {
      project: { name: "Test", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [
        { id: "circuit", ordinal: 1, alias: "Circuit" },
        { id: "level", ordinal: 2, alias: "Level" },
      ],
      nodes: [
        { id: "l6", tier_definition_id: "level", name: "Level 6", sort_order: 1, metadata_status: "confirmed" },
        { id: "total-load", tier_definition_id: "circuit", parent_id: "l6", name: "Total Office Load", sort_order: 1, metadata_status: "confirmed" },
        { id: "load-1", tier_definition_id: "circuit", parent_id: "l6", name: "Office Load 1", sort_order: 2, metadata_status: "confirmed" },
        { id: "l7", tier_definition_id: "level", name: "Level 7", sort_order: 2, metadata_status: "confirmed" },
        { id: "load-1-l7", tier_definition_id: "circuit", parent_id: "l7", name: "Office Load 1", sort_order: 1, metadata_status: "confirmed" },
      ],
    };

    const mapping = createInitialMeterMapping(document);
    expect(mapping.rows.find((row) => row.source_label === "Total Office Load")).toMatchObject({
      scope_id: "total-load",
      navigation_scope_id: "total-load",
      category: "load",
      coverage: "whole",
      meter_role: "total",
      aggregation_usage: "official",
    });
    expect(mapping.rows.find((row) => row.source_label === "Level 6 / Office Load 1")?.scope_id).toBe("load-1");
    expect(mapping.rows.find((row) => row.source_label === "Level 6 / Office Load 1")).toMatchObject({
      meter_role: "component",
      aggregation_usage: "excluded",
    });
    expect(mapping.official_aggregation_routes?.find((route) =>
      route.scope_id === "l6" && route.category === "load")?.meter_point_ids).toEqual([
      "mapping-total-load",
    ]);
    expect(mapping.official_aggregation_routes?.find((route) =>
      route.scope_id === "load-1" && route.category === "load")?.meter_point_ids).toEqual([
      "mapping-load-1",
    ]);
    expect(mapping.rows.find((row) => row.source_label === "Level 7 / Office Load 1")?.scope_id).toBe("load-1-l7");
    expect(nodePathLabel(document, "load-1-l7")).toBe("Level 7 / Office Load 1");
    expect(inferMeterCategory("Kitchen Lighting")).toBe("light");
    expect(buildAggregationReview(document, mapping).some((group) => group.scopeId === "l6" && group.recommendation === "direct total")).toBe(true);

    const imported = createMeterMappingFromSourceLabels(document, [
      "Lvl 6 Total Office Load",
      "Lvl 6 Office Load 1: L1P1-L3P6",
      "Lvl 7 Office Load 1",
      "Unknown Meter",
    ]);
    expect(imported.rows.find((row) => row.source_label === "Lvl 6 Total Office Load")).toMatchObject({
      scope_id: "total-load",
      navigation_scope_id: "total-load",
      display_name: "Total Office Load",
      category: "load",
    });
    expect(imported.rows.find((row) => row.source_label === "Lvl 6 Office Load 1: L1P1-L3P6")).toMatchObject({
      scope_id: "load-1",
      display_name: "Office Load 1",
    });
    expect(imported.rows.find((row) => row.source_label === "Lvl 7 Office Load 1")?.scope_id).toBe("load-1-l7");
    expect(imported.rows.find((row) => row.source_label === "Unknown Meter")?.scope_id).toBe("");
    expect(mapping.official_aggregation_routes).toContainEqual({
      scope_id: "l6",
      resource: "electricity",
      category: "load",
      meter_point_ids: ["mapping-total-load"],
    });

    const editableRow = mapping.rows.find((row) => row.id === "mapping-load-1")!;
    const edited = applyMeterMappingRowEdit(document, mapping, {
      ...editableRow,
      scope_id: "load-1-l7",
      navigation_scope_id: "load-1",
      resource: "water",
      category: "light",
      coverage: "whole",
      meter_role: "total",
      aggregation_usage: "official",
    });
    expect(edited.confirmed).toBe(false);
    expect(edited.rows.find((row) => row.id === editableRow.id)).toMatchObject({
      scope_id: "load-1-l7",
      navigation_scope_id: "load-1-l7",
      resource: "water",
      category: "light",
      meter_role: "total",
      aggregation_usage: "official",
    });
    expect(edited.official_aggregation_routes).toContainEqual({
      scope_id: "load-1-l7",
      resource: "water",
      category: "light",
      meter_point_ids: [editableRow.id],
    });
    expect(edited.official_aggregation_routes).toContainEqual({
      scope_id: "l7",
      resource: "water",
      category: "light",
      meter_point_ids: [editableRow.id],
    });
    expect(edited.official_aggregation_routes?.some((route) =>
      route.scope_id === "load-1" && route.meter_point_ids.includes(editableRow.id))).toBe(false);
  });

  it("unions all four Ngee Ann batches and corrects formal routes before confirmation", async () => {
    const document = ngeeAnnDocument();
    const batches = [
      importBatch("l6-old", NGEE_ANN_LABELS.slice(0, 9)),
      importBatch("l6-new", NGEE_ANN_LABELS.slice(0, 9)),
      importBatch("l7-old", NGEE_ANN_LABELS.slice(9)),
      importBatch("l7-new", NGEE_ANN_LABELS.slice(9)),
    ];
    const existing = createMeterMappingFromSourceLabels(document, NGEE_ANN_LABELS.slice(0, 9));
    existing.confirmed = true;
    existing.rows = existing.rows.map((row) => ({
      ...row,
      meter_role: "total",
      aggregation_usage: "official",
    }));
    existing.virtual_meters = [{
      id: "virtual-1785647019538",
      display_name: "Load 12",
      scope_id: "level-6",
      resource: "electricity",
      category: "load",
      terms: [
        { mapping_row_id: existing.rows[4]!.id, coefficient: 1 },
        { mapping_row_id: existing.rows[5]!.id, coefficient: 1 },
      ],
    }];

    const labels = sourceLabelsAcrossImportBatches(batches);
    const mapping = createMeterMappingFromSourceLabels(document, labels, existing);

    expect(labels).toHaveLength(18);
    expect(mapping.rows).toHaveLength(18);
    expect(mapping.confirmed).toBe(false);
    expect(mapping.rows.filter((row) => row.meter_role === "total" && row.aggregation_usage === "official")).toHaveLength(4);
    expect(mapping.rows.filter((row) => row.meter_role === "component" && row.aggregation_usage === "excluded")).toHaveLength(14);
    const actualTuples = mapping.rows.map((row) => [
      row.source_label,
      row.scope_id,
      row.category,
      row.coverage,
      row.meter_role,
      row.aggregation_usage,
    ] as const).sort((left, right) => left[0].localeCompare(right[0]));
    expect(actualTuples).toEqual([...NGEE_ANN_MAPPING_TUPLES].sort((left, right) => left[0].localeCompare(right[0])));
    expect(mapping.rows.find((row) => row.source_label === "Lvl 6 Office Load 1: L1P1-L3P6")).toMatchObject({
      id: existing.rows.find((row) => row.source_label === "Lvl 6 Office Load 1: L1P1-L3P6")?.id,
      scope_id: "l6-load-1",
      coverage: "partial",
      meter_role: "component",
      aggregation_usage: "excluded",
    });
    expect(mapping.rows.find((row) => row.source_label === "Lvl 7 Total Office Load")).toMatchObject({
      scope_id: "l7-total-load",
      navigation_scope_id: "l7-total-load",
      category: "load",
      meter_role: "total",
      aggregation_usage: "official",
    });
    expect(mapping.virtual_meters).toEqual([{
      id: "ngee-ann-load-12-v1",
      display_name: "Load 12",
      scope_id: "level-6",
      resource: "electricity",
      category: "load",
      terms: [
        { mapping_row_id: mapping.rows.find((row) => row.scope_id === "l6-load-1")?.id, coefficient: 1 },
        { mapping_row_id: mapping.rows.find((row) => row.scope_id === "l6-load-2")?.id, coefficient: 1 },
      ],
    }]);

    const renamedDocument = { ...document, project: { ...document.project, name: "Campus A" } };
    expect(createMeterMappingFromSourceLabels(renamedDocument, labels, mapping).virtual_meters)
      .toEqual(mapping.virtual_meters);

    const manifest = await pinEnergySourceManifest(batches);
    expect(manifest).toMatchObject({ confirmed: true, source_sha256: [...batches.map((batch) => batch.sourceSha256)].sort() });
    expect(manifest.id).toMatch(/^source-manifest-[a-f0-9]{24}$/);
    await expect(pinEnergySourceManifest([...batches].reverse())).resolves.toEqual(manifest);

    const partialSavedDocument = {
      ...document,
      source_manifest: manifest,
      meter_mapping: { ...existing, confirmed: true },
    };
    expect(evaluateEnergyImportMaterializationGuard({
      document: partialSavedDocument,
      savedDocument: partialSavedDocument,
      batches,
    })).toMatchObject({ ready: false, reasons: ["SOURCE_LABEL_UNMAPPED"] });

    const completeSavedDocument = {
      ...document,
      source_manifest: manifest,
      meter_mapping: { ...mapping, confirmed: true },
    };
    expect(evaluateEnergyImportMaterializationGuard({
      document: completeSavedDocument,
      savedDocument: completeSavedDocument,
      batches,
    })).toEqual({ ready: true, reasons: [] });

    const inactiveSavedDocument = {
      ...completeSavedDocument,
      meter_mapping: {
        ...completeSavedDocument.meter_mapping,
        rows: [...completeSavedDocument.meter_mapping.rows, {
          ...completeSavedDocument.meter_mapping.rows[0]!,
          id: "inactive",
          source_label: "Inactive source",
        }],
      },
    };
    expect(evaluateEnergyImportMaterializationGuard({
      document: inactiveSavedDocument,
      savedDocument: inactiveSavedDocument,
      batches,
    }).reasons).toContain("MAPPING_SOURCE_INACTIVE");
  });
});

const importBatch = (id: string, labels: string[]): EnergyImportBatchDto => ({
  id,
  projectId: "ngee-ann-polytechnic",
  sourceKind: "excel",
  sourceSha256: `sha-${id}`,
  filename: `${id}.xlsx`,
  status: "inspected",
  inspection: {
    sheetName: "Sheet1",
    columns: ["Device Name", "Time", "Active Energy"],
    sourceLabels: labels.map((label) => ({ label, rowCount: 2_880 })),
    rowCount: labels.length * 2_880,
    validRowCount: labels.length * 2_880,
    invalidRowCount: 0,
    duplicateReadingCount: 0,
    negativeReadingCount: 0,
    typicalIntervalMinutes: 15,
    readingKind: "cumulative",
    qualityStatus: "ready",
    issues: [],
  },
  createdAt: "2026-08-04T00:00:00.000Z",
});

const ngeeAnnDocument = (): EnergyProjectSetupDocumentDto => ({
  project: { name: "Ngee Ann Polytechnic", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [
    { id: "circuit", ordinal: 1, alias: "Circuit" },
    { id: "level", ordinal: 2, alias: "Level" },
  ],
  nodes: [
    scopeNode("level-6", "Level 6"),
    scopeNode("level-7", "Level 7"),
    meterNode("l6-total-light", "level-6", "Total Office Light", "light", "total"),
    meterNode("l6-light-left", "level-6", "Office Light-Left: External", "light", "submeter"),
    meterNode("l6-light-right", "level-6", "Office Light-Right: Internal", "light", "submeter"),
    meterNode("l6-total-load", "level-6", "Total Office Load", "load", "total"),
    meterNode("l6-load-1", "level-6", "Office Load 1", "load", "submeter"),
    meterNode("l6-load-2", "level-6", "Office Load 2", "load", "submeter"),
    meterNode("l6-load-3", "level-6", "Office Load 3", "load", "submeter"),
    meterNode("l6-load-4", "level-6", "Office Load 4", "load", "submeter"),
    meterNode("l6-load-5", "level-6", "Office Load 5 Fan Isol 1/2", "load", "submeter"),
    meterNode("l7-middle-light", "level-7", "Middle Row Office Light", "light", "submeter"),
    meterNode("l7-back-light", "level-7", "Back Row Office Light", "light", "submeter"),
    meterNode("l7-front-light", "level-7", "Front Row Office Light", "light", "submeter"),
    meterNode("l7-total-light", "level-7", "Total Office Light", "light", "total"),
    meterNode("l7-total-load", "level-7", "Total Office Load", "load", "total"),
    meterNode("l7-load-1", "level-7", "Office Load 1", "load", "submeter"),
    meterNode("l7-load-2", "level-7", "Office Load 2", "load", "submeter"),
    meterNode("l7-load-3", "level-7", "Office Load 3", "load", "submeter"),
    meterNode("l7-load-4", "level-7", "Office Load 4 Fan ISOL 1/2", "load", "submeter"),
  ],
});

const scopeNode = (id: string, name: string) => ({
  id,
  tier_definition_id: "level",
  name,
  sort_order: 1,
  metadata_status: "confirmed" as const,
});

const meterNode = (
  id: string,
  parentId: string,
  name: string,
  category: "light" | "load",
  meterRole: "total" | "submeter",
) => ({
  id,
  tier_definition_id: "circuit",
  parent_id: parentId,
  name,
  sort_order: 1,
  metadata_status: "confirmed" as const,
  metadata: { category, meterRole },
});

const NGEE_ANN_LABELS = [
  "Lvl 6 Total Office Light",
  "Lvl 6 Office Light-Left: External",
  "Lvl 6 Office Light-Right: Internal",
  "Lvl 6 Total Office Load",
  "Lvl 6 Office Load 1: L1P1-L3P6",
  "Lvl 6 Office Load 2: L1P7-L3P12",
  "Lvl 6 Office Load 3: L1P13-L3P18",
  "Lvl 6 Office Load 4: L1P19-L3P24",
  "Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2",
  "Lvl 7 Middle Row Office Light",
  "Lvl 7 Back Row Office Light",
  "Lvl 7 Front Row Office Light",
  "Lvl 7 Total Office Light",
  "Lvl 7 Total Office Load",
  "Lvl 7 Office Load 1: L1P1-L3P6",
  "Lvl 7 Office Load 2: L1P7-L3P15",
  "Lvl 7 Office Load 3: L1P16-L3P21",
  "Lvl 7 Office Load 4: L1P22-L3P25 Fan ISOL1/2",
];

const NGEE_ANN_MAPPING_TUPLES = [
  ["Lvl 6 Total Office Light", "l6-total-light", "light", "whole", "total", "official"],
  ["Lvl 6 Office Light-Left: External", "l6-light-left", "light", "partial", "component", "excluded"],
  ["Lvl 6 Office Light-Right: Internal", "l6-light-right", "light", "partial", "component", "excluded"],
  ["Lvl 6 Total Office Load", "l6-total-load", "load", "whole", "total", "official"],
  ["Lvl 6 Office Load 1: L1P1-L3P6", "l6-load-1", "load", "partial", "component", "excluded"],
  ["Lvl 6 Office Load 2: L1P7-L3P12", "l6-load-2", "load", "partial", "component", "excluded"],
  ["Lvl 6 Office Load 3: L1P13-L3P18", "l6-load-3", "load", "partial", "component", "excluded"],
  ["Lvl 6 Office Load 4: L1P19-L3P24", "l6-load-4", "load", "partial", "component", "excluded"],
  ["Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2", "l6-load-5", "load", "partial", "component", "excluded"],
  ["Lvl 7 Middle Row Office Light", "l7-middle-light", "light", "partial", "component", "excluded"],
  ["Lvl 7 Back Row Office Light", "l7-back-light", "light", "partial", "component", "excluded"],
  ["Lvl 7 Front Row Office Light", "l7-front-light", "light", "partial", "component", "excluded"],
  ["Lvl 7 Total Office Light", "l7-total-light", "light", "whole", "total", "official"],
  ["Lvl 7 Total Office Load", "l7-total-load", "load", "whole", "total", "official"],
  ["Lvl 7 Office Load 1: L1P1-L3P6", "l7-load-1", "load", "partial", "component", "excluded"],
  ["Lvl 7 Office Load 2: L1P7-L3P15", "l7-load-2", "load", "partial", "component", "excluded"],
  ["Lvl 7 Office Load 3: L1P16-L3P21", "l7-load-3", "load", "partial", "component", "excluded"],
  ["Lvl 7 Office Load 4: L1P22-L3P25 Fan ISOL1/2", "l7-load-4", "load", "partial", "component", "excluded"],
] as const;
