/** Match Explorer's published meter naming; keep raw source labels for diagnostics. */
export function projectMeterName(meter: { display_name?: string; source_label?: string; presentation?: { device_name?: string; circuit_name?: string } }): string {
  return meter.presentation?.device_name?.trim() || meter.presentation?.circuit_name?.trim() || meter.display_name || meter.source_label || "Unnamed meter";
}
