import type {
  EnergyProjectAnalysisMetadataDto,
  EnergyProjectAnalysisSnapshotDto,
} from "../../../lib/config-api";

export function ngeeAnnGoldenSnapshot(input: {
  dataStatus?: "complete" | "partial" | "unavailable";
  coveragePct?: number;
  validIntervalCount?: number;
  expectedMeterIntervalCount?: number;
  lastSeenAt?: string | null;
  costAvailable?: boolean;
  levelFactsAvailable?: boolean;
} = {}): EnergyProjectAnalysisSnapshotDto {
  const dataStatus = input.dataStatus ?? "complete";
  const coveragePct = input.coveragePct ?? (dataStatus === "complete" ? 100 : dataStatus === "partial" ? 50 : 0);
  const expectedMeterIntervalCount = input.expectedMeterIntervalCount ?? 2_688;
  const validIntervalCount = input.validIntervalCount
    ?? (dataStatus === "complete" ? expectedMeterIntervalCount : dataStatus === "partial" ? 1_344 : 0);
  const lastSeenAt = input.lastSeenAt === undefined ? "2026-06-17T15:45:00.000Z" : input.lastSeenAt;
  const metadata = missingMetadata();
  const queryIds = [
    "scope_summary_v1",
    "daily_totals_v1",
    "daily_component_categories_v1",
    "time_bucket_grid_v1",
    "component_hourly_profiles_v1",
    "time_slot_anomaly_v1",
    "peak_breakdown_v1",
    "hourly_profile_v1",
    "meter_breakdown_v1",
    "previous_meter_usage_v1",
    "operational_policy_scope_intervals_v1",
    "operational_policy_meter_intervals_v1",
  ] as const;
  const categoryDataHealth = {
    coveragePct: 100,
    expectedMeterIntervalCount: 1_344,
    validIntervalCount: 1_344,
    qualityEventCount: 0,
  };
  const circuitDataHealth = {
    coveragePct: 100,
    expectedMeterIntervalCount: 672,
    validIntervalCount: 672,
    qualityEventCount: 0,
  };
  const topCircuits: EnergyProjectAnalysisSnapshotDto["analysis"]["topCircuits"] = [
    {
      meterNodeId: "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
      name: "Office Load 4 Fan ISOL 1/2",
      appliance: "Fan ISOL 1/2",
      category: "load",
      meterRole: "component",
      usageKwh: 439.0972,
      sharePct: 28.6773,
      peakKw: 3.5307,
      qualityEventCount: 0,
      scopeId: "l7-load-4",
      parentScopeId: "level-7",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 247.9813, changeKwh: 191.1159, changePct: 77.0687 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-7-office-load-3-l1p16-l3p21-15",
      name: "Office Load 3",
      appliance: "Office Load 3",
      category: "load",
      meterRole: "component",
      usageKwh: 337.9023,
      sharePct: 22.0683,
      peakKw: 3.017,
      qualityEventCount: 0,
      scopeId: "l7-load-3",
      parentScopeId: "level-7",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 166.7234, changeKwh: 171.1789, changePct: 102.6724 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-office-load-4-l1p19-l3p24-6",
      name: "Lvl 6 Office Load 4: L1P19-L3P24",
      appliance: "Office Load 4",
      category: "load",
      meterRole: "component",
      usageKwh: 255.1539,
      sharePct: 16.664,
      peakKw: 2.2782,
      qualityEventCount: 0,
      scopeId: "l6-load-4",
      parentScopeId: "level-6",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 262.7359, changeKwh: -7.5821, changePct: -2.8858 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-7-front-row-office-light-11",
      name: "Front Row Office Light",
      appliance: "Office Light",
      category: "light",
      meterRole: "component",
      usageKwh: 107.02,
      sharePct: 6.9894,
      peakKw: 0.9555,
      qualityEventCount: 0,
      scopeId: "l7-front-light",
      parentScopeId: "level-7",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 124.28, changeKwh: -17.26, changePct: -13.888 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-office-light-right-internal-2",
      name: "Lvl 6 Office Light-Right: Internal",
      appliance: "Office Light",
      category: "light",
      meterRole: "component",
      usageKwh: 70.6873,
      sharePct: 4.6166,
      peakKw: 0.6311,
      qualityEventCount: 0,
      scopeId: "l6-light-right",
      parentScopeId: "level-6",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 76.9724, changeKwh: -6.2851, changePct: -8.1653 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-7-office-load-2-l1p7-l3p15-14",
      name: "Office Load 2",
      appliance: "Office Load 2",
      category: "load",
      meterRole: "component",
      usageKwh: 66.1682,
      sharePct: 4.3214,
      peakKw: 0.5908,
      qualityEventCount: 0,
      scopeId: "l7-load-2",
      parentScopeId: "level-7",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 67.3961, changeKwh: -1.2279, changePct: -1.8219 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-7-back-row-office-light-10",
      name: "Back Row Office Light",
      appliance: "Office Light",
      category: "light",
      meterRole: "component",
      usageKwh: 48.9043,
      sharePct: 3.1939,
      peakKw: 0.4366,
      qualityEventCount: 0,
      scopeId: "l7-back-light",
      parentScopeId: "level-7",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 58.7596, changeKwh: -9.8553, changePct: -16.7723 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-office-load-5-l1p25-l3p29-fan-isol-1-2-7",
      name: "Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2",
      appliance: "Fan Isol 1/2",
      category: "load",
      meterRole: "component",
      usageKwh: 42.3355,
      sharePct: 2.7649,
      peakKw: 0.378,
      qualityEventCount: 0,
      scopeId: "l6-load-5",
      parentScopeId: "level-6",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 44.1685, changeKwh: -1.833, changePct: -4.15 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-office-light-left-external-1",
      name: "Lvl 6 Office Light-Left: External",
      appliance: "Office Light",
      category: "light",
      meterRole: "component",
      usageKwh: 40.2871,
      sharePct: 2.6311,
      peakKw: 0.3597,
      qualityEventCount: 0,
      scopeId: "l6-light-left",
      parentScopeId: "level-6",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 28.0518, changeKwh: 12.2352, changePct: 43.6164 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-office-load-2-l1p7-l3p12-4",
      name: "Lvl 6 Office Load 2: L1P7-L3P12",
      appliance: "Office Load 2",
      category: "load",
      meterRole: "component",
      usageKwh: 37.4839,
      sharePct: 2.4481,
      peakKw: 0.3347,
      qualityEventCount: 0,
      scopeId: "l6-load-2",
      parentScopeId: "level-6",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 42.0907, changeKwh: -4.6068, changePct: -10.9449 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-7-office-load-1-l1p1-l3p6-13",
      name: "Office Load 1",
      appliance: "Office Load 1",
      category: "load",
      meterRole: "component",
      usageKwh: 28.122,
      sharePct: 1.8366,
      peakKw: 0.2511,
      qualityEventCount: 0,
      scopeId: "l7-load-1",
      parentScopeId: "level-7",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 30.6142, changeKwh: -2.4921, changePct: -8.1405 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-7-middle-row-office-light-12",
      name: "Middle Row Office Light",
      appliance: "Office Light",
      category: "light",
      meterRole: "component",
      usageKwh: 20.7678,
      sharePct: 1.3563,
      peakKw: 0.2,
      qualityEventCount: 0,
      scopeId: "l7-middle-light",
      parentScopeId: "level-7",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 32.3325, changeKwh: -11.5647, changePct: -35.7679 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-office-load-3-l1p13-l3p18-5",
      name: "Lvl 6 Office Load 3: L1P13-L3P18",
      appliance: "Office Load 3",
      category: "load",
      meterRole: "component",
      usageKwh: 13.5291,
      sharePct: 0.8836,
      peakKw: 0.2,
      qualityEventCount: 0,
      scopeId: "l6-load-3",
      parentScopeId: "level-6",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 12.8193, changeKwh: 0.7098, changePct: 5.5372 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
      name: "Lvl 6 Office Load 1: L1P1-L3P6",
      appliance: "Office Load 1",
      category: "load",
      meterRole: "component",
      usageKwh: 11.5379,
      sharePct: 0.7535,
      peakKw: 0.2,
      qualityEventCount: 0,
      scopeId: "l6-load-1",
      parentScopeId: "level-6",
      includedInOfficialTotal: false,
      comparison: { usageKwh: 4.2616, changeKwh: 7.2763, changePct: 170.7386 },
      dataHealth: circuitDataHealth,
    },
  ];
  const designatedTotals: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["designatedTotals"]> = [
    {
      meterNodeId: "mapping-lvl-7-total-office-load-18",
      name: "Total Office Load",
      appliance: "Office Load",
      category: "load",
      meterRole: "total",
      usageKwh: 874.1282,
      sharePct: 57.089,
      peakKw: 0,
      qualityEventCount: 0,
      scopeId: "l7-total-load",
      parentScopeId: "level-7",
      includedInOfficialTotal: true,
      comparison: { usageKwh: 609.1505, changeKwh: 264.9777, changePct: 43.4995 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-total-office-load-9",
      name: "Lvl 6 Total Office Load",
      appliance: "Office Load",
      category: "load",
      meterRole: "total",
      usageKwh: 365.2958,
      sharePct: 23.8573,
      peakKw: 0,
      qualityEventCount: 0,
      scopeId: "l6-total-load",
      parentScopeId: "level-6",
      includedInOfficialTotal: true,
      comparison: { usageKwh: 365.3477, changeKwh: -0.0519, changePct: -0.0142 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-7-total-office-light-17",
      name: "Total Office Light",
      appliance: "Office Light",
      category: "light",
      meterRole: "total",
      usageKwh: 180.0563,
      sharePct: 11.7594,
      peakKw: 0,
      qualityEventCount: 0,
      scopeId: "l7-total-light",
      parentScopeId: "level-7",
      includedInOfficialTotal: true,
      comparison: { usageKwh: 125.4752, changeKwh: 54.5811, changePct: 43.4995 },
      dataHealth: circuitDataHealth,
    },
    {
      meterNodeId: "mapping-lvl-6-total-office-light-8",
      name: "Lvl 6 Total Office Light",
      appliance: "Office Light",
      category: "light",
      meterRole: "total",
      usageKwh: 111.6881,
      sharePct: 7.2943,
      peakKw: 0,
      qualityEventCount: 0,
      scopeId: "l6-total-light",
      parentScopeId: "level-6",
      includedInOfficialTotal: true,
      comparison: { usageKwh: 111.7039, changeKwh: -0.0159, changePct: -0.0142 },
      dataHealth: circuitDataHealth,
    },
  ];

  const timeBehaviour = goldenTimeBehaviour();
  const analysis: EnergyProjectAnalysisSnapshotDto["analysis"] = {
    context: {
      userId: "user-1",
      workspaceId: "workspace-1",
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-06-09T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-ngee-ann-golden",
      metricVersion: "metric-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-04T00:00:00.000Z",
    },
    latestAcceptedReading: {
      status: "not_applicable",
      queryId: "latest_accepted_reading_v1",
      reason: {
        code: "LEAF_METER_REQUIRED",
        message: "Select a leaf Meter or Circuit to view its latest accepted cumulative reading.",
      },
    },
    summary: {
      usageKwh: 1531.168324,
      averageDailyUsageKwh: 218.738332,
      peakKw: 20.673108,
      peakAt: "2026-06-11T06:00:00.000Z",
      validIntervalCount,
      qualityEventCount: 0,
    },
    hourlyProfile: GOLDEN_PERIOD_HOURLY_PROFILE.map(([hour, usageKwh, averageKw, peakKw]) => ({
      hour,
      usageKwh,
      averageKw,
      peakKw,
      observationCount: 28,
    })),
    dailyTotals: goldenDailyTotals(),
    timeBehaviour,
    dailyUsageAnomalies: goldenDailyUsageAnomalies(timeBehaviour),
    peakBreakdown: goldenPeakBreakdown(topCircuits, dataStatus, coveragePct),
    comparison: {
      from: "2026-06-02T16:00:00.000Z",
      to: "2026-06-09T16:00:00.000Z",
      usageKwh: 1211.6773,
      changeKwh: 319.4911,
      changePct: 26.3677,
    },
    categories: [
      {
        category: "load",
        usageKwh: 1239.4239,
        sharePct: 80.9463,
        comparison: { usageKwh: 887.217, changeKwh: 352.2069, changePct: 39.6979 },
        dataHealth: categoryDataHealth,
      },
      {
        category: "light",
        usageKwh: 291.7444,
        sharePct: 19.0537,
        comparison: { usageKwh: 324.4602, changeKwh: -32.7158, changePct: -10.0832 },
        dataHealth: categoryDataHealth,
      },
    ],
    childScopes: [
      {
        nodeId: "level-7",
        name: "Level 7",
        nodeType: "level",
        usageKwh: 1054.1845,
        sharePct: 68.8484,
        metadata: missingScopeMetadata("level-7", "Level 7", 1054.1845),
        ...(input.levelFactsAvailable === false ? {} : {
          comparison: {
            usageKwh: 734.6257,
            changeKwh: 319.5588,
            changePct: 43.4995,
          },
          dataHealth: {
            coveragePct: 100,
            expectedMeterIntervalCount: 1_344,
            validIntervalCount: 1_344,
            qualityEventCount: 0,
          },
        }),
      },
      {
        nodeId: "level-6",
        name: "Level 6",
        nodeType: "level",
        usageKwh: 476.9838,
        sharePct: 31.1516,
        metadata: missingScopeMetadata("level-6", "Level 6", 476.9838),
        ...(input.levelFactsAvailable === false ? {} : {
          comparison: {
            usageKwh: 477.0516,
            changeKwh: -0.0678,
            changePct: -0.0142,
          },
          dataHealth: {
            coveragePct: 100,
            expectedMeterIntervalCount: 1_344,
            validIntervalCount: 1_344,
            qualityEventCount: 0,
          },
        }),
      },
    ],
    circuits: [...designatedTotals, ...topCircuits],
    topCircuits,
    designatedTotals,
    componentReconciliation: {
      officialUsageKwh: 1531.168324,
      componentUsageKwh: 1518.99648,
      gapKwh: 12.171844,
      ratioPct: 99.20506166374952,
      officialMeterNodeIds: designatedTotals.map((circuit) => circuit.meterNodeId),
      componentMeterNodeIds: topCircuits.map((circuit) => circuit.meterNodeId),
    },
    virtualMeters: [{
      meterNodeId: "ngee-ann-load-12-v1",
      name: "Load 12",
      scopeId: "level-6",
      termMeterNodeIds: [
        "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
        "mapping-lvl-6-office-load-2-l1p7-l3p12-4",
      ],
      usageKwh: 49.0218,
      includedInOfficialTotal: false,
    }],
    virtualMeterTraces: [{
      meterNodeId: "ngee-ann-load-12-v1",
      name: "Load 12",
      scopeId: "level-6",
      status: "available",
      usageKwh: 49.0218,
      includedInOfficialTotal: false,
      missingTermMeterNodeIds: [],
      terms: [
        {
          meterNodeId: "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
          name: "Lvl 6 Office Load 1: L1P1-L3P6",
          coefficient: 1,
          inputUsageKwh: 11.5379,
          contributionKwh: 11.5379,
          dataHealth: circuitDataHealth,
        },
        {
          meterNodeId: "mapping-lvl-6-office-load-2-l1p7-l3p12-4",
          name: "Lvl 6 Office Load 2: L1P7-L3P12",
          coefficient: 1,
          inputUsageKwh: 37.4839,
          contributionKwh: 37.4839,
          dataHealth: circuitDataHealth,
        },
      ],
    }],
    offHours: {
      status: "available",
      operatingKwh: 1_200,
      standbyKwh: 331.168324,
      usageKwh: 331.168324,
      sharePct: 21.63,
      timezone: "Asia/Singapore",
      businessCalendarVersion: "calendar-v1",
    },
    cost: input.costAvailable === false
      ? {
        status: "unavailable",
        reason: { code: "TARIFF_VERSION_MISSING", message: "No effective Tariff covers the selected period." },
        tariffScheduleVersion: "tariff-v1",
      }
      : {
        status: "available",
        amount: 489.973864,
        currency: "SGD",
        tariffScheduleVersion: "tariff-v1",
        allocations: [{
          from: "2026-06-09T16:00:00.000Z",
          to: "2026-06-16T16:00:00.000Z",
          ratePerKwh: 0.32,
          usageKwh: 1531.168324,
          cost: 489.973864,
        }],
      },
    dataHealth: {
      status: dataStatus,
      coveragePct,
      expectedMeterIntervalCount,
      validIntervalCount,
      qualityEventCount: 0,
      cumulativeDeltaMismatchCount: 0,
      averageKwMismatchCount: 0,
      invalidIntervalDurationCount: 0,
      ...(lastSeenAt ? { lastSeenAt } : {}),
      importBatchIds: ["batch-1", "batch-2", "batch-3", "batch-4"],
    },
    units: {
      usage: "kWh",
      demand: "kW",
      intervalMinutes: 15,
      timezone: "Asia/Singapore",
    },
    attention: [{
      code: "PEAK_FOCUS",
      severity: "info",
      title: "Review the Level 7 contribution to the recorded peak",
      evidence: "The trusted Project result identifies Level 7 as the largest child Scope.",
      suggestedAction: "Open Level 7 in the Scope selector and verify its leading Circuits.",
    }],
    provenance: {
      dataSnapshotId: "snapshot-ngee-ann-golden",
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metric-v1",
      ruleRevisionIds: ["rule-v1", "comparison.daily_usage_above_baseline@1"],
      aggregationRule: "designated_total",
      sourceView: "energy_scope_intervals",
      queryIds: [...queryIds],
    },
    metadata,
  };

  analysis.componentCategoryBreakdown = goldenComponentCategoryBreakdown(analysis);
  analysis.componentHourlyProfiles = goldenComponentHourlyProfiles(timeBehaviour, topCircuits);

  return {
    context: {
      ...analysis.context,
      primaryPeriod: {
        start: "2026-06-09T16:00:00.000Z",
        endExclusive: "2026-06-16T16:00:00.000Z",
      },
      projectReleaseId: "release-ngee-ann-golden",
    },
    projectRelease: {
      id: "release-ngee-ann-golden",
      source: "template-revision",
      projectId: "ngee-ann-polytechnic",
      templateRevisionId: "template-v1",
      templateRevisionSequence: 1,
      reportTimePolicyRevisionId: "ngee-ann-report-time@1",
      recipe: { id: "energy-scope-analysis", version: "1" },
      renderer: {
        key: "ngee-ann-overview",
        version: "1",
        contractVersion: "project-analysis-snapshot@1",
      },
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricRevisionIds: ["energy.total_usage_kwh@1", "energy.peak_demand_kw@1"],
      ruleRevisionIds: ["rule-v1", "comparison.daily_usage_above_baseline@1"],
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      publishedAt: "2026-08-04T00:00:00.000Z",
      document: { schema_version: 2, templates: [] },
      catalog: [],
    },
    recipe: { id: "energy-scope-analysis", version: "1" },
    renderer: {
      key: "ngee-ann-overview",
      version: "1",
      contractVersion: "project-analysis-snapshot@1",
    },
    dataQuality: analysis.dataHealth,
    evidence: [{
      id: "evidence:ngee-ann-golden:energy.total_usage_kwh@1",
      metricId: "energy.total_usage_kwh@1",
      queryIds: [...queryIds],
      queryReceiptId: "receipt-ngee-ann-golden",
    }, {
      id: "evidence:ngee-ann-golden:energy.peak_demand_kw@1",
      metricId: "energy.peak_demand_kw@1",
      queryIds: ["peak_breakdown_v1"],
      queryReceiptId: "receipt-ngee-ann-golden-peak",
    }],
    findings: analysis.attention,
    dataSnapshot: {
      id: "snapshot-ngee-ann-golden",
      importBatchIds: ["batch-1", "batch-2", "batch-3", "batch-4"],
      lastSeenAt,
    },
    decisionPriorities: goldenDecisionPriorities(),
    decisionLifecycle: {
      status: "available",
      reference: {
        savedAnalysisId: "saved-analysis-ngee-ann-a",
        dataSnapshotId: "snapshot-ngee-ann-a",
        createdAt: "2026-06-17T01:00:00.000Z",
        evidenceStatus: "unavailable",
      },
      currentDataSnapshotId: "snapshot-ngee-ann-golden",
      items: [{
        themeKey: "decision-theme:daily_usage_anomaly:comparison.daily_usage_above_baseline@1:energy.total_usage_kwh@1:project",
        kind: "newly_supported",
        currentPriorityId: "decision-theme:anomaly-bundle-ngee-ann-golden:comparison.daily_usage_above_baseline@1:energy.total_usage_kwh@1:project",
        currentBundleId: "anomaly-bundle-ngee-ann-golden",
        previousBundleId: null,
      }],
      limitation: null,
    },
    metadata,
    analysis,
  };
}

function goldenComponentCategoryBreakdown(
  analysis: EnergyProjectAnalysisSnapshotDto["analysis"],
): NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["componentCategoryBreakdown"]> {
  const componentCircuits = analysis.circuits.filter((circuit) => circuit.includedInOfficialTotal === false);
  const scopeRows = analysis.dailyTotals?.scopes ?? [];
  return {
    metricId: "energy.total_usage_kwh@1",
    queryId: "daily_component_categories_v1",
    accountingBasis: "published_component_circuits",
    grain: "day",
    timezone: "Asia/Singapore",
    scopes: scopeRows.map((scope) => {
      const circuits = componentCircuits.filter((circuit) =>
        scope.scopeId === "project" || circuit.parentScopeId === scope.scopeId,
      );
      const categoryUsage = new Map<string, number>();
      for (const circuit of circuits) {
        categoryUsage.set(circuit.category, (categoryUsage.get(circuit.category) ?? 0) + circuit.usageKwh);
      }
      const componentUsageKwh = [...categoryUsage.values()].reduce((sum, value) => sum + value, 0);
      const officialUsageKwh = scope.rows.reduce((sum, row) => sum + (row.usageKwh ?? 0), 0);
      const ratio = officialUsageKwh > 0 ? componentUsageKwh / officialUsageKwh : 0;
      const categories = [...categoryUsage.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([category, usageKwh]) => ({
          category,
          usageKwh: roundFixture(usageKwh),
          sharePct: componentUsageKwh > 0 ? roundFixture(usageKwh / componentUsageKwh * 100) : 0,
        }));
      return {
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        scopeType: scope.scopeType,
        period: {
          status: "complete",
          reason: null,
          officialUsageKwh: roundFixture(officialUsageKwh),
          componentUsageKwh: roundFixture(componentUsageKwh),
          gapKwh: roundFixture(officialUsageKwh - componentUsageKwh),
          ratioPct: officialUsageKwh > 0 ? roundFixture(componentUsageKwh / officialUsageKwh * 100) : null,
          categories,
        },
        rows: scope.rows.map((row) => {
          const componentDaily = row.usageKwh === null ? null : row.usageKwh * ratio;
          const localDay = new Date(`${row.localDate}T00:00:00.000Z`).getUTCDay();
          return {
            localDate: row.localDate,
            from: row.from,
            to: row.to,
            dayType: localDay === 0 || localDay === 6 ? "weekend" as const : "weekday" as const,
            officialUsageKwh: row.usageKwh,
            componentUsageKwh: componentDaily === null ? null : roundFixture(componentDaily),
            categories: categories.map((category) => ({
              category: category.category,
              usageKwh: componentDaily === null || componentUsageKwh === 0
                ? null
                : roundFixture(componentDaily * category.usageKwh / componentUsageKwh),
              sharePct: componentDaily === null ? null : category.sharePct,
            })),
            estimatedCost: analysis.cost.status === "available" && row.usageKwh !== null
              ? {
                status: "available" as const,
                amount: roundFixture(row.usageKwh * analysis.cost.allocations[0]!.ratePerKwh),
                currency: analysis.cost.currency,
                ratePerKwh: analysis.cost.allocations[0]!.ratePerKwh,
                tariffScheduleVersion: analysis.cost.tariffScheduleVersion,
              }
              : {
                status: "unavailable" as const,
                reason: analysis.cost.status === "unavailable"
                  ? analysis.cost.reason.message
                  : "Official daily usage is unavailable.",
              },
            dataHealth: {
              status: row.dataHealth.status,
              coveragePct: row.dataHealth.coveragePct,
              expectedMeterIntervalCount: circuits.length * 96,
              validIntervalCount: row.dataHealth.status === "unavailable" ? 0 : circuits.length * 96,
              qualityEventCount: row.dataHealth.qualityEventCount,
            },
          };
        }),
      };
    }),
  };
}

function goldenDecisionPriorities(): NonNullable<EnergyProjectAnalysisSnapshotDto["decisionPriorities"]> {
  const primaryIncidentId = "incident:project:2026-06-13";
  const sourceOccurrenceIds = [
    "incident:level-7:2026-06-11",
    "incident:level-7:2026-06-12",
    "incident:level-7:2026-06-13",
    "incident:level-7:2026-06-14",
    "incident:project:2026-06-11",
    primaryIncidentId,
    "incident:project:2026-06-14",
  ];
  return {
    status: "available",
    limitation: null,
    evidencePins: {
      projectReleaseId: "release-ngee-ann-golden",
      dataSnapshotId: "snapshot-ngee-ann-golden",
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metric-v1",
      businessCalendarVersion: "calendar-v1",
      queryIds: ["time_slot_anomaly_v1"],
    },
    items: [{
      priorityId: "decision-theme:anomaly-bundle-ngee-ann-golden:comparison.daily_usage_above_baseline@1:energy.total_usage_kwh@1:project",
      rank: 1,
      source: "daily_usage_anomaly",
      finding: {
        code: "DAILY_USAGE_ABOVE_BASELINE",
        title: "Ngee Ann Polytechnic recorded 3 distinct daily usage exceptions in this Snapshot.",
        actualKwh: 168.9645,
        baselineKwh: 63.3385,
        relativePct: 166.7643,
      },
      sourceOccurrenceIds,
      recurrenceDayCount: 3,
      horizons: [
        {
          horizon: "latest_complete_day",
          label: "Latest complete day",
          status: "available",
          period: { fromLocalDate: "2026-06-16", toLocalDate: "2026-06-16" },
          actualKwh: 221.9982,
          baselineKwh: 218.885,
          deltaKwh: 3.1132,
          relativePct: 1.4223,
          limitation: null,
        },
        {
          horizon: "rolling_7d",
          label: "Rolling 7 days",
          status: "available",
          period: { fromLocalDate: "2026-06-10", toLocalDate: "2026-06-16" },
          actualKwh: 1531.1683,
          baselineKwh: 1211.6773,
          deltaKwh: 319.491,
          relativePct: 26.3677,
          limitation: null,
        },
        {
          horizon: "rolling_28d",
          label: "Rolling 28 days",
          status: "available",
          period: { fromLocalDate: "2026-05-20", toLocalDate: "2026-06-16" },
          actualKwh: 4904.8659,
          baselineKwh: 4831.5555,
          deltaKwh: 73.3104,
          relativePct: 1.5173,
          limitation: null,
        },
      ],
      driver: {
        status: "available",
        kind: "official_scope",
        scopeId: "level-7",
        label: "Level 7",
        impactKwh: 88.098,
        limitation: "Evidence only; not a confirmed root cause.",
      },
      evidence: {
        bundleId: "anomaly-bundle-ngee-ann-golden",
        metricId: "energy.total_usage_kwh@1",
        queryIds: ["time_slot_anomaly_v1"],
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        period: { from: "2026-06-09T16:00:00.000Z", to: "2026-06-16T16:00:00.000Z" },
        occurrence: {
          scopeId: "project",
          scopeName: "Ngee Ann Polytechnic",
          scopeType: "project",
          localDate: "2026-06-13",
          from: "2026-06-12T16:00:00.000Z",
          to: "2026-06-13T16:00:00.000Z",
        },
        primaryIncidentId,
        supportingIncidentIds: sourceOccurrenceIds.filter((id) => id !== primaryIncidentId),
      },
      impact: {
        energy: { status: "available", deltaKwh: 105.626 },
        cost: {
          status: "unavailable",
          reason: {
            code: "INCIDENT_COST_NOT_SUPPORTED_BY_CURRENT_EVIDENCE",
            message: "The current daily anomaly Evidence does not calculate an incident-level cost delta.",
          },
        },
      },
      action: {
        code: "INSPECT_DAILY_USAGE_DRIVERS",
        label: "Review the strongest supported Level, Circuit and hourly Evidence before changing schedules or equipment.",
        targetIncidentId: primaryIncidentId,
        targetRef: { kind: "daily_usage_incident", id: primaryIncidentId },
        nextCheck: "Open the highest-impact day, then compare its hourly pattern and largest contributing Circuits with a comparable day.",
        verificationMetricRef: {
          metricId: "energy.total_usage_kwh@1",
          label: "After the check, compare daily and 7-day usage with the same baseline",
        },
      },
      confidence: { status: "complete", limitation: null },
    }],
  };
}

export function ngeeAnnSingleDaySnapshot(input: { includeDailyTotals?: boolean } = {}): EnergyProjectAnalysisSnapshotDto {
  const snapshot = ngeeAnnGoldenSnapshot();
  const start = "2026-06-15T16:00:00.000Z";
  const endExclusive = "2026-06-16T16:00:00.000Z";
  snapshot.context.primaryPeriod = { start, endExclusive };
  snapshot.context.from = start;
  snapshot.context.to = endExclusive;
  snapshot.analysis.context.from = start;
  snapshot.analysis.context.to = endExclusive;
  delete snapshot.analysis.dailyUsageAnomalies;
  if (input.includeDailyTotals === false) {
    delete snapshot.analysis.dailyTotals;
  } else {
    for (const scope of snapshot.analysis.dailyTotals!.scopes) {
      scope.rows = scope.rows.filter((row) => row.localDate === "2026-06-16");
    }
  }
  const timeBehaviour = snapshot.analysis.timeBehaviour!;
  for (const scope of timeBehaviour.scopes) {
    scope.cells = scope.cells.filter((cell) => cell.localDate === "2026-06-16");
  }
  timeBehaviour.dayProfiles = timeBehaviour.scopes.flatMap((scope) => [
    {
      dayType: "weekday" as const,
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      status: "available" as const,
      sampleDayCount: 1,
      values: scope.cells.map((cell) => ({
        localHour: cell.localHour,
        usageKwh: cell.usageKwh!,
      })),
    },
    {
      dayType: "weekend" as const,
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      status: "unavailable" as const,
      reason: {
        code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE" as const,
        message: `No complete weekend local-day sample is available for ${scope.scopeName}.`,
      },
    },
    {
      dayType: "public_holiday" as const,
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      status: "unavailable" as const,
      reason: {
        code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" as const,
        message: "Public Holiday profile requires an authoritative release-pinned Calendar classification.",
      },
    },
  ]);
  return snapshot;
}

function goldenPeakBreakdown(
  circuits: EnergyProjectAnalysisSnapshotDto["analysis"]["topCircuits"],
  dataStatus: "complete" | "partial" | "unavailable",
  coveragePct: number,
): NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["peakBreakdown"]> {
  const completeHealth = (expectedMeterIntervalCount: number) => ({
    status: "complete" as const,
    coveragePct: 100 as const,
    expectedMeterIntervalCount,
    validIntervalCount: expectedMeterIntervalCount,
    qualityEventCount: 0 as const,
  });
  const circuitFacts = new Map<string, { averageKw: number; sharePct: number }>([
    ["mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16", { averageKw: 3.3922, sharePct: 28.1194 }],
    ["mapping-lvl-7-office-load-3-l1p16-l3p21-15", { averageKw: 3.2421, sharePct: 26.8748 }],
    ["mapping-lvl-7-front-row-office-light-11", { averageKw: 1.9506, sharePct: 16.1694 }],
    ["mapping-lvl-7-back-row-office-light-10", { averageKw: 1.4399, sharePct: 11.936 }],
    ["mapping-lvl-7-office-load-2-l1p7-l3p15-14", { averageKw: 1.3746, sharePct: 11.3947 }],
    ["mapping-lvl-7-middle-row-office-light-12", { averageKw: 0.3004, sharePct: 2.4898 }],
    ["mapping-lvl-7-office-load-1-l1p1-l3p6-13", { averageKw: 0.1804, sharePct: 1.4956 }],
    ["mapping-lvl-6-office-load-4-l1p19-l3p24-6", { averageKw: 3.4747, sharePct: 40.3592 }],
    ["mapping-lvl-6-office-light-right-internal-2", { averageKw: 1.5823, sharePct: 18.3784 }],
    ["mapping-lvl-6-office-light-left-external-1", { averageKw: 1.4839, sharePct: 17.2353 }],
    ["mapping-lvl-6-office-load-5-l1p25-l3p29-fan-isol-1-2-7", { averageKw: 0.5735, sharePct: 6.6611 }],
    ["mapping-lvl-6-office-load-1-l1p1-l3p6-3", { averageKw: 0.5018, sharePct: 5.8282 }],
    ["mapping-lvl-6-office-load-2-l1p7-l3p12-4", { averageKw: 0.4295, sharePct: 4.9887 }],
    ["mapping-lvl-6-office-load-3-l1p13-l3p18-5", { averageKw: 0.4028, sharePct: 4.6787 }],
  ]);
  const circuitRow = (meterNodeId: string) => {
    const circuit = circuits.find((candidate) => candidate.meterNodeId === meterNodeId)!;
    const fact = circuitFacts.get(meterNodeId)!;
    return {
      meterNodeId,
      name: circuit.name,
      category: circuit.category,
      averageKw: fact.averageKw,
      sharePct: fact.sharePct,
      includedInOfficialTotal: false as const,
      dataHealth: completeHealth(1),
    };
  };

  return {
    status: "available",
    metricId: "energy.peak_demand_kw@1",
    intervalMinutes: 15,
    timezone: "Asia/Singapore",
    unit: "kW",
    periodStatus: dataStatus === "complete" ? "complete" : "partial",
    coveragePct,
    peak: {
      from: "2026-06-11T06:00:00.000Z",
      to: "2026-06-11T06:15:00.000Z",
      averageKw: 20.6731,
      dataHealth: completeHealth(4),
    },
    levels: [
      {
        scopeId: "level-7",
        scopeName: "Level 7",
        averageKw: 12.0637,
        sharePct: 58.3545,
        dataHealth: completeHealth(2),
        circuits: [
          circuitRow("mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16"),
          circuitRow("mapping-lvl-7-office-load-3-l1p16-l3p21-15"),
          circuitRow("mapping-lvl-7-front-row-office-light-11"),
          circuitRow("mapping-lvl-7-back-row-office-light-10"),
          circuitRow("mapping-lvl-7-office-load-2-l1p7-l3p15-14"),
          circuitRow("mapping-lvl-7-middle-row-office-light-12"),
          circuitRow("mapping-lvl-7-office-load-1-l1p1-l3p6-13"),
        ],
      },
      {
        scopeId: "level-6",
        scopeName: "Level 6",
        averageKw: 8.6094,
        sharePct: 41.6455,
        dataHealth: completeHealth(2),
        circuits: [
          circuitRow("mapping-lvl-6-office-load-4-l1p19-l3p24-6"),
          circuitRow("mapping-lvl-6-office-light-right-internal-2"),
          circuitRow("mapping-lvl-6-office-light-left-external-1"),
          circuitRow("mapping-lvl-6-office-load-5-l1p25-l3p29-fan-isol-1-2-7"),
          circuitRow("mapping-lvl-6-office-load-1-l1p1-l3p6-3"),
          circuitRow("mapping-lvl-6-office-load-2-l1p7-l3p12-4"),
          circuitRow("mapping-lvl-6-office-load-3-l1p13-l3p18-5"),
        ],
      },
    ],
  };
}

const GOLDEN_DATES = [
  "2026-06-10",
  "2026-06-11",
  "2026-06-12",
  "2026-06-13",
  "2026-06-14",
  "2026-06-15",
  "2026-06-16",
] as const;

const GOLDEN_PERIOD_HOURLY_PROFILE = [
  [0, 34.102316, 4.871759, 5.649868],
  [1, 33.992199, 4.856028, 5.717524],
  [2, 33.932614, 4.847516, 5.626752],
  [3, 33.832089, 4.833156, 5.607356],
  [4, 33.964286, 4.852041, 5.753408],
  [5, 33.891544, 4.841649, 5.62244],
  [6, 58.626076, 8.375154, 11.39578],
  [7, 73.499332, 10.499905, 15.036236],
  [8, 82.5721, 11.796014, 17.543976],
  [9, 92.633765, 13.233395, 19.907484],
  [10, 96.758198, 13.8226, 20.061168],
  [11, 96.989554, 13.855651, 19.1122],
  [12, 96.622015, 13.803145, 19.271664],
  [13, 98.235635, 14.033662, 20.28724],
  [14, 99.781167, 14.254452, 20.673108],
  [15, 98.641762, 14.09168, 19.677044],
  [16, 92.724402, 13.246343, 18.137052],
  [17, 81.79052, 11.68436, 16.41514],
  [18, 63.807229, 9.115318, 13.19846],
  [19, 40.634708, 5.804958, 8.338272],
  [20, 39.402286, 5.628898, 6.605116],
  [21, 39.09562, 5.585089, 6.298508],
  [22, 38.341055, 5.477294, 5.980136],
  [23, 37.297852, 5.328265, 5.671996],
] as const;

const GOLDEN_DAY_HOURLY_USAGE = [
  5.35652, 5.173563, 5.104549, 5.125056, 5.185748, 5.242188,
  9.238492, 11.201303, 12.091472, 13.781568, 13.979613, 13.843545,
  13.424247, 13.540453, 14.108092, 14.267255, 13.5892, 11.792498,
  9.493087, 5.396631, 5.279697, 5.299933, 5.304831, 5.178619,
] as const;

function goldenTimeBehaviour(): NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["timeBehaviour"]> {
  const scopeInputs = [
    {
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      dailyUsage: [253.7018, 268.399, 260.0659, 168.9645, 127.9387, 230.1002, 221.9982],
      expectedPerHour: 16,
    },
    {
      scopeId: "level-7",
      scopeName: "Level 7",
      scopeType: "level",
      dailyUsage: [157.1325, 182.6915, 170.9233, 114.7684, 115.1763, 157.1724, 156.3201],
      expectedPerHour: 8,
    },
    {
      scopeId: "level-6",
      scopeName: "Level 6",
      scopeType: "level",
      dailyUsage: [96.5693, 85.7075, 89.1426, 54.1961, 12.7624, 72.9278, 65.6781],
      expectedPerHour: 8,
    },
  ];
  const projectDailyUsage = scopeInputs[0]!.dailyUsage;
  const firstSixProjectUsage = projectDailyUsage.slice(0, -1).reduce((sum, value) => sum + value, 0);
  const projectCells = GOLDEN_DATES.flatMap((localDate, dateIndex) => (
    GOLDEN_PERIOD_HOURLY_PROFILE.map(([localHour, periodHourlyUsage]) => {
      const from = new Date(
        Date.parse(`${previousLocalDate(localDate)}T16:00:00.000Z`) + localHour * 3_600_000,
      ).toISOString();
      const usageKwh = dateIndex === GOLDEN_DATES.length - 1
        ? GOLDEN_DAY_HOURLY_USAGE[localHour]!
        : projectDailyUsage[dateIndex]!
          * (periodHourlyUsage - GOLDEN_DAY_HOURLY_USAGE[localHour]!)
          / firstSixProjectUsage;
      return {
        localDate,
        localHour,
        from,
        to: new Date(Date.parse(from) + 3_600_000).toISOString(),
        usageKwh: roundFixture(usageKwh),
      };
    })
  ));
  const scopes = scopeInputs.map((scope, scopeIndex) => ({
    scopeId: scope.scopeId,
    scopeName: scope.scopeName,
    scopeType: scope.scopeType,
    cells: projectCells.map((projectCell, cellIndex) => {
      const dateIndex = Math.floor(cellIndex / 24);
      const level7Ratio = scopeInputs[1]!.dailyUsage[dateIndex]! / projectDailyUsage[dateIndex]!;
      const usageKwh = scopeIndex === 0
        ? projectCell.usageKwh
        : scopeIndex === 1
          ? roundFixture(projectCell.usageKwh * level7Ratio)
          : roundFixture(projectCell.usageKwh - projectCell.usageKwh * level7Ratio);
      return {
        ...projectCell,
        usageKwh,
        dataHealth: {
          status: "complete" as const,
          coveragePct: 100,
          expectedMeterIntervalCount: scope.expectedPerHour,
          validIntervalCount: scope.expectedPerHour,
          qualityEventCount: 0,
        },
      };
    }),
  }));
  const dayProfiles: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["timeBehaviour"]>["dayProfiles"] = [];
  for (const dayType of ["weekday", "weekend"] as const) {
    const dates = GOLDEN_DATES.filter((localDate) => {
      const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
      return dayType === "weekend" ? day === 0 || day === 6 : day !== 0 && day !== 6;
    });
    for (const scope of scopes) {
      dayProfiles.push({
        dayType,
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        status: "available",
        sampleDayCount: dates.length,
        values: Array.from({ length: 24 }, (_, localHour) => ({
          localHour,
          usageKwh: roundFixture(
            scope.cells
              .filter((cell) => dates.includes(cell.localDate as typeof GOLDEN_DATES[number]) && cell.localHour === localHour)
              .reduce((sum, cell) => sum + (cell.usageKwh ?? 0), 0) / dates.length,
          ),
        })),
      });
    }
  }
  for (const scope of scopes) {
    dayProfiles.push({
      dayType: "public_holiday",
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      status: "unavailable",
      reason: {
        code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
        message: "Public Holiday profile requires an authoritative release-pinned Calendar classification.",
      },
    });
  }
  return {
    metricId: "energy.total_usage_kwh@1",
    grain: "hour",
    unit: "kWh",
    timezone: "Asia/Singapore",
    queryId: "time_bucket_grid_v1",
    scopes,
    dayProfiles,
  };
}

function goldenComponentHourlyProfiles(
  timeBehaviour: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["timeBehaviour"]>,
  componentCircuits: EnergyProjectAnalysisSnapshotDto["analysis"]["topCircuits"],
): NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["componentHourlyProfiles"]> {
  return {
    metricId: "energy.total_usage_kwh@1",
    queryId: "component_hourly_profiles_v1",
    accountingBasis: "published_component_circuits",
    grain: "hour",
    unit: "kWh",
    timezone: timeBehaviour.timezone,
    scopes: timeBehaviour.scopes.map((scope) => {
      const circuits = scope.scopeType === "project"
        ? componentCircuits
        : componentCircuits.filter((circuit) => circuit.parentScopeId === scope.scopeId);
      const circuitTotal = circuits.reduce((sum, circuit) => sum + circuit.usageKwh, 0);
      const categories = [...new Set(circuits.map((circuit) => circuit.category))]
        .sort((left, right) => left === "load" ? -1 : right === "load" ? 1 : left.localeCompare(right));
      const profiles: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["componentHourlyProfiles"]>["scopes"][number]["profiles"] = [];
      for (const dayType of ["weekday", "weekend"] as const) {
        const official = timeBehaviour.dayProfiles.find((profile) => (
          profile.scopeId === scope.scopeId && profile.dayType === dayType
        ));
        if (!official || official.status === "unavailable" || circuitTotal <= 0) {
          profiles.push({
            dayType,
            status: "unavailable",
            reason: {
              code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE",
              message: `No common complete ${dayType} component-Circuit sample is available for ${scope.scopeName}.`,
            },
          });
          continue;
        }
        const circuitRows = circuits.map((circuit) => ({
          meterNodeId: circuit.meterNodeId,
          name: circuit.name,
          category: circuit.category,
          values: official.values.map((value) => ({
            localHour: value.localHour,
            usageKwh: roundFixture(value.usageKwh * 0.992 * circuit.usageKwh / circuitTotal),
          })),
        }));
        profiles.push({
          dayType,
          status: "available",
          sampleDayCount: official.sampleDayCount,
          categories: categories.map((category) => ({
            category,
            values: Array.from({ length: 24 }, (_, localHour) => ({
              localHour,
              usageKwh: roundFixture(circuitRows
                .filter((circuit) => circuit.category === category)
                .reduce((sum, circuit) => sum + circuit.values[localHour]!.usageKwh, 0)),
            })),
          })),
          circuits: circuitRows,
        });
      }
      profiles.push({
        dayType: "public_holiday",
        status: "unavailable",
        reason: {
          code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE",
          message: "Public Holiday component profiles require an authoritative release-pinned Calendar classification.",
        },
      });
      return {
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        scopeType: scope.scopeType,
        profiles,
      };
    }),
  };
}

function goldenDailyUsageAnomalies(
  timeBehaviour: NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["timeBehaviour"]>,
): Extract<
  NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyUsageAnomalies"]>,
  { status: "available" }
> {
  const ruleRevisionId = "comparison.daily_usage_above_baseline@1";
  const rule = {
    relativeThresholdPct: 20,
    absoluteImpactKwh: 20,
    minimumCoveragePct: 95,
    minimumSampleCount: 4,
    maximumQualityEventCount: 0,
    maximumLookbackDays: 60,
    direction: "above" as const,
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour" as const,
  };
  const scopeInputs = [
    {
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      dailyUsage: [253.7018, 268.399, 260.0659, 168.9645, 127.9387, 230.1002, 221.9982],
      weekdayBaseline: 218.885,
      weekendBaseline: 63.3385,
      expectedIntervals: 384,
      triggeredDates: new Set(["2026-06-11", "2026-06-13", "2026-06-14"]),
    },
    {
      scopeId: "level-7",
      scopeName: "Level 7",
      scopeType: "level",
      dailyUsage: [157.1325, 182.6915, 170.9233, 114.7684, 115.1763, 157.1724, 156.3201],
      weekdayBaseline: 138.8777,
      weekendBaseline: 26.6704,
      expectedIntervals: 192,
      triggeredDates: new Set(["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"]),
    },
    {
      scopeId: "level-6",
      scopeName: "Level 6",
      scopeType: "level",
      dailyUsage: [96.5693, 85.7075, 89.1426, 54.1961, 12.7624, 72.9278, 65.6781],
      weekdayBaseline: 80.0073,
      weekendBaseline: 36.6681,
      expectedIntervals: 192,
      triggeredDates: new Set<string>(),
    },
  ];
  const dateSpine = GOLDEN_DATES.map((localDate) => ({
    localDate,
    from: `${previousLocalDate(localDate)}T16:00:00.000Z`,
    to: `${localDate}T16:00:00.000Z`,
  }));

  const seriesPoints = (
    scopeId: string,
    localDate: string,
    selectedTotal: number,
    baselineTotal: number,
    ratio = 1,
  ) => {
    const cells = timeBehaviour.scopes.find((scope) => scope.scopeId === scopeId)!.cells
      .filter((cell) => cell.localDate === localDate);
    return cells.map((cell) => {
      const selectedKwh = roundFixture((cell.usageKwh ?? 0) * ratio);
      const baselineKwh = roundFixture(selectedTotal > 0
        ? selectedKwh * baselineTotal / selectedTotal
        : 0);
      return {
        localHour: cell.localHour,
        selectedKwh,
        baselineKwh,
        impactKwh: roundFixture(selectedKwh - baselineKwh),
      };
    });
  };
  const detailSeries = (
    selectedScopeId: string,
    selectedDate: string,
    selectedTotal: number,
    baselineTotal: number,
  ) => {
    const selectedInput = scopeInputs.find((scope) => scope.scopeId === selectedScopeId)!;
    const series = [anomalyDetailSeries({
      seriesId: `scope:${selectedScopeId}`,
      relationship: "selected_scope",
      kind: "official_scope",
      scopeId: selectedScopeId,
      scopeName: selectedInput.scopeName,
      includedInOfficialTotal: true,
      selectedTotal,
      baselineTotal,
      expectedIntervals: selectedInput.expectedIntervals,
      points: seriesPoints(selectedScopeId, selectedDate, selectedTotal, baselineTotal),
    })];
    if (selectedScopeId === "project") {
      for (const level of scopeInputs.slice(1)) {
        const dateIndex = GOLDEN_DATES.indexOf(selectedDate as typeof GOLDEN_DATES[number]);
        const levelSelected = level.dailyUsage[dateIndex]!;
        const day = new Date(`${selectedDate}T00:00:00.000Z`).getUTCDay();
        const levelBaseline = day === 0 || day === 6 ? level.weekendBaseline : level.weekdayBaseline;
        series.push(anomalyDetailSeries({
          seriesId: `scope:${level.scopeId}`,
          relationship: "immediate_level",
          kind: "official_scope",
          scopeId: level.scopeId,
          scopeName: level.scopeName,
          includedInOfficialTotal: true,
          selectedTotal: levelSelected,
          baselineTotal: levelBaseline,
          expectedIntervals: level.expectedIntervals,
          points: seriesPoints(level.scopeId, selectedDate, levelSelected, levelBaseline),
        }));
      }
    } else if (selectedScopeId === "level-7") {
      for (const component of [
        { id: "l7-anomaly-load", name: "Level 7 component Load", category: "load", ratio: 0.7 },
        { id: "l7-anomaly-light", name: "Level 7 component Light", category: "light", ratio: 0.3 },
      ]) {
        series.push(anomalyDetailSeries({
          seriesId: `meter:${component.id}`,
          relationship: "component_circuit",
          kind: "component_circuit",
          scopeId: component.id,
          scopeName: component.name,
          meterNodeId: component.id,
          category: component.category,
          includedInOfficialTotal: false,
          selectedTotal: roundFixture(selectedTotal * component.ratio),
          baselineTotal: roundFixture(baselineTotal * component.ratio),
          expectedIntervals: 96,
          points: seriesPoints(selectedScopeId, selectedDate, selectedTotal, baselineTotal, component.ratio),
        }));
      }
    }
    return series;
  };

  return {
    status: "available",
    bundleId: "anomaly-bundle-ngee-ann-golden",
    metricId: "energy.total_usage_kwh@1",
    queryId: "time_slot_anomaly_v1",
    ruleRevisionId,
    timezone: "Asia/Singapore",
    baselineCutoff: "2026-06-10",
    rule,
    evidencePins: {
      projectReleaseId: "release-ngee-ann-golden",
      dataSnapshotId: "snapshot-ngee-ann-golden",
      hierarchyRevisionId: "hierarchy-v6",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metric-v1",
      businessCalendarVersion: "calendar-v1",
      queryIds: ["time_slot_anomaly_v1"],
    },
    scopes: scopeInputs.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      rollingComparisons: [
        {
          horizon: "rolling_7d" as const,
          cutoffLocalDate: "2026-06-16",
          current: {
            fromLocalDate: "2026-06-10",
            toLocalDate: "2026-06-16",
            totalKwh: roundFixture(scope.dailyUsage.reduce((sum, value) => sum + value, 0)),
            completeDayCount: 7,
          },
          baseline: {
            fromLocalDate: "2026-06-03",
            toLocalDate: "2026-06-09",
            totalKwh: scope.scopeId === "project" ? 1211.6773 : scope.scopeId === "level-7" ? 734.6257 : 477.0516,
            completeDayCount: 7,
          },
          status: "available" as const,
          deltaKwh: scope.scopeId === "project" ? 319.491 : scope.scopeId === "level-7" ? 319.5588 : -0.0678,
          relativePct: scope.scopeId === "project" ? 26.3677 : scope.scopeId === "level-7" ? 43.4995 : -0.0142,
        },
        scope.scopeId === "project"
          ? {
              horizon: "rolling_28d" as const,
              cutoffLocalDate: "2026-06-16",
              current: { fromLocalDate: "2026-05-20", toLocalDate: "2026-06-16", totalKwh: 4904.8659, completeDayCount: 28 },
              baseline: { fromLocalDate: "2026-04-22", toLocalDate: "2026-05-19", totalKwh: 4831.5555, completeDayCount: 28 },
              status: "available" as const,
              deltaKwh: 73.3104,
              relativePct: 1.5173,
            }
          : {
              horizon: "rolling_28d" as const,
              cutoffLocalDate: "2026-06-16",
              current: { fromLocalDate: "2026-05-20", toLocalDate: "2026-06-16", totalKwh: null, completeDayCount: 14 },
              baseline: { fromLocalDate: "2026-04-22", toLocalDate: "2026-05-19", totalKwh: null, completeDayCount: 0 },
              status: "unavailable" as const,
              reason: {
                code: "INCOMPLETE_HORIZON_EVIDENCE" as const,
                message: "28 complete current days and 28 complete prior days are required.",
              },
            },
      ],
      rows: dateSpine.map(({ localDate, from, to }, dateIndex) => {
        const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
        const dayType = day === 0 || day === 6 ? "weekend" as const : "weekday" as const;
        const baselineDates = dayType === "weekend"
          ? ["2026-05-24", "2026-05-30", "2026-06-06", "2026-06-07"]
          : ["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"];
        const actualKwh = scope.dailyUsage[dateIndex]!;
        const baselineKwh = dayType === "weekend" ? scope.weekendBaseline : scope.weekdayBaseline;
        const impactKwh = roundFixture(actualKwh - baselineKwh);
        const relativePct = roundFixture(impactKwh / baselineKwh * 100);
        const points = seriesPoints(scope.scopeId, localDate, actualKwh, baselineKwh);
        return {
          anomalyId: `daily-usage:${scope.scopeId}:${localDate}`,
          incidentId: `incident:${scope.scopeId}:${localDate}`,
          ruleRevisionId,
          metricId: "energy.total_usage_kwh@1" as const,
          queryId: "time_slot_anomaly_v1" as const,
          localDate,
          from,
          to,
          dayType,
          baselineDates,
          baselineSampleCount: baselineDates.length,
          baselineSamples: baselineDates.map((baselineDate) => ({
            localDate: baselineDate,
            coveragePct: 100,
            expectedMeterIntervalCount: scope.expectedIntervals,
            validIntervalCount: scope.expectedIntervals,
            qualityEventCount: 0,
            eligible: true as const,
          })),
          actualKwh,
          baselineKwh,
          impactKwh,
          relativePct,
          thresholds: {
            relativeThresholdPct: rule.relativeThresholdPct,
            absoluteImpactKwh: rule.absoluteImpactKwh,
            minimumCoveragePct: rule.minimumCoveragePct,
            maximumQualityEventCount: rule.maximumQualityEventCount,
          },
          coveragePct: 100,
          expectedMeterIntervalCount: scope.expectedIntervals,
          validIntervalCount: scope.expectedIntervals,
          qualityEventCount: 0,
          outcome: scope.triggeredDates.has(localDate) ? "triggered" as const : "within_threshold" as const,
          hourlyComparison: points.map((point) => ({
            localHour: point.localHour,
            actualKwh: point.selectedKwh,
            baselineKwh: point.baselineKwh,
            impactKwh: point.impactKwh,
            relativePct: point.baselineKwh > 0
              ? roundFixture(point.impactKwh / point.baselineKwh * 100)
              : null,
          })),
          detailSeries: detailSeries(scope.scopeId, localDate, actualKwh, baselineKwh),
        };
      }),
    })),
  };
}

function anomalyDetailSeries(input: {
  seriesId: string;
  relationship: "selected_scope" | "immediate_level" | "component_circuit";
  kind: "official_scope" | "component_circuit";
  scopeId: string;
  scopeName: string;
  meterNodeId?: string;
  category?: string;
  includedInOfficialTotal: boolean;
  selectedTotal: number;
  baselineTotal: number;
  expectedIntervals: number;
  points: Array<{
    localHour: number;
    selectedKwh: number;
    baselineKwh: number;
    impactKwh: number;
  }>;
}): Extract<
  NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyUsageAnomalies"]>,
  { status: "available" }
>["scopes"][number]["rows"][number]["detailSeries"][number] {
  const impactKwh = roundFixture(input.selectedTotal - input.baselineTotal);
  return {
    seriesId: input.seriesId,
    relationship: input.relationship,
    kind: input.kind,
    scopeId: input.scopeId,
    scopeName: input.scopeName,
    ...(input.meterNodeId ? { meterNodeId: input.meterNodeId } : {}),
    ...(input.category ? { category: input.category } : {}),
    includedInOfficialTotal: input.includedInOfficialTotal,
    status: "available",
    selectedTotalKwh: input.selectedTotal,
    baselineTotalKwh: input.baselineTotal,
    impactKwh,
    relativePct: roundFixture(impactKwh / input.baselineTotal * 100),
    coveragePct: 100,
    expectedMeterIntervalCount: input.expectedIntervals,
    validIntervalCount: input.expectedIntervals,
    qualityEventCount: 0,
    points: input.points,
  };
}

function roundFixture(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function goldenDailyTotals(): NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyTotals"]> {
  return {
    metricId: "energy.total_usage_kwh@1",
    grain: "day",
    timezone: "Asia/Singapore",
    scopes: [
      dailyScope(
        "project",
        "Ngee Ann Polytechnic",
        "project",
        [253.7018, 268.399, 260.0659, 168.9645, 127.9387, 230.1002, 221.9982],
        384,
      ),
      dailyScope(
        "level-7",
        "Level 7",
        "level",
        [157.1325, 182.6915, 170.9233, 114.7684, 115.1763, 157.1724, 156.3201],
        192,
      ),
      dailyScope(
        "level-6",
        "Level 6",
        "level",
        [96.5693, 85.7075, 89.1426, 54.1961, 12.7624, 72.9278, 65.6781],
        192,
      ),
    ],
  };
}

function dailyScope(
  scopeId: string,
  scopeName: string,
  scopeType: string,
  usage: number[],
  expectedMeterIntervalCount: number,
): NonNullable<EnergyProjectAnalysisSnapshotDto["analysis"]["dailyTotals"]>["scopes"][number] {
  return {
    scopeId,
    scopeName,
    scopeType,
    rows: GOLDEN_DATES.map((localDate, index) => ({
      localDate,
      from: `${previousLocalDate(localDate)}T16:00:00.000Z`,
      to: `${localDate}T16:00:00.000Z`,
      usageKwh: usage[index]!,
      dataHealth: {
        status: "complete",
        coveragePct: 100,
        expectedMeterIntervalCount,
        validIntervalCount: expectedMeterIntervalCount,
        qualityEventCount: 0,
      },
    })),
  };
}

function previousLocalDate(localDate: string): string {
  return new Date(Date.parse(`${localDate}T00:00:00.000Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function missingMetadata(): EnergyProjectAnalysisMetadataDto {
  return {
    status: "missing",
    hierarchyRevisionId: "hierarchy-v6",
    timezone: "Asia/Singapore",
    period: {
      start: "2026-06-09T16:00:00.000Z",
      endExclusive: "2026-06-16T16:00:00.000Z",
    },
    selectedScope: missingScopeMetadata("project", "Ngee Ann Polytechnic", 1531.168324),
    comparisonScopes: [],
    evidence: [],
  };
}

function missingScopeMetadata(
  scopeId: string,
  scopeName: string,
  usageKwh: number,
): EnergyProjectAnalysisMetadataDto["selectedScope"] {
  const missingValue = (unit: "m2" | "people") => ({
    status: "missing" as const,
    value: null,
    unit,
    reason: "not-configured" as const,
    guidance: `Configure ${unit === "m2" ? "area" : "headcount"} metadata.`,
    metadataRevisionIds: [],
    hierarchyRevisionIds: ["hierarchy-v6"],
    evidence: [],
  });
  const missingNormalisation = (
    metricId: "energy.usage_per_sqm" | "energy.usage_per_person",
    unit: "kWh/m2" | "kWh/person",
  ) => ({
    status: "missing" as const,
    metricId,
    value: null,
    unit,
    reason: "not-configured" as const,
    guidance: "Configure the required Scope metadata.",
    metadataRevisionIds: [],
    hierarchyRevisionIds: ["hierarchy-v6"],
    evidence: [],
  });
  return {
    scopeId,
    scopeName,
    usageKwh,
    status: "missing",
    area: missingValue("m2"),
    headcount: missingValue("people"),
    normalisations: {
      eui: missingNormalisation("energy.usage_per_sqm", "kWh/m2"),
      perPax: missingNormalisation("energy.usage_per_person", "kWh/person"),
    },
    evidence: [],
  };
}
