export {
  ELITE_CATEGORY_OPTIONS,
  ELITE_CATEGORY_SERIES,
  ELITE_SUBMETER_CATEGORY_OPTIONS,
  ELITE_USAGE_CATEGORIES,
  ELITE_ZONE_LABELS,
  eliteCategoryScopeLabel,
  eliteZoneLabel,
  isEliteSubmeterScope,
  type EliteCategoryScope,
  type EliteUsageCategory
} from "@/components/analysis/eliteiot/eliteiotCategoryConfig";

/** @deprecated Use ELITE_CATEGORY_OPTIONS instead. */
export const ELITE_SPACE_OPTIONS = [
  { key: "incoming" as const, label: "Incoming 3Phase" },
  { key: "fnb" as const, label: "F&B" },
  { key: "lighting" as const, label: "Lighting" },
  { key: "it_devices" as const, label: "IT Devices" },
  { key: "general_plug" as const, label: "General Plug" }
];

/** @deprecated Use ELITE_CATEGORY_SERIES instead. */
export const ELITE_TAG_SERIES = [
  { key: "fnb", label: "F&B", color: "#C68656" },
  { key: "lighting", label: "Lighting", color: "#4F9B86" },
  { key: "it_devices", label: "IT Devices", color: "#5B8BCF" },
  { key: "general_plug", label: "General Plug", color: "#9A8DBF" }
];
