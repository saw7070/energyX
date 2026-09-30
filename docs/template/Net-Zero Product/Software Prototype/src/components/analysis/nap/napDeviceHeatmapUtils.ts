import { NapDeviceHourlyProfile } from "@/mock/napEnergyAnalysisData";

export const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

/** Compact 12-hour label for heatmap column headers (12am … 11am, 12pm … 11pm). */
export function formatHeatmapHourHeader(hourIndex: number): string {
  if (hourIndex === 0) {
    return "12am";
  }
  if (hourIndex < 12) {
    return `${hourIndex}am`;
  }
  if (hourIndex === 12) {
    return "12pm";
  }
  return `${hourIndex - 12}pm`;
}

export function profileLevel(profile: NapDeviceHourlyProfile): 6 | 7 {
  return Number(profile.level) === 7 ? 7 : 6;
}

export function shortenDeviceName(device: string): string {
  const stripped = device.replace(/^Lvl \d+ /, "");
  const loadMatch = stripped.match(/Office Load (\d+)/);
  if (loadMatch) {
    return `Load ${loadMatch[1]}`;
  }
  if (stripped.includes("Light-Left")) {
    return "Light L-Ext";
  }
  if (stripped.includes("Light-Right")) {
    return "Light R-Int";
  }
  if (stripped.includes("Back Row Office Light")) {
    return "Light Back";
  }
  if (stripped.includes("Front Row Office Light")) {
    return "Light Front";
  }
  if (stripped.includes("Middle Row Office Light")) {
    return "Light Mid";
  }
  if (stripped.includes("Fan")) {
    return "Fan ISOL";
  }
  if (stripped.length > 16) {
    return `${stripped.slice(0, 14)}…`;
  }
  return stripped;
}

export function usageHeatColor(value: number, min: number, max: number): string {
  if (max <= min) {
    return "rgba(71, 85, 105, 0.45)";
  }
  const ratio = (value - min) / (max - min);
  const start = { r: 30, g: 41, b: 59 };
  const mid = { r: 245, g: 158, b: 11 };
  const end = { r: 239, g: 68, b: 68 };
  const blend = ratio < 0.55 ? start : mid;
  const target = ratio < 0.55 ? mid : end;
  const localRatio = ratio < 0.55 ? ratio / 0.55 : (ratio - 0.55) / 0.45;
  const r = Math.round(blend.r + (target.r - blend.r) * localRatio);
  const g = Math.round(blend.g + (target.g - blend.g) * localRatio);
  const b = Math.round(blend.b + (target.b - blend.b) * localRatio);
  const alpha = 0.45 + ratio * 0.5;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

export function computeHeatmapBounds(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

/** Relative deviation (actual − average) / average as percentage; null when average ≤ 0. */
export function hourlyDeltaPercent(actual: number, average: number): number | null {
  if (average <= 0) {
    return null;
  }
  return ((actual - average) / average) * 100;
}

export function deltaPercentHeatColor(pct: number | null, maxAbs: number): string {
  if (pct === null || !Number.isFinite(pct)) {
    return "rgba(51, 65, 85, 0.55)";
  }
  if (maxAbs <= 0) {
    return "rgba(71, 85, 105, 0.45)";
  }
  const clamped = Math.max(-maxAbs, Math.min(maxAbs, pct));
  if (Math.abs(clamped) < 8) {
    return "rgba(71, 85, 105, 0.45)";
  }
  const ratio = Math.abs(clamped) / maxAbs;
  const alpha = 0.42 + ratio * 0.48;
  if (clamped > 0) {
    const r = Math.round(249 + (239 - 249) * ratio);
    const g = Math.round(115 + (68 - 115) * ratio);
    const b = Math.round(22 + (68 - 22) * ratio);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }
  const r = Math.round(100 + (16 - 100) * ratio);
  const g = Math.round(180 + (185 - 180) * ratio);
  const b = Math.round(160 + (129 - 160) * ratio);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

export function formatDeltaPercent(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) {
    return "—";
  }
  const rounded = Math.round(pct);
  if (rounded > 0) {
    return `+${rounded}%`;
  }
  return `${rounded}%`;
}

export interface DeviceHourlyMatrixRow {
  device: string;
  shortName: string;
  category: string;
  level: 6 | 7;
  spikeHourly: number[];
  averageHourly: number[];
  deltaPercentHourly: Array<number | null>;
}

export function filterProfilesByScope(
  profiles: NapDeviceHourlyProfile[],
  scope: "all" | "level6" | "level7"
): NapDeviceHourlyProfile[] {
  if (scope === "level6") {
    return profiles.filter((profile) => profileLevel(profile) === 6);
  }
  if (scope === "level7") {
    return profiles.filter((profile) => profileLevel(profile) === 7);
  }
  return profiles;
}

export function buildDeviceHourlyMatrix(
  spikeProfiles: NapDeviceHourlyProfile[],
  averageProfiles: NapDeviceHourlyProfile[],
  scope: "all" | "level6" | "level7"
): DeviceHourlyMatrixRow[] {
  const scopedSpike = filterProfilesByScope(spikeProfiles, scope);
  const avgByDevice = new Map(averageProfiles.map((profile) => [profile.device, profile]));

  return scopedSpike
    .map((spike) => {
      const average = avgByDevice.get(spike.device);
      const averageHourly = average?.hourlyKwh ?? Array.from({ length: 24 }, () => 0);
      const deltaPercentHourly = spike.hourlyKwh.map((value, hour) =>
        hourlyDeltaPercent(value, averageHourly[hour] ?? 0)
      );
      return {
        device: spike.device,
        shortName: shortenDeviceName(spike.device),
        category: spike.category,
        level: profileLevel(spike),
        spikeHourly: spike.hourlyKwh,
        averageHourly,
        deltaPercentHourly
      };
    })
    .sort((left, right) => left.level - right.level || left.device.localeCompare(right.device));
}
