import type { EnergyMeterCategoryDto, EnergyMeterMappingRowDto, EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { suggestMeterCategory } from "../admin/meter-category-suggestion";
import { projectMeterName } from "./project-meter-name";
import { applyMeterEdit } from "./site-structure-editing";
import type { EnergyIqLocale } from "./energyiq-messages";

/** One meter in the "sort meters by type" review: what it is set to now and what its equipment list suggests. */
export type MeterTypeRow = { id: string; name: string; current: EnergyMeterCategoryDto; suggested: EnergyMeterCategoryDto | null };

/** The types a person can pick for a meter below the main meter; "overall" is reserved for whole-site meters. */
export const SORTABLE_TYPES: EnergyMeterCategoryDto[] = ["it", "kitchen", "plug", "light", "aircon", "load", "other"];

/** The name people gave the meter first, then the names it came with, until one of them says what it feeds. */
const suggestionFor = (row: EnergyMeterMappingRowDto): EnergyMeterCategoryDto | null => {
  for (const text of [projectMeterName(row), row.presentation?.circuit_name, row.source_label, row.display_name]) {
    const suggested = text ? suggestMeterCategory(text) : null;
    if (suggested) return suggested;
  }
  return null;
};

/** Every meter below the main meter, in the order of the meter list. The main meter measures the whole site and has no type. */
export function meterTypeRows(document: EnergyProjectSetupDocumentDto): MeterTypeRow[] {
  return (document.meter_mapping?.rows ?? [])
    .filter(row => row.category !== "overall")
    .map(row => ({ id: row.id, name: projectMeterName(row), current: row.category, suggested: suggestionFor(row) }));
}

/** Meters whose equipment suggests a different type than the one they have. */
export const meterTypeChanges = (rows: MeterTypeRow[]): MeterTypeRow[] =>
  rows.filter(row => row.suggested !== null && row.suggested !== row.current);

/** The same edit as changing each meter's type by hand; meters whose type stays the same are left alone. */
export function applyMeterTypes(document: EnergyProjectSetupDocumentDto, choices: Record<string, EnergyMeterCategoryDto>, locale: EnergyIqLocale = "en"): EnergyProjectSetupDocumentDto | { error: string } {
  let next = document;
  for (const [id, category] of Object.entries(choices)) {
    const meter = next.meter_mapping?.rows.find(row => row.id === id);
    if (!meter || meter.category === category) continue;
    const edited = applyMeterEdit(next, meter, { name: projectMeterName(meter), scopeId: meter.scope_id, category, counted: meter.aggregation_usage === "official" }, locale);
    if ("error" in edited) return edited;
    next = edited;
  }
  return next;
}
