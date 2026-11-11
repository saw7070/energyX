type NamedMeter = { display_name?: string; source_label?: string; presentation?: { device_name?: string; circuit_name?: string; short_name?: string } };

/** Match Explorer's published meter naming: the short name first when someone set one; keep raw source labels for diagnostics. */
export function projectMeterName(meter: NamedMeter): string {
  return meter.presentation?.short_name?.trim() || projectMeterFullName(meter);
}

/** The installer's full label, shown under a short name (or alone when there is none). */
export function projectMeterFullName(meter: NamedMeter): string {
  return meter.presentation?.device_name?.trim() || meter.presentation?.circuit_name?.trim() || meter.display_name || meter.source_label || "Unnamed meter";
}

/** The full label to show under the name, only when a short name is shown instead of it. */
export function projectMeterSubtitle(meter: NamedMeter): string | null {
  return meter.presentation?.short_name?.trim() ? projectMeterFullName(meter) : null;
}
