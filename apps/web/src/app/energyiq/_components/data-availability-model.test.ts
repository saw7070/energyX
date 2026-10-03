import { describe, expect, it } from "vitest";
import type { EnergyDataAvailabilityDto, EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { applyMeterNotInUse, availabilityCsv, availabilityPeriods, siteDateTime } from "./data-availability-model";

const document = {
  project: { name: "Tuya Office", timezone: "Asia/Singapore" }, tier_structure_locked: true, tiers: [], nodes: [],
  meter_mapping: { schema_version: 2, source_kind: "tuya", confirmed: true, official_aggregation_routes: [], rows: [
    { id: "blind", source_label: "Showroom Blind", scope_id: "s", display_name: "Showroom Blind", resource: "electricity", category: "other", coverage: "partial", meter_role: "component", aggregation_usage: "official", presentation: { device_name: "Showroom Blind (L2P8)" } },
    { id: "tv", source_label: "TV", scope_id: "s", display_name: "TV", resource: "electricity", category: "it", coverage: "partial", meter_role: "component", aggregation_usage: "official" },
  ] },
} as unknown as EnergyProjectSetupDocumentDto;

describe("data availability model", () => {
  it("offers the last 30 days, then the last six whole months", () => {
    expect(availabilityPeriods("2026-10-03")).toEqual([
      { id: "last30" },
      { id: "2026-09", from: "2026-09-01", to: "2026-09-30" },
      { id: "2026-08", from: "2026-08-01", to: "2026-08-31" },
      { id: "2026-07", from: "2026-07-01", to: "2026-07-31" },
      { id: "2026-06", from: "2026-06-01", to: "2026-06-30" },
      { id: "2026-05", from: "2026-05-01", to: "2026-05-31" },
      { id: "2026-04", from: "2026-04-01", to: "2026-04-30" },
    ]);
    expect(availabilityPeriods("2026-01-15")[1]).toEqual({ id: "2025-12", from: "2025-12-01", to: "2025-12-31" });
  });

  it("marks a meter not in use with the reason given, and takes it back, touching nothing else", () => {
    const marked = applyMeterNotInUse(document, "blind", "  Nobody uses   the showroom blind ");
    const rows = marked.meter_mapping!.rows;
    expect(rows[0]!.presentation).toEqual({ device_name: "Showroom Blind (L2P8)", not_in_use: "Nobody uses the showroom blind" });
    expect(rows[1]).toBe(document.meter_mapping!.rows[1]);
    expect(marked.meter_mapping!.confirmed).toBe(true);
    const back = applyMeterNotInUse(marked, "blind", null);
    expect(back.meter_mapping!.rows[0]!.presentation).toEqual({ device_name: "Showroom Blind (L2P8)" });
    expect(applyMeterNotInUse(applyMeterNotInUse(document, "tv", "Spare"), "tv", null).meter_mapping!.rows[1]).not.toHaveProperty("presentation");
  });

  it("writes one row per meter and one per outage, in the site's own time, ready for Excel", () => {
    const data: EnergyDataAvailabilityDto = {
      from: "2026-09-01", to: "2026-09-30", timezone: "Asia/Singapore", targetPct: 95,
      site: { availabilityPct: 90, metersCounted: 1, metersBelowTarget: 1, outageCount: 1, estimatedKwh: 3, checkCount: 0 },
      meters: [{ meterPointId: "tv", name: "TV, meeting room", location: "Level 2", status: "below_target", availabilityPct: 90, realHours: 648, estimatedHours: 6, estimatedKwh: 3, missingHours: 66, longestOutageHours: 66, lastReadingAt: "2026-09-29T15:00:00.000Z", checks: [] }],
      outages: [{ meterPointId: "tv", name: "TV, meeting room", from: "2026-09-10T02:00:00.000Z", to: "2026-09-10T08:00:00.000Z", hours: 6, kind: "estimated", estimatedKwh: 3, ongoing: false }],
    };
    const csv = availabilityCsv(data, "Tuya Office", {
      title: "Data availability",
      meterColumns: ["Meter", "Location", "Received", "Target", "Real", "Estimated", "Estimated kWh", "Longest", "Last", "Status", "Notes"],
      outageTitle: "Outages",
      outageColumns: ["Meter", "From", "To", "Hours", "What", "kWh"],
      status: (status) => status === "below_target" ? "Below 95%" : status,
      outageKind: () => "Offline",
      check: () => "",
    });
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Data availability,Tuya Office,2026-09-01 – 2026-09-30,Asia/Singapore");
    expect(lines[2]).toBe('"TV, meeting room",Level 2,90,95,648,6,3,66,2026-09-29 23:00,Below 95%,');
    expect(lines[6]).toBe('"TV, meeting room",2026-09-10 10:00,2026-09-10 16:00,6,Offline,3');
    expect(siteDateTime("2026-09-30T16:00:00.000Z", "Asia/Singapore")).toBe("2026-10-01 00:00");
  });
});
