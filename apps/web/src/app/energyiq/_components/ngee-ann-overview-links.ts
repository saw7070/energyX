export function anomalyIncidentDomId(incidentId: string): string {
  return `incident-${incidentId.replace(/^incident:/u, "").replace(/[^a-zA-Z0-9_-]+/gu, "-")}`;
}
