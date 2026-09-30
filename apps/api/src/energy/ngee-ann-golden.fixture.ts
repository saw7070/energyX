export const NGEE_ANN_GOLDEN = {
  projectId: "ngee-ann-polytechnic",
  workspaceId: "default",
  resource: "electricity",
  timezone: "Asia/Singapore",
  selection: {
    periodDays: 7,
    intervalMinutes: 15,
    policy: "highest current coverage, then previous-period coverage, then fewest quality events, then latest",
    period: {
      localFrom: "2026-06-10",
      localToExclusive: "2026-06-17",
      from: "2026-06-09T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z"
    },
    day: {
      localDate: "2026-06-16",
      from: "2026-06-15T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z"
    }
  },
  officialMeterNodeIds: [
    "mapping-lvl-7-total-office-light-17",
    "mapping-lvl-7-total-office-load-18",
    "mapping-lvl-6-total-office-light-8",
    "mapping-lvl-6-total-office-load-9"
  ],
  period: {
    usageKwh: 1531.1683,
    previousUsageKwh: 1211.6773,
    changeKwh: 319.4911,
    changePct: 26.3677,
    peakKw: 20.6731,
    peakAt: "2026-06-11T06:00:00.000Z",
    levelUsageKwh: {
      "level-7": 1054.1845,
      "level-6": 476.9838
    },
    levels: {
      "level-7": {
        usageKwh: 1054.1845,
        sharePct: 68.8484,
        previousUsageKwh: 734.6257,
        changeKwh: 319.5588,
        changePct: 43.4995,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 1344,
          validIntervalCount: 1344,
          qualityEventCount: 0
        },
        peakKw: 12.0637,
        peakAt: "2026-06-11T06:00:00.000Z"
      },
      "level-6": {
        usageKwh: 476.9838,
        sharePct: 31.1516,
        previousUsageKwh: 477.0516,
        changeKwh: -0.0678,
        changePct: -0.0142,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 1344,
          validIntervalCount: 1344,
          qualityEventCount: 0
        },
        peakKw: 9.2051,
        peakAt: "2026-06-10T02:30:00.000Z"
      }
    },
    categoryUsageKwh: {
      light: 291.7444,
      load: 1239.4239
    },
    categories: {
      light: {
        usageKwh: 291.7444,
        previousUsageKwh: 237.1791,
        changeKwh: 54.5653,
        changePct: 23.0059,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 1344,
          validIntervalCount: 1344,
          qualityEventCount: 0
        }
      },
      load: {
        usageKwh: 1239.4239,
        previousUsageKwh: 974.4981,
        changeKwh: 264.9258,
        changePct: 27.1859,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 1344,
          validIntervalCount: 1344,
          qualityEventCount: 0
        }
      }
    },
    topCircuit: {
      scopeId: "l7-load-4",
      parentScopeId: "level-7",
      meterNodeId: "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
      usageKwh: 439.0972,
      sharePct: 28.6773,
      previousUsageKwh: 247.9813,
      changeKwh: 191.1159,
      changePct: 77.0687,
      peakKw: 3.5307,
      dataHealth: {
        coveragePct: 100,
        expectedMeterIntervalCount: 672,
        validIntervalCount: 672,
        qualityEventCount: 0
      }
    },
    topCircuits: [
      {
        meterNodeId: "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
        scopeId: "l7-load-4",
        parentScopeId: "level-7",
        usageKwh: 439.0972,
        sharePct: 28.6773,
        previousUsageKwh: 247.9813,
        changeKwh: 191.1159,
        changePct: 77.0687,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 672,
          validIntervalCount: 672,
          qualityEventCount: 0
        }
      },
      {
        meterNodeId: "mapping-lvl-7-office-load-3-l1p16-l3p21-15",
        scopeId: "l7-load-3",
        parentScopeId: "level-7",
        usageKwh: 337.9023,
        sharePct: 22.0683,
        previousUsageKwh: 0,
        changeKwh: 337.9023,
        changePct: null,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 672,
          validIntervalCount: 672,
          qualityEventCount: 0
        }
      },
      {
        meterNodeId: "mapping-lvl-6-office-load-4-l1p19-l3p24-6",
        scopeId: "l6-load-4",
        parentScopeId: "level-6",
        usageKwh: 255.1539,
        sharePct: 16.664,
        previousUsageKwh: 0,
        changeKwh: 255.1539,
        changePct: null,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 672,
          validIntervalCount: 672,
          qualityEventCount: 0
        }
      },
      {
        meterNodeId: "mapping-lvl-7-front-row-office-light-11",
        scopeId: "l7-front-light",
        parentScopeId: "level-7",
        usageKwh: 107.02,
        sharePct: 6.9894,
        previousUsageKwh: 0,
        changeKwh: 107.02,
        changePct: null,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 672,
          validIntervalCount: 672,
          qualityEventCount: 0
        }
      },
      {
        meterNodeId: "mapping-lvl-6-office-light-right-internal-2",
        scopeId: "l6-light-right",
        parentScopeId: "level-6",
        usageKwh: 70.6873,
        sharePct: 4.6166,
        previousUsageKwh: 0,
        changeKwh: 70.6873,
        changePct: null,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 672,
          validIntervalCount: 672,
          qualityEventCount: 0
        }
      }
    ],
    totalCircuits: [
      { scopeId: "l6-total-light", parentScopeId: "level-6", meterNodeId: "mapping-lvl-6-total-office-light-8", rawUsageKwh: 111.688071, apiUsageKwh: 111.6881 },
      { scopeId: "l6-total-load", parentScopeId: "level-6", meterNodeId: "mapping-lvl-6-total-office-load-9", rawUsageKwh: 365.295756, apiUsageKwh: 365.2958 },
      { scopeId: "l7-total-light", parentScopeId: "level-7", meterNodeId: "mapping-lvl-7-total-office-light-17", rawUsageKwh: 180.056316, apiUsageKwh: 180.0563 },
      { scopeId: "l7-total-load", parentScopeId: "level-7", meterNodeId: "mapping-lvl-7-total-office-load-18", rawUsageKwh: 874.128181, apiUsageKwh: 874.1282 }
    ],
    componentReconciliation: {
      officialUsageKwh: 1531.1683,
      componentUsageKwh: 1518.9965,
      gapKwh: 12.1718,
      ratioPct: 99.2051
    },
    dataHealth: {
      status: "complete",
      coveragePct: 100,
      expectedMeterIntervalCount: 2688,
      validIntervalCount: 2688,
      qualityEventCount: 0,
      lastSeenAt: "2026-06-16T16:00:00.000Z",
      importBatchIds: [
        "energy-import-2059d4af-9d67-4e65-8cf1-61d15352be3d",
        "energy-import-776b4be8-9ac4-4159-87d6-73837abe896e"
      ]
    },
    hourlyProfile: [
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
      [23, 37.297852, 5.328265, 5.671996]
    ],
    dailyTotals: {
      dateSpine: [
        { localDate: "2026-06-10", from: "2026-06-09T16:00:00.000Z", to: "2026-06-10T16:00:00.000Z" },
        { localDate: "2026-06-11", from: "2026-06-10T16:00:00.000Z", to: "2026-06-11T16:00:00.000Z" },
        { localDate: "2026-06-12", from: "2026-06-11T16:00:00.000Z", to: "2026-06-12T16:00:00.000Z" },
        { localDate: "2026-06-13", from: "2026-06-12T16:00:00.000Z", to: "2026-06-13T16:00:00.000Z" },
        { localDate: "2026-06-14", from: "2026-06-13T16:00:00.000Z", to: "2026-06-14T16:00:00.000Z" },
        { localDate: "2026-06-15", from: "2026-06-14T16:00:00.000Z", to: "2026-06-15T16:00:00.000Z" },
        { localDate: "2026-06-16", from: "2026-06-15T16:00:00.000Z", to: "2026-06-16T16:00:00.000Z" }
      ],
      scopes: [
        {
          scopeId: "project",
          scopeName: "Ngee Ann Polytechnic",
          scopeType: "project",
          usageKwh: [253.7018, 268.3990, 260.0659, 168.9645, 127.9387, 230.1002, 221.9982],
          dataHealth: {
            status: "complete",
            coveragePct: 100,
            expectedMeterIntervalCount: 384,
            validIntervalCount: 384,
            qualityEventCount: 0
          }
        },
        {
          scopeId: "level-7",
          scopeName: "Level 7",
          scopeType: "level",
          usageKwh: [157.1325, 182.6915, 170.9233, 114.7684, 115.1763, 157.1724, 156.3201],
          dataHealth: {
            status: "complete",
            coveragePct: 100,
            expectedMeterIntervalCount: 192,
            validIntervalCount: 192,
            qualityEventCount: 0
          }
        },
        {
          scopeId: "level-6",
          scopeName: "Level 6",
          scopeType: "level",
          usageKwh: [96.5693, 85.7075, 89.1426, 54.1961, 12.7624, 72.9278, 65.6781],
          dataHealth: {
            status: "complete",
            coveragePct: 100,
            expectedMeterIntervalCount: 192,
            validIntervalCount: 192,
            qualityEventCount: 0
          }
        }
      ]
    },
    peakBreakdown: {
      status: "available",
      metricId: "energy.peak_demand_kw@1",
      intervalMinutes: 15,
      timezone: "Asia/Singapore",
      unit: "kW",
      periodStatus: "complete",
      coveragePct: 100,
      peak: {
        from: "2026-06-11T06:00:00.000Z",
        to: "2026-06-11T06:15:00.000Z",
        averageKw: 20.6731
      },
      levels: [
        {
          scopeId: "level-7",
          scopeName: "Level 7",
          averageKw: 12.0637,
          sharePct: 58.3545,
          circuits: [
            { meterNodeId: "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16", name: "Office Load 4 Fan ISOL 1/2", category: "load", averageKw: 3.3922, sharePct: 28.1194 },
            { meterNodeId: "mapping-lvl-7-office-load-3-l1p16-l3p21-15", name: "Office Load 3", category: "load", averageKw: 3.2421, sharePct: 26.8748 },
            { meterNodeId: "mapping-lvl-7-front-row-office-light-11", name: "Front Row Office Light", category: "light", averageKw: 1.9506, sharePct: 16.1694 },
            { meterNodeId: "mapping-lvl-7-back-row-office-light-10", name: "Back Row Office Light", category: "light", averageKw: 1.4399, sharePct: 11.936 },
            { meterNodeId: "mapping-lvl-7-office-load-2-l1p7-l3p15-14", name: "Office Load 2", category: "load", averageKw: 1.3746, sharePct: 11.3947 },
            { meterNodeId: "mapping-lvl-7-middle-row-office-light-12", name: "Middle Row Office Light", category: "light", averageKw: 0.3004, sharePct: 2.4898 },
            { meterNodeId: "mapping-lvl-7-office-load-1-l1p1-l3p6-13", name: "Office Load 1", category: "load", averageKw: 0.1804, sharePct: 1.4956 }
          ]
        },
        {
          scopeId: "level-6",
          scopeName: "Level 6",
          averageKw: 8.6094,
          sharePct: 41.6455,
          circuits: [
            { meterNodeId: "mapping-lvl-6-office-load-4-l1p19-l3p24-6", name: "Lvl 6 Office Load 4: L1P19-L3P24", category: "load", averageKw: 3.4747, sharePct: 40.3592 },
            { meterNodeId: "mapping-lvl-6-office-light-right-internal-2", name: "Lvl 6 Office Light-Right: Internal", category: "light", averageKw: 1.5823, sharePct: 18.3784 },
            { meterNodeId: "mapping-lvl-6-office-light-left-external-1", name: "Lvl 6 Office Light-Left: External", category: "light", averageKw: 1.4839, sharePct: 17.2353 },
            { meterNodeId: "mapping-lvl-6-office-load-5-l1p25-l3p29-fan-isol-1-2-7", name: "Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2", category: "load", averageKw: 0.5735, sharePct: 6.6611 },
            { meterNodeId: "mapping-lvl-6-office-load-1-l1p1-l3p6-3", name: "Lvl 6 Office Load 1: L1P1-L3P6", category: "load", averageKw: 0.5018, sharePct: 5.8282 },
            { meterNodeId: "mapping-lvl-6-office-load-2-l1p7-l3p12-4", name: "Lvl 6 Office Load 2: L1P7-L3P12", category: "load", averageKw: 0.4295, sharePct: 4.9887 },
            { meterNodeId: "mapping-lvl-6-office-load-3-l1p13-l3p18-5", name: "Lvl 6 Office Load 3: L1P13-L3P18", category: "load", averageKw: 0.4028, sharePct: 4.6787 }
          ]
        }
      ]
    }
  },
  day: {
    usageKwh: 221.9982,
    peakKw: 14.4494,
    peakAt: "2026-06-16T07:15:00.000Z",
    expectedMeterIntervalCount: 384,
    validIntervalCount: 384,
    qualityEventCount: 0,
    hourlyProfile: [
      [0, 5.35652, 5.35652, 5.418924],
      [1, 5.173563, 5.173563, 5.210572],
      [2, 5.104549, 5.104549, 5.254688],
      [3, 5.125056, 5.125056, 5.258084],
      [4, 5.185748, 5.185748, 5.281752],
      [5, 5.242188, 5.242188, 5.338536],
      [6, 9.238492, 9.238492, 10.778516],
      [7, 11.201303, 11.201303, 11.800664],
      [8, 12.091472, 12.091472, 12.918548],
      [9, 13.781568, 13.781568, 14.078844],
      [10, 13.979613, 13.979613, 14.038844],
      [11, 13.843545, 13.843545, 14.11948],
      [12, 13.424247, 13.424247, 13.620016],
      [13, 13.540453, 13.540453, 13.98698],
      [14, 14.108092, 14.108092, 14.433044],
      [15, 14.267255, 14.267255, 14.44942],
      [16, 13.5892, 13.5892, 14.117296],
      [17, 11.792498, 11.792498, 12.472988],
      [18, 9.493087, 9.493087, 10.942676],
      [19, 5.396631, 5.396631, 5.7005],
      [20, 5.279697, 5.279697, 5.349632],
      [21, 5.299933, 5.299933, 5.400328],
      [22, 5.304831, 5.304831, 5.363924],
      [23, 5.178619, 5.178619, 5.263648]
    ]
  },
  virtualMeter: {
    meterNodeId: "ngee-ann-load-12-v1",
    name: "Load 12",
    scopeId: "level-6",
    termMeterNodeIds: [
      "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
      "mapping-lvl-6-office-load-2-l1p7-l3p12-4"
    ],
    usageKwh: 49.0218,
    includedInOfficialTotal: false
  },
  virtualMeterTrace: {
    meterNodeId: "ngee-ann-load-12-v1",
    name: "Load 12",
    scopeId: "level-6",
    status: "available",
    usageKwh: 49.0218,
    includedInOfficialTotal: false,
    terms: [
      {
        meterNodeId: "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
        name: "Office Load 1",
        coefficient: 1,
        inputUsageKwh: 11.5379,
        contributionKwh: 11.5379,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 672,
          validIntervalCount: 672,
          qualityEventCount: 0
        }
      },
      {
        meterNodeId: "mapping-lvl-6-office-load-2-l1p7-l3p12-4",
        name: "Office Load 2",
        coefficient: 1,
        inputUsageKwh: 37.4839,
        contributionKwh: 37.4839,
        dataHealth: {
          coveragePct: 100,
          expectedMeterIntervalCount: 672,
          validIntervalCount: 672,
          qualityEventCount: 0
        }
      }
    ],
    missingTermMeterNodeIds: []
  },
  invariants: {
    officialUsageKwh: 1531.168324,
    componentUsageKwh: 1518.996480,
    allMeterRawUsageKwh: 3050.164804,
    allMeterApiCircuitUsageKwh: 3050.1649,
    cumulativeDeltaMismatchCount: 0,
    averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0,
    offHoursStatus: "unavailable",
    tariffStatus: "unavailable",
    usageUnit: "kWh",
    demandUnit: "kW"
  }
} as const;
