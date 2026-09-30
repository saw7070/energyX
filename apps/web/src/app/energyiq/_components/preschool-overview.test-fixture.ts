import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";

function fixturePlanningEstimateScope(input: {
  scopeId: string;
  scopeName: string;
  scopeType: string;
  scopeRole: "portfolio" | "centre";
  estimatedKwh: number;
}) {
  const daily = Array.from({ length: 30 }, (_, index) => ({
    start: `2026-06-${String(index + 1).padStart(2, "0")}`,
    endExclusive: index === 29
      ? "2026-07-01"
      : `2026-06-${String(index + 2).padStart(2, "0")}`,
    estimatedKwh: input.estimatedKwh / 30,
  }));
  const aggregate = (size: number) => Array.from(
    { length: Math.ceil(daily.length / size) },
    (_, index) => {
      const rows = daily.slice(index * size, (index + 1) * size);
      return {
        start: rows[0]!.start,
        endExclusive: rows.at(-1)!.endExclusive,
        estimatedKwh: rows.reduce((total, row) => total + row.estimatedKwh, 0),
      };
    },
  );
  return {
    ...input,
    estimatedCostBeforeGstSgd: input.estimatedKwh * 0.2727,
    buckets: {
      daily,
      weekly: aggregate(7),
      monthly: aggregate(30),
    },
  };
}

export function preschoolGoldenSnapshot(): EnergyProjectAnalysisSnapshotDto {
  const base = structuredClone(ngeeAnnGoldenSnapshot());
  const centreCodes = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
    "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
    "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD",
  ];
  const centres = Array.from({ length: 30 }, (_, index) => {
    const name = `Centre ${String.fromCharCode(65 + Math.min(index, 25))}${index > 25 ? String(index - 25) : ""}`;
    const usageKwh = index === 0 ? 843.0985 : index === 29 ? 830.2998 : 830.3005;
    const area = 743 + index * 3;
    const headcount = 58 + (index % 9);
    const metadata = {
      scopeId: `preschool-centre-${index + 1}`,
      scopeName: name,
      usageKwh,
      status: "provisional",
      area: { status: "provisional", value: area, unit: "m2", metadataRevisionIds: ["metadata-1"], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
      headcount: { status: "provisional", value: headcount, unit: "people", metadataRevisionIds: ["metadata-1"], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
      normalisations: {
        eui: { status: "provisional", metricId: "energy.usage_per_sqm", value: usageKwh / area, unit: "kWh/m2", metadataRevisionIds: ["metadata-1"], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
        perPax: { status: "provisional", metricId: "energy.usage_per_person", value: usageKwh / headcount, unit: "kWh/person", metadataRevisionIds: ["metadata-1"], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
      },
      evidence: [],
    };
    return {
      nodeId: metadata.scopeId,
      name,
      nodeType: "centre",
      usageKwh,
      sharePct: (usageKwh / 24_921.8123) * 100,
      areaSqm: area,
      occupantCount: headcount,
      kwhPerSqm: usageKwh / area,
      kwhPerPerson: usageKwh / headcount,
      topCircuitName: "Aircon 1",
      topCircuitUsageKwh: usageKwh * 0.2,
      metadata,
    };
  });
  const selectedScope = {
    scopeId: "preschool-project",
    scopeName: "Preschool Portfolio",
    usageKwh: 24_921.8123,
    status: "missing",
    area: { status: "missing", value: null, unit: "m2", reason: "not-configured", guidance: "Use Centre metadata.", metadataRevisionIds: [], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
    headcount: { status: "missing", value: null, unit: "people", reason: "not-configured", guidance: "Use Centre metadata.", metadataRevisionIds: [], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
    normalisations: {
      eui: { status: "missing", metricId: "energy.usage_per_sqm", value: null, unit: "kWh/m2", reason: "not-configured", guidance: "Use Centre EUI.", metadataRevisionIds: [], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
      perPax: { status: "missing", metricId: "energy.usage_per_person", value: null, unit: "kWh/person", reason: "not-configured", guidance: "Use Centre per-pax values.", metadataRevisionIds: [], hierarchyRevisionIds: ["preschool-hierarchy-v4"], evidence: [] },
    },
    evidence: [],
  };
  const facilityTypeByCode = new Map<string, string>([
    ...["A", "D", "I", "J", "K", "N", "Q", "R", "T", "U", "V", "Z", "AC", "AD"].map((code) => [code, "Senior Care Center"] as const),
    ...["B", "E", "F", "G", "M", "O", "W", "AB"].map((code) => [code, "Active Aging Center"] as const),
    ...["C", "H", "L", "P", "S", "X", "Y", "AA"].map((code) => [code, "Preschool"] as const),
  ]);
  const priorityCodes = new Set(["G", "M", "J"]);
  const benchmarkCentres = centres.map((centre, index) => {
    const centreCode = centreCodes[index]!;
    const priority = priorityCodes.has(centreCode);
    return {
      scopeId: centre.nodeId,
      centreCode,
      name: centre.name,
      cohort: facilityTypeByCode.get(centreCode)!,
      usageKwh: centre.usageKwh,
      annualisedEuiKwhPerSqmYear: priority ? 12 + index / 10 : 5 + index / 5,
      mayKwhPerPerson: priority ? 22 + index / 10 : 13 + index / 4,
      quadrant: priority ? "priority" as const : "lower-intensity" as const,
      priority,
    };
  });
  const centreByCode = new Map(benchmarkCentres.map((centre) => [centre.centreCode, centre]));
  const spikeCentre = (code: string, spikeCount: number, operating: boolean) => {
    const centre = centreByCode.get(code)!;
    const worstSpike = {
      localDate: operating ? "2026-05-18" : code === "L" ? "2026-05-25" : code === "E" ? "2026-05-04" : "2026-05-08",
      localHour: operating ? 14 : code === "L" ? 1 : code === "E" ? 23 : 22,
      dayType: operating ? "weekday" as const : code === "L" ? "weekend" as const : "weekday" as const,
      usageKwh: operating ? 19.503 : code === "L" ? 5.038 : code === "E" ? 4.052 : 4.171,
      baselineKwh: operating ? 3.7 : code === "L" ? 0.403 : code === "E" ? 0.326 : 0.328,
      impactKwh: operating ? 15.803 : code === "L" ? 4.635 : code === "E" ? 3.726 : 3.843,
      variancePct: operating ? 427.1 : code === "L" ? 1_149.4 : code === "E" ? 1_144.9 : 1_173,
      leadingCircuitName: `${centre.scopeId}:${operating ? "Aircon 1" : code === "L" ? "Living Room Lighting" : code === "E" ? "Heater" : "Other Lighting3"}`,
      leadingCircuitKwh: operating ? 18.2 : code === "L" ? 4.851 : code === "E" ? 3.849 : 3.958,
      leadingCircuitSharePct: operating ? 93 : code === "L" ? 96 : code === "E" ? 95 : 95,
    };
    const events = Array.from({ length: spikeCount }, (_, index) => index === 0
      ? worstSpike
      : {
          ...worstSpike,
          localDate: `2026-05-${String((operating ? 18 : 25) - index).padStart(2, "0")}`,
          localHour: operating ? 9 + (index % 9) : (worstSpike.localHour + index * 3) % 24,
          usageKwh: worstSpike.usageKwh - index * 0.2,
          impactKwh: worstSpike.impactKwh - index * 0.2,
          variancePct: worstSpike.variancePct - index * (operating ? 25 : 75),
        });
    return {
      scopeId: centre.scopeId,
      centreCode: code,
      name: centre.name,
      centreType: centre.cohort,
      spikeCount,
      worstSpike,
      events,
    };
  };
  const standbySpikeCounts = new Map([["L", 4], ["E", 2], ["N", 1]]);
  const operatingSpikeCounts = new Map(centreCodes.slice(0, 14).map((code, index) => [code, index === 0 ? 8 : 1]));
  const applianceUsage = [
    ["Aircon 1", "Aircon", 5_200],
    ["Aircon 2", "Aircon", 4_500],
    ["Heater", "Heater", 3_000],
    ["Kitchen Lighting", "Lighting", 2_500],
    ["Living Room Lighting", "Lighting", 2_400],
    ["Other Lighting3", "Lighting", 2_300],
    ["Kitchen Plug Load", "Plugload", 1_900],
    ["Living Area Plug Load", "Plugload", 1_700],
    ["Plug Load3", "Plugload", 1_421.8123],
  ] as const;
  const standbyEnergyKwh = 3_103.784;
  const operatingEnergyKwh = 21_818.0283;
  const standbyApplianceShares = [
    ["Plug Load3", "Plugload", 40],
    ["Kitchen Plug Load", "Plugload", 30],
    ["Living Area Plug Load", "Plugload", 27.4],
    ["Aircon 1", "Aircon", 1.2],
    ["Aircon 2", "Aircon", 0.8],
    ["Kitchen Lighting", "Lighting", 0.2],
    ["Living Room Lighting", "Lighting", 0.2],
    ["Other Lighting3", "Lighting", 0.1],
    ["Heater", "Heater", 0.1],
  ] as const;
  const standbyAppliances = standbyApplianceShares.map(([name, applianceGroup, sharePct], applianceIndex) => ({
    name,
    applianceGroup,
    usageKwh: standbyEnergyKwh * sharePct / 100,
    sharePct,
    provisionalCostBeforeGstSgd: standbyEnergyKwh * sharePct / 100 * 0.2727,
    centreCount: 30,
    sourceCircuitIds: centreCodes.map((code) => `preschool-centre-${code.toLowerCase()}-standby-${applianceIndex + 1}`),
  }));
  const operatingApplianceShares = [
    ["Plug Load3", "Plugload", 24],
    ["Kitchen Plug Load", "Plugload", 16],
    ["Living Area Plug Load", "Plugload", 12],
    ["Aircon 1", "Aircon", 15],
    ["Aircon 2", "Aircon", 10.1],
    ["Kitchen Lighting", "Lighting", 7],
    ["Living Room Lighting", "Lighting", 6.5],
    ["Other Lighting3", "Lighting", 5.4],
    ["Heater", "Heater", 4],
  ] as const;
  const operatingAppliances = operatingApplianceShares.map(([name, applianceGroup, sharePct], applianceIndex) => ({
    name,
    applianceGroup,
    usageKwh: operatingEnergyKwh * sharePct / 100,
    sharePct,
    provisionalCostBeforeGstSgd: operatingEnergyKwh * sharePct / 100 * 0.2727,
    centreCount: 30,
    sourceCircuitIds: centreCodes.map((code) => `preschool-centre-${code.toLowerCase()}-operating-${applianceIndex + 1}`),
  }));

  return {
    ...base,
    context: {
      ...base.context,
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      projectName: "Preschool Portfolio",
      scopeId: "preschool-project",
      scopeName: "Preschool Portfolio",
      from: "2026-04-30T16:00:00.000Z",
      to: "2026-05-31T16:00:00.000Z",
      hierarchyRevisionId: "preschool-hierarchy-v4",
      meterMappingRevisionId: "preschool-mapping-v4",
      meterFormulaRevisionId: "preschool-formula-v1",
      dataSnapshotId: "preschool-26b85b9c0b95e090",
      metricVersion: "metric-revisions:energy.total_usage_kwh@1,energy.usage_per_person,energy.usage_per_sqm",
      businessCalendarVersion: "sg-preschool-calendar-v1",
      tariffScheduleVersion: "missing",
      projectReleaseId: "legacy-profile:preschool-demo:2",
      latestCompleteLocalDay: "2026-05-31",
      monthlyOutlookTargetPeriod: {
        start: "2026-06-01",
        endExclusive: "2026-07-01",
        timezone: "Asia/Singapore",
        targetDayCount: 30,
      },
      primaryPeriod: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
      },
    },
    projectRelease: {
      ...base.projectRelease,
      id: "legacy-profile:preschool-demo:2",
      projectId: "preschool-demo",
      reportTimePolicyRevisionId: "preschool-report-time@2",
      hierarchyRevisionId: "preschool-hierarchy-v4",
      meterMappingRevisionId: "preschool-mapping-v4",
      meterFormulaRevisionId: "preschool-formula-v1",
      metricRevisionIds: [
        "energy.total_usage_kwh@1",
        "energy.usage_per_person",
        "energy.usage_per_sqm",
      ],
      businessCalendarVersion: "sg-preschool-calendar-v1",
      tariffScheduleVersion: "missing",
      renderer: {
        key: "preschool-overview",
        version: "1",
        contractVersion: "project-analysis-snapshot@1",
      },
    },
    renderer: {
      key: "preschool-overview",
      version: "1",
      contractVersion: "project-analysis-snapshot@1",
    },
    dataQuality: {
      ...base.dataQuality,
      status: "complete",
      coveragePct: 100,
      expectedMeterIntervalCount: 200_880,
      validIntervalCount: 200_880,
      qualityEventCount: 0,
    },
    dataSnapshot: {
      id: "preschool-26b85b9c0b95e090",
      importBatchIds: ["preschool-may-2026"],
      lastSeenAt: "2026-05-31T15:00:00.000Z",
    },
    preschoolDecisionSignals: {
      contract: { id: "preschool-decision-signals", version: "1" },
      context: {
        projectReleaseId: "legacy-profile:preschool-demo:2",
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
          timezone: "Asia/Singapore",
        },
      },
      status: "available",
      items: [
        {
          id: "after-hours",
          kind: "after-hours-energy",
          sectionId: "operating-behaviour",
          priority: 1,
          severity: "attention",
          label: "Energy used after closing",
          metrics: [
            { id: "after-hours-share", label: "Share used after closing", metricId: "energy.off_hours_share_pct", value: 12.45, unit: "%", role: "primary", precision: 1, dimensions: { operatingState: "closed" } },
            { id: "after-hours-energy", label: "Energy used after closing", metricId: "energy.off_hours_usage_kwh", value: 3_103.784, unit: "kWh", role: "supporting", precision: 2, dimensions: { operatingState: "closed" } },
            { id: "after-hours-spikes", label: "Unusual closed-hour peaks", metricId: "preschool.operating.spike_count", value: 7, unit: "count", role: "supporting", precision: 0, dimensions: { operatingState: "closed" } },
          ],
          entities: ["L", "E", "N"].map((code) => ({ kind: "centre" as const, scopeId: centreByCode.get(code)!.scopeId, code, name: centreByCode.get(code)!.name })),
          evidenceRefs: ["scope_summary_v1", "preschool_centre_hour_cells_v1", "preschool-hour-slot-spike-v1"],
          limitations: [{ code: "CAUSE_NOT_OBSERVED", label: "Meter data shows when energy was used, not why equipment was running." }],
        },
        {
          id: "efficiency",
          kind: "normalised-peer-priority",
          sectionId: "centre-benchmark",
          priority: 2,
          severity: "attention",
          label: "High for both floor area and headcount",
          metrics: [
            { id: "priority-centres", label: "Centres above both all-centre P75 lines", metricId: "preschool.benchmark.priority_count", value: 3, unit: "count", role: "primary", precision: 0, dimensions: { benchmark: "portfolio-p75" } },
            { id: "benchmark-sample", label: "Centres compared", metricId: "preschool.benchmark.sample_size", value: 30, unit: "count", role: "supporting", precision: 0, dimensions: { benchmark: "portfolio" } },
          ],
          entities: ["G", "M", "J"].map((code) => ({ kind: "centre" as const, scopeId: centreByCode.get(code)!.scopeId, code, name: centreByCode.get(code)!.name })),
          evidenceRefs: ["child_scope_breakdown_v1", "preschool-eui-benchmark-v1", "preschool-per-pax-benchmark-v1"],
          limitations: [{ code: "PROVISIONAL_METADATA", label: "Floor area and headcount are provisional, so this is an investigation priority rather than proof of poor efficiency." }],
        },
        {
          id: "operating",
          kind: "operating-hour-spikes",
          sectionId: "operating-behaviour",
          priority: 3,
          severity: "attention",
          label: "Unusual peaks during opening hours",
          metrics: [
            { id: "operating-spike-centres", label: "Centres with unusual opening-hour peaks", metricId: "preschool.operating.centre_count", value: 14, unit: "count", role: "primary", precision: 0, dimensions: { operatingState: "open" } },
            { id: "operating-spike-count", label: "Unusual opening-hour peaks", metricId: "preschool.operating.spike_count", value: 21, unit: "count", role: "supporting", precision: 0, dimensions: { operatingState: "open" } },
          ],
          entities: centreCodes.slice(0, 14).map((code) => ({ kind: "centre" as const, scopeId: centreByCode.get(code)!.scopeId, code, name: centreByCode.get(code)!.name })),
          evidenceRefs: ["preschool_centre_hour_cells_v1", "preschool-hour-slot-spike-v1"],
          limitations: [{ code: "ACTIVITY_NOT_OBSERVED", label: "Meter data cannot distinguish planned activity, manual override and equipment faults." }],
        },
      ],
    },
    preschoolBenchmark: {
      status: "provisional",
      contract: {
        id: "preschool-may-2026-benchmark",
        version: "1",
        annualisationFactor: 12,
      },
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
        timezone: "Asia/Singapore",
      },
      sampleSize: 30,
      portfolio: {
        eui: { p50: 7.034247079, p75: 10.525439076, unit: "kWh/m2/year" },
        perPax: { p50: 18.395011111, p75: 20.84584375, unit: "kWh/person/month" },
      },
      cohorts: [
        { name: "Active Aging Center", sampleSize: 8, eui: { p50: 6.7234, p75: 15.1315, unit: "kWh/m2/year" }, perPax: { p50: 17.1931, p75: 22.4632, unit: "kWh/person/month" } },
        { name: "Preschool", sampleSize: 8, eui: { p50: 9.0018, p75: 10.9544, unit: "kWh/m2/year" }, perPax: { p50: 18.0713, p75: 20.0863, unit: "kWh/person/month" } },
        { name: "Senior Care Center", sampleSize: 14, eui: { p50: 6.7567, p75: 9.2022, unit: "kWh/m2/year" }, perPax: { p50: 18.5196, p75: 20.695, unit: "kWh/person/month" } },
      ],
      centres: benchmarkCentres,
      priorityCentreCodes: ["G", "M", "J"],
      evidence: {
        projectReleaseId: "legacy-profile:preschool-demo:2",
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        metricRevisionIds: ["energy.usage_per_sqm", "energy.usage_per_person"],
        metadataRevisionIds: ["preschool-metadata-v4"],
        sourceQueryIds: ["scope_summary_v1", "child_scope_breakdown_v1"],
        projectionRecipeIds: ["preschool-eui-benchmark-v1", "preschool-per-pax-benchmark-v1", "preschool-quadrant-v1"],
        cohortSource: "published-hierarchy-node-metadata",
        metadataStatus: "provisional",
        normalisation: {
          eui: "May usage kWh * 12 / published comparison area m2",
          perPax: "May usage kWh / published representative headcount",
        },
      },
    },
    preschoolAppliances: {
      status: "available",
      contract: {
        id: "preschool-may-2026-appliance-ranking",
        version: "1",
        aliasContractId: "preschool-circuit-as-appliance-v1",
        sourceKind: "circuit",
      },
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
        timezone: "Asia/Singapore",
      },
      totalKwh: 24_921.8123,
      appliances: applianceUsage.map(([name, applianceGroup, usageKwh], applianceIndex) => ({
        name,
        applianceGroup,
        usageKwh,
        sharePct: (usageKwh / 24_921.8123) * 100,
        centreCount: 30,
        sourceCircuitIds: centreCodes.map((code) => `preschool-centre-${code.toLowerCase()}-${applianceIndex + 1}`),
      })),
      evidence: {
        projectReleaseId: "legacy-profile:preschool-demo:2",
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        sourceQueryIds: ["scope_summary_v1", "meter_breakdown_v1"],
        projectionRecipeId: "preschool-appliance-ranking-v1",
        sourceKind: "circuit",
        reconciliationGapKwh: 0,
      },
    },
    preschoolOperational: {
      status: "available",
      contract: {
        id: "preschool-may-2026-operational-behaviour",
        version: "2",
        spikeThresholdPct: 50,
      },
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
        timezone: "Asia/Singapore",
      },
      energy: {
        totalKwh: 24_921.8123,
        standbyKwh: 3_103.784,
        standbySharePct: 12.45,
        operatingKwh: operatingEnergyKwh,
        operatingSharePct: 87.5459,
        provisionalStandbyCostBeforeGstSgd: 846.4019,
        provisionalOperatingCostBeforeGstSgd: 5_949.7763,
      },
      tariffReference: {
        sourceName: "SP Group",
        sourceUrl: "https://www.spgroup.com.sg/about-us/media-resources/news-and-media-releases/Electricity-Tariff-Revision-for-the-Period-1-April-to-30-June-2026",
        appendixUrl: "https://www.spgroup.com.sg/dam/spgroup/images/news-media-releases/2026/Appendix-2---Q2-2026.png0",
        supplyClass: "Low tension, non-domestic",
        appliesFrom: "2026-04-01",
        appliesTo: "2026-06-30",
        beforeGstSgdPerKwh: 0.2727,
        withGstSgdPerKwh: 0.2972,
      },
      standbyAppliances: {
        totalKwh: standbyEnergyKwh,
        provisionalCostBeforeGstSgd: 846.4019,
        reconciliationGapKwh: 0,
        applianceGroups: [
          ["Plugload", 97.4, ["Kitchen Plug Load", "Living Area Plug Load", "Plug Load3"]],
          ["Aircon", 2, ["Aircon 1", "Aircon 2"]],
          ["Lighting", 0.5, ["Kitchen Lighting", "Living Room Lighting", "Other Lighting3"]],
          ["Heater", 0.1, ["Heater"]],
        ].map(([name, sharePct, sourceAliases]) => ({
          name: String(name),
          usageKwh: standbyEnergyKwh * Number(sharePct) / 100,
          sharePct: Number(sharePct),
          provisionalCostBeforeGstSgd: standbyEnergyKwh * Number(sharePct) / 100 * 0.2727,
          sourceAliases: sourceAliases as string[],
        })),
        appliances: standbyAppliances,
      },
      operatingAppliances: {
        totalKwh: operatingEnergyKwh,
        provisionalCostBeforeGstSgd: 5_949.7763,
        reconciliationGapKwh: 0,
        applianceGroups: [
          ["Plugload", 52, ["Kitchen Plug Load", "Living Area Plug Load", "Plug Load3"]],
          ["Aircon", 25.1, ["Aircon 1", "Aircon 2"]],
          ["Lighting", 18.9, ["Kitchen Lighting", "Living Room Lighting", "Other Lighting3"]],
          ["Heater", 4, ["Heater"]],
        ].map(([name, sharePct, sourceAliases]) => ({
          name: String(name),
          usageKwh: operatingEnergyKwh * Number(sharePct) / 100,
          sharePct: Number(sharePct),
          provisionalCostBeforeGstSgd: operatingEnergyKwh * Number(sharePct) / 100 * 0.2727,
          sourceAliases: sourceAliases as string[],
        })),
        appliances: operatingAppliances,
      },
      hourlyProfile: {
        completeDayCount: 31,
        unit: "mean kWh per complete day",
        rows: Array.from({ length: 24 }, (_, localHour) => {
          const businessHour = localHour >= 7 && localHour < 19;
          const operatingKwh = businessHour ? 30 + (localHour >= 11 && localHour <= 15 ? 10 : 4) : 0;
          const closedHourKwh = businessHour ? 5 : 10 + (localHour <= 5 ? 3 : 0);
          return {
            localHour,
            operatingKwh,
            closedHourKwh,
            totalKwh: operatingKwh + closedHourKwh,
          };
        }),
      },
      planningOutlook: {
        status: "provisional",
        contract: {
          id: "preschool-june-2026-naive-weekly-baseline",
          version: "1",
          method: "mean of four complete Monday-Sunday weeks",
        },
        targetPeriod: { start: "2026-06-01", endInclusive: "2026-06-30", days: 30 },
        sourceWeeks: [
          { start: "2026-05-04", endInclusive: "2026-05-10", usageKwh: 5_500 },
          { start: "2026-05-11", endInclusive: "2026-05-17", usageKwh: 5_750 },
          { start: "2026-05-18", endInclusive: "2026-05-24", usageKwh: 5_675 },
          { start: "2026-05-25", endInclusive: "2026-05-31", usageKwh: 5_800 },
        ],
        weeklyBaseline: { averageKwh: 5_681.25, minimumKwh: 5_500, maximumKwh: 5_800 },
        usageEstimate: { projectedKwh: 24_348.2143, lowerKwh: 23_571.4286, upperKwh: 24_857.1429 },
        costEstimate: {
          currency: "SGD",
          currentPeriodBeforeGstSgd: 6_796.1782,
          projectedBeforeGstSgd: 6_639.7591,
          lowerBeforeGstSgd: 6_427.9286,
          upperBeforeGstSgd: 6_778.5429,
        },
        tariffReference: {
          sourceName: "SP Group",
          sourceUrl: "https://www.spgroup.com.sg/about-us/media-resources/news-and-media-releases/Electricity-Tariff-Revision-for-the-Period-1-April-to-30-June-2026",
          appendixUrl: "https://www.spgroup.com.sg/dam/spgroup/images/news-media-releases/2026/Appendix-2---Q2-2026.png0",
          supplyClass: "Low tension, non-domestic",
          appliesFrom: "2026-04-01",
          appliesTo: "2026-06-30",
          beforeGstSgdPerKwh: 0.2727,
          withGstSgdPerKwh: 0.2972,
        },
        evidence: {
          dataSnapshotId: "preschool-26b85b9c0b95e090",
          queryId: "daily_totals_v1",
          recipeId: "preschool-naive-weekly-planning-baseline-v1",
        },
        estimateSeries: {
          contract: {
            id: "preschool-june-2026-estimate-series",
            version: "1",
            method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
          },
          scopes: [
            fixturePlanningEstimateScope({
              scopeId: "preschool-project",
              scopeName: "Preschool Portfolio",
              scopeType: "project",
              scopeRole: "portfolio",
              estimatedKwh: 24_348.2143,
            }),
            fixturePlanningEstimateScope({
              scopeId: "preschool-centre-1",
              scopeName: "Centre A",
              scopeType: "centre",
              scopeRole: "centre",
              estimatedKwh: 843.0985,
            }),
          ],
        },
        limitations: [
          "Planning baseline only; it is not an AI or validated statistical forecast.",
          "Weather, occupancy, holidays, operational changes and tariff-plan differences are not modelled.",
          "Cost uses the SP regulated low-tension non-domestic reference before GST, not the customer's contract or bill.",
        ],
      },
      spikes: {
        standby: {
          count: 7,
          centreCount: 3,
          centres: [...standbySpikeCounts].map(([code, count]) => spikeCentre(code, count, false)),
        },
        operating: {
          count: 21,
          centreCount: 14,
          centres: [...operatingSpikeCounts].map(([code, count]) => spikeCentre(code, count, true)),
        },
      },
      sop: {
        status: "provisional",
        label: "Provisional after-hours SOP signal",
        baselineScore: 100,
        deductionPerStandbySpike: 1,
        breachingCentreCodes: ["L", "E", "N"],
        centres: benchmarkCentres
          .map((centre) => ({
            scopeId: centre.scopeId,
            centreCode: centre.centreCode,
            name: centre.name,
            centreType: centre.cohort,
            standbySpikeCount: standbySpikeCounts.get(centre.centreCode) ?? 0,
            score: 100 - (standbySpikeCounts.get(centre.centreCode) ?? 0),
          }))
          .sort((left, right) => left.score - right.score || left.centreCode.localeCompare(right.centreCode)),
      },
      evidence: {
        projectReleaseId: "legacy-profile:preschool-demo:2",
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        metricRevisionIds: ["energy.total_usage_kwh@1"],
        businessCalendarVersion: "sg-preschool-calendar-v1",
        sourceQueryIds: ["scope_summary_v1"],
        projectionQueryId: "preschool_centre_hour_appliance_cells_v2",
        projectionRecipeIds: ["preschool-hour-slot-spike-v1", "preschool-after-hours-sop-signal-v1", "preschool-operating-state-appliance-v1"],
        baseline: "same-centre same-hour-slot mean within operating state",
      },
    },
    metadata: {
      status: "provisional",
      hierarchyRevisionId: "preschool-hierarchy-v4",
      timezone: "Asia/Singapore",
      period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-31T16:00:00.000Z" },
      selectedScope,
      comparisonScopes: centres.map((centre) => centre.metadata),
      evidence: [],
    },
    analysis: {
      ...base.analysis,
      context: {
        ...base.analysis.context,
        projectId: "preschool-demo",
        projectName: "Preschool Portfolio",
        scopeId: "preschool-project",
        scopeName: "Preschool Portfolio",
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-05-31T16:00:00.000Z",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        meterFormulaRevisionId: "preschool-formula-v1",
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        metricVersion: "metric-revisions:energy.total_usage_kwh@1,energy.usage_per_person,energy.usage_per_sqm",
        businessCalendarVersion: "sg-preschool-calendar-v1",
        tariffScheduleVersion: "missing",
      },
      summary: {
        ...base.analysis.summary,
        usageKwh: 24_921.8123,
        averageDailyUsageKwh: 803.9294,
        nonOperatingKwh: 3_103.784,
        nonOperatingSharePct: 12.45,
      },
      childScopes: centres,
      offHours: {
        status: "available",
        operatingKwh: 21_818.0283,
        standbyKwh: 3_103.784,
        usageKwh: 3_103.784,
        sharePct: 12.45,
        timezone: "Asia/Singapore",
        businessCalendarVersion: "sg-preschool-calendar-v1",
      },
      cost: {
        status: "unavailable",
        reason: {
          code: "TARIFF_VERSION_MISSING",
          message: "No published Preschool tariff is available for this Snapshot.",
        },
      },
      dataHealth: {
        ...base.analysis.dataHealth,
        status: "complete",
        coveragePct: 100,
        expectedMeterIntervalCount: 200_880,
        validIntervalCount: 200_880,
        qualityEventCount: 0,
      },
      metadata: {
        status: "provisional",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        timezone: "Asia/Singapore",
        period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-31T16:00:00.000Z" },
        selectedScope,
        comparisonScopes: centres.map((centre) => centre.metadata),
        evidence: [],
      },
      provenance: {
        ...base.analysis.provenance,
        dataSnapshotId: "preschool-26b85b9c0b95e090",
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterMappingRevisionId: "preschool-mapping-v4",
        meterFormulaRevisionId: "preschool-formula-v1",
        metricVersion: "metric-revisions:energy.total_usage_kwh@1,energy.usage_per_person,energy.usage_per_sqm",
      },
    },
  } as unknown as EnergyProjectAnalysisSnapshotDto;
}
