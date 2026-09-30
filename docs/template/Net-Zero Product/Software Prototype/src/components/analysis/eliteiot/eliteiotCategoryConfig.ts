import type { EliteCategoryScope } from "@/mock/eliteiotEnergyAnalysisData";

export type { EliteCategoryScope };

export const ELITE_CATEGORY_OPTIONS: Array<{ key: EliteCategoryScope; label: string }> = [
  { key: "incoming", label: "Incoming 3Phase" },
  { key: "fnb", label: "F&B" },
  { key: "lighting", label: "Lighting" },
  { key: "it_devices", label: "IT Devices" },
  { key: "general_plug", label: "General Plug" }
];

export const ELITE_SUBMETER_CATEGORY_OPTIONS = ELITE_CATEGORY_OPTIONS.filter(
  (option) => option.key !== "incoming"
);

export const ELITE_CATEGORY_SERIES = [
  { key: "fnb", label: "F&B", color: "#C68656" },
  { key: "lighting", label: "Lighting", color: "#4F9B86" },
  { key: "it_devices", label: "IT Devices", color: "#5B8BCF" },
  { key: "general_plug", label: "General Plug", color: "#9A8DBF" }
] as const;

export const ELITE_USAGE_CATEGORIES = ["F&B", "Lighting", "IT Devices", "General Plug"] as const;
export type EliteUsageCategory = (typeof ELITE_USAGE_CATEGORIES)[number];

export const ELITE_CATEGORY_COLORS: Record<EliteUsageCategory, string> = {
  "F&B": "#C68656",
  Lighting: "#4F9B86",
  "IT Devices": "#5B8BCF",
  "General Plug": "#9A8DBF"
};

/** Legacy type-group label for circuit table level column. */
export const ELITE_ZONE_LABELS = {
  level6: "F&B + Lighting",
  level7: "IT Devices + General Plug"
} as const;

export function eliteZoneLabel(level: number): string {
  return level === 6 ? ELITE_ZONE_LABELS.level6 : ELITE_ZONE_LABELS.level7;
}

export function eliteCategoryScopeLabel(scope: EliteCategoryScope): string {
  return ELITE_CATEGORY_OPTIONS.find((option) => option.key === scope)?.label ?? scope;
}

export function isEliteSubmeterScope(scope: EliteCategoryScope): boolean {
  return scope !== "incoming";
}
