import type { AnalysisData } from "./analysis-data";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "./analysis-model";
import { hourlyCsv, hourlyCsvFilename } from "./explorer-export";

/**
 * The Analysis page's readings as a CSV for Excel: the whole site, its uses, each space and then each meter, one row
 * per local hour of the chosen dates. Empty means no usable reading for that hour, never zero.
 */
export function analysisHourlyCsv(data: AnalysisData): string {
  const project = data.current.project;
  const columns = [
    ...(project.total ? [{ heading: "Whole site (kWh)", cells: project.total.cells }] : []),
    ...CATEGORY_ORDER.flatMap((category) => project.types[category]
      ? [{ heading: `Whole site · ${CATEGORY_LABELS[category]} (kWh)`, cells: project.types[category]!.cells }] : []),
    ...data.current.spaces.flatMap((space) => space.total ? [{ heading: `${space.name} (kWh)`, cells: space.total.cells }] : []),
    ...project.meters.flatMap((meter) => meter.series
      ? [{ heading: `${meter.name}${meter.location ? ` · ${meter.location}` : ""} (kWh)`, cells: meter.series.cells }] : []),
  ];
  const dates = new Set(project.dates);
  // Only the dates the page shows, so the file matches what is on screen.
  return hourlyCsv(columns.map((column) => ({ ...column, cells: column.cells.filter(([date]) => dates.has(date)) })));
}

export function analysisCsvFilename(data: AnalysisData): string {
  return hourlyCsvFilename(data.projectName, data.current.project.dates);
}
