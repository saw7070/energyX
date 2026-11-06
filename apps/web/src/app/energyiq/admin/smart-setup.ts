import type {
  EnergyMeterCategoryDto,
  EnergyMeterMappingRowDto,
  EnergyProjectSetupDocumentDto,
  EnergyProjectSetupNodeDto,
} from "../../../lib/config-api";
import { suggestMeterCategory } from "./meter-category-suggestion";
import { buildOfficialAggregationRoutes, inferMeterCategory } from "./project-setup-model";

/** One line of an admin-supplied device list, e.g. "A18P" → "Coffee machine x1, Warmer machine x1". */
export type DeviceListEntry = { code: string; description: string };

export type SmartSetupPlanRow = {
  sourceLabel: string;
  displayName: string;
  location: string;
  role: "total" | "component";
  status: "new" | "existing" | "needs_placement";
};

/** Names given to what a new setup creates, in the language of whoever sets it up. */
export type SmartSetupNames = {
  board: string;
  boardLevel: string;
  boardLevelHint: string;
  circuitLevel: string;
  circuitLevelHint: string;
  /** The top level when meters are grouped by block or area (see `areas` in buildSmartSetup). */
  areaLevel?: string;
  areaLevelHint?: string;
};

const ENGLISH_NAMES: SmartSetupNames = {
  board: "Main distribution board",
  boardLevel: "Board",
  boardLevelHint: "Distribution board",
  circuitLevel: "Circuit",
  circuitLevelHint: "Metered circuit or zone",
};

export type SmartSetupPlan = {
  mode: "new" | "update";
  /** The name of the board that holds the site total, as it reads in the setup. */
  boardName?: string;
  document: EnergyProjectSetupDocumentDto;
  rows: SmartSetupPlanRow[];
  totalLabel?: string;
  newLabels: string[];
  /** True when an older smart setup was upgraded so reports can list every circuit. */
  upgraded?: boolean;
  /** Labels that could not be placed automatically; the admin must map them in Meter Mapping. */
  unplacedLabels: string[];
};

const BOARD_TIER_SUFFIX = "-smart-tier-board";
const CIRCUIT_TIER_SUFFIX = "-smart-tier-circuit";
const BOARD_NODE_SUFFIX = "-smart-board";
const AREA_NODE_INFIX = "-smart-area-";
const TOTAL_PATTERN = /\b(?:incoming|incomer|mains?|msb|total)\b/iu;

const key = (value: string): string => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();

/**
 * Parses a device list pasted from a spreadsheet (tab separated) or loaded from CSV.
 * The first column is the device code; the remaining columns are its description.
 */
export const parseDeviceList = (text: string): DeviceListEntry[] => {
  const entries: DeviceListEntry[] = [];
  for (const line of text.replace(/^﻿/u, "").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const cells = line.includes("\t") ? line.split("\t") : splitCsvLine(line);
    const code = (cells[0] ?? "").trim();
    const description = cells.slice(1).map((cell) => cell.trim()).filter(Boolean).join(", ");
    if (!code || !description) continue;
    if (entries.length === 0 && /^(?:code|device(?: name)?|name|id|circuit)$/iu.test(code)) continue;
    entries.push({ code, description });
  }
  return entries;
};

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.trim() === "") { cell = ""; quoted = true; }
    else if (char === "," || char === ";") {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  // Unquoted descriptions such as "Coffee machine x1, Warmer machine x1" split on commas; rejoin them.
  return cells.length > 2 ? [cells[0]!, cells.slice(1).join(",")] : cells;
};

/** "Coffee machine x1, Warmer machine x1" → "Coffee machine, Warmer machine"; keeps counts above one as ×N. */
export const formatEquipment = (description: string): string => description
  .split(/\s*(?:,|\band\b)\s*/iu)
  .map((item) => item.trim().replace(/\s*[x×]\s*1\b/iu, "").replace(/\s*[x×]\s*(\d+)\b/iu, " ×$1").trim())
  .filter(Boolean)
  .join(", ");

/** The one label that names an incoming/main/total supply, or undefined when there is none or it is ambiguous. */
export const detectTotalLabel = (labels: string[]): string | undefined => {
  const matches = labels.filter((label) => TOTAL_PATTERN.test(label));
  return matches.length === 1 ? matches[0] : undefined;
};

/** What a new circuit meter is used for: suggested from its name and equipment list, else the older label rules. */
const categoryFor = (label: string, equipment: string | undefined): EnergyMeterCategoryDto =>
  suggestMeterCategory(equipment ? `${label} · ${equipment}` : label) ?? fallbackCategory(label, equipment);

const fallbackCategory = (label: string, equipment: string | undefined): EnergyMeterCategoryDto => {
  const fromLabel = inferMeterCategory(label);
  if (fromLabel !== "other" || !equipment) return fromLabel;
  const value = equipment.toLocaleLowerCase();
  if (/light|lamp|signboard/u.test(value) && !/plug|socket|machine|fridge|freezer/u.test(value)) return "light";
  if (/air\s*con|aircon/u.test(value)) return "aircon";
  return "other";
};

/**
 * Official routes for a smart-built site. With an incoming meter, the site (project) total is that meter
 * alone, while the board total is the sum of its circuits: reports list each circuit under the board and
 * the headline still uses the measured supply, and no scope counts a meter twice. Without an incoming
 * meter, circuits roll up to the board and project as usual.
 */
const smartRoutes = (
  document: EnergyProjectSetupDocumentDto,
  rows: EnergyMeterMappingRowDto[],
  boardId: string,
): NonNullable<NonNullable<EnergyProjectSetupDocumentDto["meter_mapping"]>["official_aggregation_routes"]> => {
  const total = rows.find((row) => row.meter_role === "total" && row.scope_id === boardId);
  if (!total) return buildOfficialAggregationRoutes(document, rows);
  const routes = new Map<string, { scope_id: string; resource: EnergyMeterMappingRowDto["resource"]; category: EnergyMeterCategoryDto; meter_point_ids: string[] }>();
  const add = (scopeId: string, row: EnergyMeterMappingRowDto) => {
    const routeKey = `${scopeId}\u0000${row.resource}\u0000${row.category}`;
    const route = routes.get(routeKey) ?? { scope_id: scopeId, resource: row.resource, category: row.category, meter_point_ids: [] };
    if (!route.meter_point_ids.includes(row.id)) route.meter_point_ids.push(row.id);
    routes.set(routeKey, route);
  };
  for (const row of rows) {
    if (row === total || !row.scope_id) continue;
    add(row.navigation_scope_id ?? row.scope_id, row);
    add(boardId, row);
  }
  add("project", total);
  return [...routes.values()]
    .map((route) => ({ ...route, meter_point_ids: [...route.meter_point_ids].sort() }))
    .sort((left, right) => left.scope_id.localeCompare(right.scope_id) || left.category.localeCompare(right.category));
};

/** Where a smart-built project keeps its device list: its board, or for a site grouped by area, its first area. */
const deviceListHolder = (document: EnergyProjectSetupDocumentDto, projectId: string): EnergyProjectSetupNodeDto | undefined =>
  document.nodes.find((node) => node.id === `${projectId}${BOARD_NODE_SUFFIX}`)
  ?? document.nodes.find((node) => node.id.startsWith(`${projectId}${AREA_NODE_INFIX}`) && Array.isArray(node.metadata?.deviceList));

/** The device list saved with a smart-built project (on its board location), if any. */
export const savedDeviceList = (document: EnergyProjectSetupDocumentDto, projectId: string): DeviceListEntry[] => {
  const board = deviceListHolder(document, projectId);
  const saved = board?.metadata?.deviceList;
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((item) => item && typeof item === "object" && typeof (item as DeviceListEntry).code === "string" && typeof (item as DeviceListEntry).description === "string"
    ? [{ code: (item as DeviceListEntry).code, description: (item as DeviceListEntry).description }]
    : []);
};

/** Newly supplied entries win; codes only in the saved list are kept. */
const mergeDeviceLists = (saved: DeviceListEntry[], supplied: DeviceListEntry[]): DeviceListEntry[] => {
  const merged = new Map(saved.map((entry) => [key(entry.code), entry]));
  for (const entry of supplied) merged.set(key(entry.code), entry);
  return [...merged.values()];
};

const withSavedDeviceList = (node: EnergyProjectSetupNodeDto, devices: DeviceListEntry[]): EnergyProjectSetupNodeDto =>
  devices.length ? { ...node, metadata: { ...node.metadata, deviceList: devices.map(({ code, description }) => ({ code, description })) } } : node;

const slug = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "device";

/**
 * Builds the complete setup for uploaded readings: a board, one location per device, named meters and
 * confirmed official routes. For a project that is already set up, only new device labels are added.
 */
export const buildSmartSetup = (input: {
  document: EnergyProjectSetupDocumentDto;
  projectId: string;
  labels: string[];
  devices: DeviceListEntry[];
  names?: SmartSetupNames;
  /**
   * Source label → block or area, e.g. from a site's own device list. For a new setup, meters are then grouped into
   * one location per area (labels without one go on the main board) instead of all sitting on one board.
   */
  areas?: Record<string, string>;
}): SmartSetupPlan => {
  const names = input.names ?? ENGLISH_NAMES;
  const labels = [...new Map(input.labels.map((label) => [key(label), label.trim()])).values()].filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const devices = mergeDeviceLists(savedDeviceList(input.document, input.projectId), input.devices);
  const devicesByCode = new Map(devices.map((device) => [key(device.code), formatEquipment(device.description)]));
  const displayNameFor = (label: string): string => {
    const equipment = devicesByCode.get(key(label));
    return equipment ? `${label} · ${equipment}` : label;
  };
  const existingRows = input.document.meter_mapping?.rows ?? [];
  const existingByLabel = new Map(existingRows.map((row) => [key(row.source_label), row]));
  const isNew = input.document.nodes.length === 0 && existingRows.length === 0;
  const pid = input.projectId;

  const areaByLabel = new Map(Object.entries(input.areas ?? {})
    .map(([label, area]) => [key(label), typeof area === "string" ? area.replace(/\s+/gu, " ").trim() : ""] as const)
    .filter(([, area]) => area.length > 0));
  if (isNew && labels.some((label) => areaByLabel.has(key(label)))) {
    return buildAreaSetup({ document: input.document, projectId: pid, labels, devices, devicesByCode, areaByLabel, names, displayNameFor });
  }

  if (isNew) {
    const totalLabel = detectTotalLabel(labels);
    const boardTier = { id: `${pid}${BOARD_TIER_SUFFIX}`, ordinal: 2, alias: names.boardLevel, description: names.boardLevelHint };
    const circuitTier = { id: `${pid}${CIRCUIT_TIER_SUFFIX}`, ordinal: 1, alias: names.circuitLevel, description: names.circuitLevelHint };
    const board: EnergyProjectSetupNodeDto = withSavedDeviceList({
      id: `${pid}${BOARD_NODE_SUFFIX}`, tier_definition_id: boardTier.id, name: names.board, sort_order: 0, metadata_status: "provisional",
    }, devices);
    const circuits = labels.filter((label) => label !== totalLabel).map((label, index): EnergyProjectSetupNodeDto => {
      const equipment = devicesByCode.get(key(label));
      return {
        id: `${pid}-smart-circuit-${slug(label)}`, tier_definition_id: circuitTier.id, parent_id: board.id, name: label, sort_order: index,
        metadata_status: "provisional", ...(equipment ? { metadata: { equipment } } : {}),
      };
    });
    const document: EnergyProjectSetupDocumentDto = {
      ...input.document,
      tier_structure_locked: true,
      tiers: [boardTier, circuitTier],
      nodes: [board, ...circuits],
    };
    const rows = labels.map((label, index): EnergyMeterMappingRowDto => {
      const isTotal = label === totalLabel;
      const scopeId = isTotal ? board.id : circuits.find((node) => node.name === label)!.id;
      return {
        id: `mapping-${slug(label)}-${index + 1}`, source_label: label, scope_id: scopeId, navigation_scope_id: scopeId,
        display_name: displayNameFor(label), resource: "electricity",
        category: isTotal ? "overall" : categoryFor(label, devicesByCode.get(key(label))),
        coverage: isTotal ? "whole" : "partial",
        meter_role: isTotal ? "total" : "component",
        // Circuits make up the board total; the incoming meter is the site total only (see smartRoutes).
        aggregation_usage: isTotal ? "excluded" : "official",
      };
    });
    return {
      mode: "new",
      boardName: board.name,
      document: { ...document, meter_mapping: { schema_version: 2, source_kind: "excel", rows, official_aggregation_routes: smartRoutes(document, rows, board.id), confirmed: true } },
      rows: rows.map((row) => ({ sourceLabel: row.source_label, displayName: row.display_name, location: row.meter_role === "total" ? board.name : row.source_label, role: row.meter_role === "total" ? "total" : "component", status: "new" })),
      ...(totalLabel ? { totalLabel } : {}),
      newLabels: labels,
      unplacedLabels: [],
    };
  }

  // Existing project: keep every current row, refresh uncustomised names, add new labels where possible.
  const smartBoard = input.document.nodes.find((node) => node.id === `${pid}${BOARD_NODE_SUFFIX}`);
  const circuitTierId = `${pid}${CIRCUIT_TIER_SUFFIX}`;
  const listHolder = deviceListHolder(input.document, pid);
  const nodes = input.document.nodes.map((node) => node === listHolder ? withSavedDeviceList(node, devices) : node);
  const renamed = existingRows.map((row) => row.display_name === row.source_label && devicesByCode.has(key(row.source_label))
    ? { ...row, display_name: displayNameFor(row.source_label) }
    : row);
  // Smart-built sites use the smartRoutes layout; upgrade older smart setups to it.
  const hasSmartTotal = Boolean(smartBoard && renamed.some((row) => row.meter_role === "total" && row.scope_id === smartBoard.id));
  const rows: EnergyMeterMappingRowDto[] = smartBoard
    ? renamed.map((row) => {
      if (row.meter_role === "component" && row.scope_id && row.aggregation_usage === "excluded") return { ...row, aggregation_usage: "official" as const };
      if (hasSmartTotal && row.meter_role === "total" && row.scope_id === smartBoard.id && row.aggregation_usage === "official") return { ...row, aggregation_usage: "excluded" as const };
      return row;
    })
    : renamed;
  const upgraded = rows.some((row, index) => row.aggregation_usage !== renamed[index]!.aggregation_usage);
  const planRows: SmartSetupPlanRow[] = [];
  const newLabels: string[] = [];
  const unplacedLabels: string[] = [];
  const hasOfficialTotal = hasSmartTotal || rows.some((row) => row.meter_role === "total" && row.aggregation_usage === "official");
  for (const label of labels) {
    const existing = existingByLabel.get(key(label));
    if (existing) continue;
    newLabels.push(label);
    const matchingNode = nodes.find((node) => key(node.name) === key(label));
    const target = matchingNode ?? (smartBoard ? {
      id: `${pid}-smart-circuit-${slug(label)}`, tier_definition_id: circuitTierId, parent_id: smartBoard.id, name: label,
      sort_order: nodes.length, metadata_status: "provisional" as const,
      ...(devicesByCode.has(key(label)) ? { metadata: { equipment: devicesByCode.get(key(label)) } } : {}),
    } : undefined);
    if (!target) {
      unplacedLabels.push(label);
      rows.push({ id: `mapping-${slug(label)}-${rows.length + 1}`, source_label: label, scope_id: "", display_name: displayNameFor(label), resource: "electricity", category: categoryFor(label, devicesByCode.get(key(label))), coverage: "partial", meter_role: "component", aggregation_usage: "excluded" });
      continue;
    }
    if (!matchingNode) nodes.push(target);
    rows.push({
      id: `mapping-${slug(label)}-${rows.length + 1}`, source_label: label, scope_id: target.id, navigation_scope_id: target.id,
      display_name: displayNameFor(label), resource: "electricity", category: categoryFor(label, devicesByCode.get(key(label))),
      coverage: "partial", meter_role: "component", aggregation_usage: smartBoard || !hasOfficialTotal ? "official" : "excluded",
    });
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const row of rows) {
    planRows.push({
      sourceLabel: row.source_label,
      displayName: row.display_name,
      location: nodesById.get(row.scope_id)?.name ?? "Not placed",
      role: row.meter_role === "total" ? "total" : "component",
      status: !row.scope_id ? "needs_placement" : newLabels.some((label) => key(label) === key(row.source_label)) ? "new" : "existing",
    });
  }
  const document: EnergyProjectSetupDocumentDto = { ...input.document, nodes };
  return {
    mode: "update",
    ...(smartBoard ? { boardName: smartBoard.name } : {}),
    document: {
      ...document,
      meter_mapping: {
        schema_version: 2,
        source_kind: input.document.meter_mapping?.source_kind ?? "excel",
        ...(input.document.meter_mapping?.virtual_meters ? { virtual_meters: input.document.meter_mapping.virtual_meters } : {}),
        rows,
        // Only rebuild routes when something changed, so hand-tuned routes on existing projects survive.
        official_aggregation_routes: smartBoard && (newLabels.length > 0 || upgraded)
          ? smartRoutes(document, rows, smartBoard.id)
          : newLabels.length > 0
            ? buildOfficialAggregationRoutes(document, rows)
            : input.document.meter_mapping?.official_aggregation_routes ?? buildOfficialAggregationRoutes(document, rows),
        confirmed: newLabels.length > 0 || upgraded ? unplacedLabels.length === 0 : input.document.meter_mapping?.confirmed ?? false,
      },
    },
    rows: planRows,
    newLabels,
    ...(upgraded ? { upgraded } : {}),
    unplacedLabels,
  };
};

/**
 * A new setup grouped by block or area: one top-level location per area with its meters as circuits below it, and
 * labels without an area on the main board. Every meter is a circuit that adds up to its area and the site; no meter
 * is taken as the site's incoming total, because one incoming meter cannot stand for several blocks.
 */
const buildAreaSetup = (input: {
  document: EnergyProjectSetupDocumentDto;
  projectId: string;
  labels: string[];
  devices: DeviceListEntry[];
  devicesByCode: Map<string, string>;
  areaByLabel: Map<string, string>;
  names: SmartSetupNames;
  displayNameFor: (label: string) => string;
}): SmartSetupPlan => {
  const { names, projectId: pid } = input;
  const areaTier = {
    id: `${pid}${BOARD_TIER_SUFFIX}`, ordinal: 2,
    alias: names.areaLevel ?? "Area", description: names.areaLevelHint ?? "Block, floor or area",
  };
  const circuitTier = { id: `${pid}${CIRCUIT_TIER_SUFFIX}`, ordinal: 1, alias: names.circuitLevel, description: names.circuitLevelHint };
  const groupKey = (label: string): string => {
    const area = input.areaByLabel.get(key(label));
    // An area named like the main board joins it, so two locations never share a name.
    return area && key(area) !== key(names.board) ? key(area) : "";
  };
  const areaNames = new Map<string, string>();
  for (const label of input.labels) {
    const group = groupKey(label);
    if (group && !areaNames.has(group)) areaNames.set(group, input.areaByLabel.get(key(label))!);
  }
  const usedIds = new Set<string>();
  const uniqueId = (base: string): string => {
    let id = base;
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${base}-${suffix}`;
    usedIds.add(id);
    return id;
  };
  const groups = [...areaNames.entries()]
    .sort((left, right) => left[1].localeCompare(right[1], undefined, { numeric: true }))
    .map(([group, name]) => ({ group, name, id: uniqueId(`${pid}${AREA_NODE_INFIX}${slug(name)}`) }));
  if (input.labels.some((label) => !groupKey(label))) groups.push({ group: "", name: names.board, id: `${pid}${BOARD_NODE_SUFFIX}` });
  const areaNodes = groups.map((group, index): EnergyProjectSetupNodeDto => ({
    id: group.id, tier_definition_id: areaTier.id, name: group.name, sort_order: index, metadata_status: "provisional",
  }));
  // The device list is kept on the main board when there is one, else on the first area.
  const holderId = groups.find((group) => !group.group)?.id ?? groups[0]!.id;
  const tops = areaNodes.map((node) => node.id === holderId ? withSavedDeviceList(node, input.devices) : node);
  const parentOf = new Map(groups.map((group) => [group.group, group.id]));
  const circuits = input.labels.map((label, index): EnergyProjectSetupNodeDto => {
    const equipment = input.devicesByCode.get(key(label));
    return {
      id: `${pid}-smart-circuit-${slug(label)}`, tier_definition_id: circuitTier.id, parent_id: parentOf.get(groupKey(label))!, name: label,
      sort_order: index, metadata_status: "provisional", ...(equipment ? { metadata: { equipment } } : {}),
    };
  });
  const document: EnergyProjectSetupDocumentDto = {
    ...input.document,
    tier_structure_locked: true,
    tiers: [areaTier, circuitTier],
    nodes: [...tops, ...circuits],
  };
  const rows = input.labels.map((label, index): EnergyMeterMappingRowDto => {
    const scopeId = circuits[index]!.id;
    return {
      id: `mapping-${slug(label)}-${index + 1}`, source_label: label, scope_id: scopeId, navigation_scope_id: scopeId,
      display_name: input.displayNameFor(label), resource: "electricity",
      category: categoryFor(label, input.devicesByCode.get(key(label))),
      coverage: "partial", meter_role: "component", aggregation_usage: "official",
    };
  });
  const mainBoard = groups.find((group) => !group.group);
  return {
    mode: "new",
    ...(mainBoard ? { boardName: mainBoard.name } : {}),
    document: {
      ...document,
      meter_mapping: { schema_version: 2, source_kind: "excel", rows, official_aggregation_routes: buildOfficialAggregationRoutes(document, rows), confirmed: true },
    },
    rows: rows.map((row) => ({ sourceLabel: row.source_label, displayName: row.display_name, location: row.source_label, role: "component", status: "new" })),
    newLabels: input.labels,
    unplacedLabels: [],
  };
};
