import type { NapDeviceHourlyProfile } from "@/mock/napEnergyAnalysisData";
import {
  computeHeatmapBounds,
  deltaPercentHeatColor,
  DeviceHourlyMatrixRow,
  formatDeltaPercent,
  formatHeatmapHourHeader,
  hourlyDeltaPercent,
  HOUR_LABELS,
  shortenDeviceName,
  usageHeatColor
} from "@/components/analysis/nap/napDeviceHeatmapUtils";

export {
  computeHeatmapBounds,
  deltaPercentHeatColor,
  formatDeltaPercent,
  formatHeatmapHourHeader,
  HOUR_LABELS,
  usageHeatColor
};

function filterProfilesByDevices(
  profiles: NapDeviceHourlyProfile[],
  allowedDevices: Set<string> | null
): NapDeviceHourlyProfile[] {
  if (!allowedDevices) {
    return profiles;
  }
  return profiles.filter((profile) => allowedDevices.has(profile.device));
}

export function buildEliteDeviceHourlyMatrix(
  spikeProfiles: NapDeviceHourlyProfile[],
  averageProfiles: NapDeviceHourlyProfile[],
  allowedDevices: string[] | null
): DeviceHourlyMatrixRow[] {
  const deviceSet = allowedDevices ? new Set(allowedDevices) : null;
  const scopedSpike = filterProfilesByDevices(spikeProfiles, deviceSet);
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
        level: Number(spike.level) === 7 ? 7 : 6,
        spikeHourly: spike.hourlyKwh,
        averageHourly,
        deltaPercentHourly
      };
    })
    .sort((left, right) => left.device.localeCompare(right.device));
}
