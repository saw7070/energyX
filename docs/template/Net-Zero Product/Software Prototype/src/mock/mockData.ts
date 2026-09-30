import {
  Alarm,
  AnalysisSpaceLevel,
  AnalysisTimeRange,
  AnalysisUtilityData,
  AnalysisUtilityKey,
  AlarmRecord,
  Bill,
  CompareMode,
  Device,
  FacilityType,
  HierarchyNode,
  OverviewSite,
  Incident,
  KpiMetric,
  Meter,
  OperationalStatus,
  OperationalProfileOption,
  Organization,
  Project,
  ReportItem,
  SiteTrendDataPoint,
  Tenant,
  TrendPoint
} from "@/mock/types";

export const organizations: Organization[] = [
  { id: "org-vector-green", name: "Vector Green" },
  { id: "org-st-lodge", name: "ST Lodge" },
  { id: "org-cag", name: "CAG" }
];

export const projects: Project[] = [
  {
    id: "proj-st-a",
    organizationId: "org-st-lodge",
    name: "ST Lodge Site A",
    location: "Jurong West",
    type: "dormitory"
  },
  {
    id: "proj-st-b",
    organizationId: "org-st-lodge",
    name: "ST Lodge Site B",
    location: "Woodlands",
    type: "dormitory"
  },
  {
    id: "proj-cag-dorm",
    organizationId: "org-cag",
    name: "CAG Dormitory",
    location: "Changi",
    type: "portfolio"
  },
  {
    id: "proj-hdb-pilot",
    organizationId: "org-vector-green",
    name: "HDB Utility Pilot",
    location: "Tampines",
    type: "commercial"
  }
];

export const hierarchyTree: HierarchyNode[] = [
  {
    id: "h-proj-st-a",
    name: "ST Lodge Site A",
    level: "project",
    status: "healthy",
    children: [
      {
        id: "h-block-a",
        name: "Block A",
        level: "block",
        status: "healthy",
        children: [
          {
            id: "h-floor-a1",
            name: "Floor 1",
            level: "floor",
            children: [
              {
                id: "h-room-a101",
                name: "Room 101",
                level: "room",
                children: [
                  {
                    id: "h-bed-a101-1",
                    name: "Bed 1",
                    level: "bed",
                    children: [{ id: "h-dev-a101-1", name: "Meter A101", level: "device", status: "healthy" }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
];

export const devices: Device[] = [
  {
    id: "dev-01",
    projectId: "proj-st-a",
    name: "Main Distribution Meter",
    category: "Electric Meter",
    status: "healthy",
    locationPath: "Block A / Floor 1 / Room 101 / Bed 1"
  },
  {
    id: "dev-02",
    projectId: "proj-st-b",
    name: "Water Pulse Meter",
    category: "Water Meter",
    status: "warning",
    locationPath: "Block B / Floor 2 / Room 206 / Bed 3"
  },
  {
    id: "dev-03",
    projectId: "proj-cag-dorm",
    name: "Gas Sensor Cluster",
    category: "Gas Sensor",
    status: "critical",
    locationPath: "Block C / Floor 3 / Utility Riser"
  },
  {
    id: "dev-04",
    projectId: "proj-hdb-pilot",
    name: "LoRa Edge Gateway",
    category: "Gateway",
    status: "healthy",
    locationPath: "Control Room / Rack 02"
  }
];

export const meters: Meter[] = [
  { id: "m-elec-01", projectId: "proj-st-a", utility: "electricity", serialNumber: "EM-882190", status: "healthy", reading: 18231, unit: "kWh" },
  { id: "m-water-01", projectId: "proj-st-b", utility: "water", serialNumber: "WM-551802", status: "healthy", reading: 3201, unit: "m3" },
  { id: "m-gas-01", projectId: "proj-cag-dorm", utility: "gas", serialNumber: "GM-119902", status: "warning", reading: 982, unit: "m3" }
];

export const tenants: Tenant[] = [
  { id: "tenant-01", projectId: "proj-st-a", name: "Dorm Wing Alpha", unit: "A-101 to A-130", contractType: "Bulk Utility", billingCycle: "Monthly" },
  { id: "tenant-02", projectId: "proj-st-b", name: "Dorm Wing Delta", unit: "B-201 to B-230", contractType: "Sub-metered", billingCycle: "Monthly" },
  { id: "tenant-03", projectId: "proj-hdb-pilot", name: "Pilot Office Cluster", unit: "Tower 2", contractType: "Fixed + Variable", billingCycle: "Bi-monthly" }
];

export const incidents: Incident[] = [
  { id: "inc-01", projectId: "proj-st-b", title: "Unexpected water spike at Block B", severity: "medium", status: "in_progress", openedAt: "2026-05-08 10:42" },
  { id: "inc-02", projectId: "proj-cag-dorm", title: "Gas pressure sensor offline", severity: "high", status: "open", openedAt: "2026-05-09 08:17" }
];

export const alarms: Alarm[] = [
  { id: "alarm-01", projectId: "proj-cag-dorm", source: "Gas Sensor Cluster", level: "critical", status: "active", timestamp: "2026-05-09 08:18" },
  { id: "alarm-02", projectId: "proj-st-b", source: "Water Pulse Meter", level: "warning", status: "acknowledged", timestamp: "2026-05-09 09:12" },
  { id: "alarm-03", projectId: "proj-st-a", source: "Main Distribution Meter", level: "info", status: "cleared", timestamp: "2026-05-09 10:45" }
];

export const bills: Bill[] = [
  { id: "bill-01", tenantId: "tenant-01", period: "2026-04", amount: 12450, status: "generated" },
  { id: "bill-02", tenantId: "tenant-02", period: "2026-04", amount: 9280, status: "sent" },
  { id: "bill-03", tenantId: "tenant-03", period: "2026-04", amount: 17340, status: "draft" }
];

export const reports: ReportItem[] = [
  { id: "report-01", type: "System Availability", projectId: "proj-st-a", generatedAt: "2026-05-01 09:00", status: "ready" },
  { id: "report-02", type: "Data Unavailability", projectId: "proj-st-b", generatedAt: "2026-05-02 09:00", status: "ready" },
  { id: "report-03", type: "Incident Ticket", projectId: "proj-cag-dorm", generatedAt: "2026-05-04 09:00", status: "queued" },
  { id: "report-04", type: "PUB Water Balance", projectId: "proj-hdb-pilot", generatedAt: "2026-05-05 09:00", status: "ready" }
];

export const overviewKpis: KpiMetric[] = [
  { key: "electricity", label: "Electricity", value: "2.48 GWh", delta: "-3.1%", trend: "down", unitHint: "vs last month" },
  { key: "water", label: "Water", value: "184.2k m3", delta: "-1.4%", trend: "down", unitHint: "vs last month" },
  { key: "gas", label: "Gas", value: "91.8k m3", delta: "+0.8%", trend: "up", unitHint: "vs last month" },
  { key: "carbon", label: "Carbon", value: "1,182 tCO2e", delta: "-4.6%", trend: "down", unitHint: "vs last month" },
  { key: "cost", label: "Cost", value: "SGD 528k", delta: "-2.2%", trend: "down", unitHint: "vs last month" }
];

export const trendData: TrendPoint[] = [
  { name: "Mon", electricity: 340, water: 128, gas: 82, carbon: 156, cost: 82 },
  { name: "Tue", electricity: 358, water: 131, gas: 83, carbon: 160, cost: 84 },
  { name: "Wed", electricity: 351, water: 129, gas: 84, carbon: 159, cost: 83 },
  { name: "Thu", electricity: 344, water: 126, gas: 80, carbon: 154, cost: 81 },
  { name: "Fri", electricity: 369, water: 136, gas: 86, carbon: 165, cost: 88 },
  { name: "Sat", electricity: 322, water: 117, gas: 79, carbon: 146, cost: 76 },
  { name: "Sun", electricity: 315, water: 112, gas: 77, carbon: 141, cost: 73 }
];

export const siteRanking = [
  { name: "ST Lodge Site A", score: 91, status: "healthy" },
  { name: "HDB Utility Pilot", score: 88, status: "healthy" },
  { name: "ST Lodge Site B", score: 79, status: "warning" },
  { name: "CAG Dormitory", score: 72, status: "critical" }
] as const;

export const deviceStatusSummary = [
  { label: "Online", value: 326, status: "healthy" },
  { label: "Warning", value: 24, status: "warning" },
  { label: "Critical", value: 7, status: "critical" },
  { label: "Offline", value: 11, status: "offline" }
] as const;

export const overviewPortfolioKpis = [
  {
    key: "electricity",
    label: "Electricity Consumption",
    value: 128420,
    unit: "kWh",
    changePct: 4.8,
    description: "Portfolio electricity consumption for selected period."
  },
  {
    key: "water",
    label: "Water Consumption",
    value: 9860,
    unit: "m3",
    changePct: -2.3,
    description: "Portfolio water usage aggregated across all sites."
  },
  {
    key: "gas",
    label: "Gas Consumption",
    value: 3240,
    unit: "m3",
    changePct: 1.2,
    description: "Gas consumption baseline across monitored facilities."
  },
  {
    key: "carbon",
    label: "Carbon Emission",
    value: 54.6,
    unit: "tCO2e",
    changePct: -3.5,
    description: "Estimated carbon footprint based on utility factors."
  },
  {
    key: "cost",
    label: "Utility Cost",
    value: 42380,
    unit: "SGD",
    changePct: 5.1,
    description: "Total utility spend across selected organization."
  }
] as const;

const buildTrend = (
  points: Array<{ label: string; electricity: number; water: number; gas: number; carbon: number; cost: number }>
): SiteTrendDataPoint[] => points;

export const overviewSites: OverviewSite[] = [
  {
    id: "site-st-a",
    organizationId: "org-st-lodge",
    projectId: "proj-st-a",
    name: "ST Lodge Site A",
    address: "12 Pioneer Road, Singapore",
    facilityType: "Dormitory",
    operationalStatus: "normal",
    description: "Large worker dormitory with mixed occupancy and centralized metering.",
    gfa: 45200,
    mapPosition: { x: 30, y: 58 },
    activeAlarms: 3,
    kpis: {
      electricity: { value: 31480, unit: "kWh", changePct: 3.4, description: "Daily consumption trend is stable." },
      water: { value: 2380, unit: "m3", changePct: -1.6, description: "Water conservation initiative in progress." },
      gas: { value: 760, unit: "m3", changePct: 0.7, description: "Gas usage remains within expected baseline." },
      carbon: { value: 12.9, unit: "tCO2e", changePct: -2.5, description: "Carbon intensity reduced month-over-month." },
      cost: { value: 10840, unit: "SGD", changePct: 4.9, description: "Tariff increase affects overall cost." }
    },
    mtd: { electricity: 81200, water: 6420, carbon: 29.8, cost: 27140 },
    hierarchyCounts: { blocks: 4, floors: 28, rooms: 680, devices: 1240 },
    deviceStats: { total: 1240, online: 1192, offline: 18, warning: 30, gatewaysOnline: 12, gatewaysOffline: 1 },
    ranking: { eui: 112.4, wei: 2.8, utilityCost: 27140, carbon: 29.8, performance: "Good" },
    trends: {
      realtime: buildTrend([
        { label: "00:00", electricity: 460, water: 33, gas: 12, carbon: 21, cost: 160 },
        { label: "04:00", electricity: 420, water: 30, gas: 10, carbon: 19, cost: 148 },
        { label: "08:00", electricity: 560, water: 42, gas: 13, carbon: 25, cost: 194 },
        { label: "12:00", electricity: 640, water: 51, gas: 15, carbon: 29, cost: 224 },
        { label: "16:00", electricity: 680, water: 56, gas: 16, carbon: 31, cost: 238 },
        { label: "20:00", electricity: 610, water: 49, gas: 14, carbon: 27, cost: 213 }
      ]),
      daily: buildTrend([
        { label: "Mon", electricity: 4200, water: 315, gas: 102, carbon: 188, cost: 1480 },
        { label: "Tue", electricity: 4410, water: 325, gas: 105, carbon: 194, cost: 1545 },
        { label: "Wed", electricity: 4380, water: 321, gas: 103, carbon: 193, cost: 1532 },
        { label: "Thu", electricity: 4320, water: 316, gas: 101, carbon: 190, cost: 1514 },
        { label: "Fri", electricity: 4520, water: 332, gas: 107, carbon: 198, cost: 1588 },
        { label: "Sat", electricity: 4260, water: 304, gas: 98, carbon: 185, cost: 1462 },
        { label: "Sun", electricity: 4190, water: 298, gas: 96, carbon: 181, cost: 1438 }
      ]),
      monthly: buildTrend([
        { label: "Jan", electricity: 79400, water: 6210, gas: 2210, carbon: 31.2, cost: 26510 },
        { label: "Feb", electricity: 78200, water: 6040, gas: 2180, carbon: 30.8, cost: 25960 },
        { label: "Mar", electricity: 80600, water: 6330, gas: 2230, carbon: 31.9, cost: 26870 },
        { label: "Apr", electricity: 79850, water: 6250, gas: 2195, carbon: 31.5, cost: 26620 },
        { label: "May", electricity: 81200, water: 6420, gas: 2260, carbon: 32.2, cost: 27140 }
      ])
    },
    breakdownBySpace: [
      { label: "Block A", value: 32 },
      { label: "Block B", value: 28 },
      { label: "Block C", value: 24 },
      { label: "Block D", value: 16 }
    ],
    breakdownByTag: [
      { label: "Lighting", value: 23 },
      { label: "Plug Load", value: 29 },
      { label: "Air Conditioning", value: 36 },
      { label: "Others", value: 12 }
    ],
    topIssues: [
      { id: "iss-a1", issueType: "Offline gateway", location: "Block C Gateway 02", severity: "critical", updatedAt: "11:12" },
      { id: "iss-a2", issueType: "No data received", location: "Block B Floor 04", severity: "warning", updatedAt: "10:48" },
      { id: "iss-a3", issueType: "Abnormal electricity spike", location: "Block A Room 201", severity: "critical", updatedAt: "10:31" },
      { id: "iss-a4", issueType: "High water consumption", location: "Block D Laundry", severity: "warning", updatedAt: "09:42" },
      { id: "iss-a5", issueType: "Stagnant meter reading", location: "Block C Room 311", severity: "info", updatedAt: "09:20" }
    ]
  },
  {
    id: "site-st-b",
    organizationId: "org-st-lodge",
    projectId: "proj-st-b",
    name: "ST Lodge Site B",
    address: "88 Woodlands Ave, Singapore",
    facilityType: "Dormitory",
    operationalStatus: "warning",
    description: "Dormitory expansion block with active commissioning and staged onboarding.",
    gfa: 38900,
    mapPosition: { x: 44, y: 42 },
    activeAlarms: 6,
    kpis: {
      electricity: { value: 28140, unit: "kWh", changePct: 6.2, description: "Peak load increase observed on weekdays." },
      water: { value: 2260, unit: "m3", changePct: 2.1, description: "Water usage elevated in two blocks." },
      gas: { value: 720, unit: "m3", changePct: 1.3, description: "Gas remains aligned with occupancy increase." },
      carbon: { value: 11.8, unit: "tCO2e", changePct: 1.8, description: "Carbon trend follows electricity growth." },
      cost: { value: 9720, unit: "SGD", changePct: 7.0, description: "Cost increase driven by demand spikes." }
    },
    mtd: { electricity: 73420, water: 5980, carbon: 27.4, cost: 24460 },
    hierarchyCounts: { blocks: 3, floors: 21, rooms: 510, devices: 990 },
    deviceStats: { total: 990, online: 928, offline: 31, warning: 31, gatewaysOnline: 8, gatewaysOffline: 2 },
    ranking: { eui: 126.8, wei: 3.1, utilityCost: 24460, carbon: 27.4, performance: "Average" },
    trends: {
      realtime: buildTrend([
        { label: "00:00", electricity: 410, water: 29, gas: 11, carbon: 18, cost: 142 },
        { label: "04:00", electricity: 392, water: 28, gas: 10, carbon: 17, cost: 136 },
        { label: "08:00", electricity: 545, water: 39, gas: 13, carbon: 24, cost: 190 },
        { label: "12:00", electricity: 621, water: 48, gas: 15, carbon: 28, cost: 220 },
        { label: "16:00", electricity: 663, water: 53, gas: 16, carbon: 30, cost: 233 },
        { label: "20:00", electricity: 592, water: 45, gas: 13, carbon: 26, cost: 207 }
      ]),
      daily: buildTrend([
        { label: "Mon", electricity: 3890, water: 285, gas: 96, carbon: 171, cost: 1360 },
        { label: "Tue", electricity: 4010, water: 290, gas: 98, carbon: 176, cost: 1412 },
        { label: "Wed", electricity: 4075, water: 296, gas: 100, carbon: 179, cost: 1430 },
        { label: "Thu", electricity: 3995, water: 291, gas: 99, carbon: 176, cost: 1402 },
        { label: "Fri", electricity: 4210, water: 309, gas: 104, carbon: 185, cost: 1488 },
        { label: "Sat", electricity: 3920, water: 280, gas: 94, carbon: 170, cost: 1368 },
        { label: "Sun", electricity: 3850, water: 276, gas: 92, carbon: 166, cost: 1332 }
      ]),
      monthly: buildTrend([
        { label: "Jan", electricity: 70850, water: 5710, gas: 2050, carbon: 26.4, cost: 23680 },
        { label: "Feb", electricity: 69980, water: 5590, gas: 2015, carbon: 26.0, cost: 23240 },
        { label: "Mar", electricity: 72310, water: 5860, gas: 2090, carbon: 26.9, cost: 24030 },
        { label: "Apr", electricity: 71540, water: 5790, gas: 2070, carbon: 26.7, cost: 23810 },
        { label: "May", electricity: 73420, water: 5980, gas: 2130, carbon: 27.4, cost: 24460 }
      ])
    },
    breakdownBySpace: [
      { label: "Block E", value: 36 },
      { label: "Block F", value: 34 },
      { label: "Block G", value: 30 }
    ],
    breakdownByTag: [
      { label: "Lighting", value: 21 },
      { label: "Plug Load", value: 31 },
      { label: "Air Conditioning", value: 39 },
      { label: "Others", value: 9 }
    ],
    topIssues: [
      { id: "iss-b1", issueType: "Offline gateway", location: "Block F Gateway 01", severity: "critical", updatedAt: "11:18" },
      { id: "iss-b2", issueType: "No data received", location: "Block G Floor 06", severity: "warning", updatedAt: "11:01" },
      { id: "iss-b3", issueType: "High water consumption", location: "Block E Pantry", severity: "warning", updatedAt: "10:54" },
      { id: "iss-b4", issueType: "Stagnant meter reading", location: "Block G Room 612", severity: "info", updatedAt: "10:22" }
    ]
  },
  {
    id: "site-cag",
    organizationId: "org-cag",
    projectId: "proj-cag-dorm",
    name: "CAG Dormitory",
    address: "Airport Cargo Zone 5, Singapore",
    facilityType: "Multi-site Portfolio",
    operationalStatus: "critical",
    description: "Critical zone dormitory with high sensitivity operations and strict uptime SLA.",
    gfa: 51200,
    mapPosition: { x: 68, y: 54 },
    activeAlarms: 9,
    kpis: {
      electricity: { value: 35610, unit: "kWh", changePct: 8.4, description: "Energy spikes under active investigation." },
      water: { value: 2890, unit: "m3", changePct: 4.3, description: "Water usage elevated due to leakage events." },
      gas: { value: 920, unit: "m3", changePct: 2.6, description: "Gas consumption increased with occupancy." },
      carbon: { value: 15.2, unit: "tCO2e", changePct: 5.8, description: "Carbon increase mirrors utility growth." },
      cost: { value: 12680, unit: "SGD", changePct: 9.1, description: "High cost due to critical alarms and demand." }
    },
    mtd: { electricity: 90500, water: 7240, carbon: 34.2, cost: 30760 },
    hierarchyCounts: { blocks: 5, floors: 34, rooms: 820, devices: 1460 },
    deviceStats: { total: 1460, online: 1332, offline: 72, warning: 56, gatewaysOnline: 13, gatewaysOffline: 3 },
    ranking: { eui: 139.6, wei: 3.4, utilityCost: 30760, carbon: 34.2, performance: "Poor" },
    trends: {
      realtime: buildTrend([
        { label: "00:00", electricity: 520, water: 40, gas: 14, carbon: 23, cost: 182 },
        { label: "04:00", electricity: 505, water: 37, gas: 13, carbon: 22, cost: 176 },
        { label: "08:00", electricity: 690, water: 54, gas: 18, carbon: 31, cost: 244 },
        { label: "12:00", electricity: 760, water: 62, gas: 20, carbon: 34, cost: 270 },
        { label: "16:00", electricity: 795, water: 67, gas: 21, carbon: 36, cost: 286 },
        { label: "20:00", electricity: 733, water: 60, gas: 18, carbon: 33, cost: 262 }
      ]),
      daily: buildTrend([
        { label: "Mon", electricity: 4720, water: 360, gas: 121, carbon: 208, cost: 1660 },
        { label: "Tue", electricity: 4840, water: 369, gas: 124, carbon: 214, cost: 1712 },
        { label: "Wed", electricity: 4920, water: 374, gas: 126, carbon: 217, cost: 1740 },
        { label: "Thu", electricity: 4880, water: 371, gas: 125, carbon: 215, cost: 1728 },
        { label: "Fri", electricity: 5090, water: 389, gas: 131, carbon: 224, cost: 1816 },
        { label: "Sat", electricity: 4730, water: 356, gas: 120, carbon: 208, cost: 1668 },
        { label: "Sun", electricity: 4650, water: 349, gas: 118, carbon: 204, cost: 1636 }
      ]),
      monthly: buildTrend([
        { label: "Jan", electricity: 86200, water: 6820, gas: 2480, carbon: 32.6, cost: 29310 },
        { label: "Feb", electricity: 84900, water: 6670, gas: 2420, carbon: 31.9, cost: 28740 },
        { label: "Mar", electricity: 88200, water: 6980, gas: 2520, carbon: 33.1, cost: 29920 },
        { label: "Apr", electricity: 87340, water: 6890, gas: 2485, carbon: 32.8, cost: 29610 },
        { label: "May", electricity: 90500, water: 7240, gas: 2600, carbon: 34.2, cost: 30760 }
      ])
    },
    breakdownBySpace: [
      { label: "North Block", value: 25 },
      { label: "South Block", value: 22 },
      { label: "East Block", value: 18 },
      { label: "West Block", value: 20 },
      { label: "Central Block", value: 15 }
    ],
    breakdownByTag: [
      { label: "Lighting", value: 18 },
      { label: "Plug Load", value: 27 },
      { label: "Air Conditioning", value: 45 },
      { label: "Others", value: 10 }
    ],
    topIssues: [
      { id: "iss-c1", issueType: "Offline gateway", location: "South Block Gateway 03", severity: "critical", updatedAt: "11:20" },
      { id: "iss-c2", issueType: "No data received", location: "North Block Floor 08", severity: "critical", updatedAt: "11:09" },
      { id: "iss-c3", issueType: "Abnormal electricity spike", location: "Central Block Kitchen", severity: "critical", updatedAt: "10:56" },
      { id: "iss-c4", issueType: "High water consumption", location: "East Block Utility Room", severity: "warning", updatedAt: "10:45" },
      { id: "iss-c5", issueType: "Stagnant meter reading", location: "West Block Room 712", severity: "warning", updatedAt: "10:15" }
    ]
  },
  {
    id: "site-hdb",
    organizationId: "org-vector-green",
    projectId: "proj-hdb-pilot",
    name: "HDB Utility Pilot",
    address: "220 Tampines Ave 4, Singapore",
    facilityType: "Commercial Building",
    operationalStatus: "normal",
    description: "Pilot commercial utility optimization site with IoT retrofit package.",
    gfa: 27400,
    mapPosition: { x: 57, y: 30 },
    activeAlarms: 2,
    kpis: {
      electricity: { value: 33190, unit: "kWh", changePct: 1.1, description: "Stable consumption after efficiency measures." },
      water: { value: 2330, unit: "m3", changePct: -3.0, description: "Water baseline improved through leak repair." },
      gas: { value: 840, unit: "m3", changePct: 0.4, description: "Gas usage remains within expected range." },
      carbon: { value: 14.7, unit: "tCO2e", changePct: -1.8, description: "Carbon trend improving quarter-on-quarter." },
      cost: { value: 9140, unit: "SGD", changePct: 2.5, description: "Moderate cost growth from tariff updates." }
    },
    mtd: { electricity: 86740, water: 6780, carbon: 31.5, cost: 28190 },
    hierarchyCounts: { blocks: 2, floors: 14, rooms: 264, devices: 780 },
    deviceStats: { total: 780, online: 758, offline: 8, warning: 14, gatewaysOnline: 6, gatewaysOffline: 0 },
    ranking: { eui: 108.2, wei: 2.5, utilityCost: 28190, carbon: 31.5, performance: "Good" },
    trends: {
      realtime: buildTrend([
        { label: "00:00", electricity: 390, water: 28, gas: 11, carbon: 17, cost: 132 },
        { label: "04:00", electricity: 372, water: 26, gas: 10, carbon: 16, cost: 126 },
        { label: "08:00", electricity: 530, water: 38, gas: 13, carbon: 24, cost: 186 },
        { label: "12:00", electricity: 610, water: 46, gas: 15, carbon: 27, cost: 214 },
        { label: "16:00", electricity: 648, water: 50, gas: 16, carbon: 29, cost: 228 },
        { label: "20:00", electricity: 588, water: 43, gas: 13, carbon: 25, cost: 205 }
      ]),
      daily: buildTrend([
        { label: "Mon", electricity: 4010, water: 294, gas: 98, carbon: 177, cost: 1418 },
        { label: "Tue", electricity: 4130, water: 301, gas: 100, carbon: 182, cost: 1466 },
        { label: "Wed", electricity: 4090, water: 298, gas: 99, carbon: 180, cost: 1450 },
        { label: "Thu", electricity: 4040, water: 294, gas: 98, carbon: 178, cost: 1430 },
        { label: "Fri", electricity: 4210, water: 308, gas: 102, carbon: 185, cost: 1496 },
        { label: "Sat", electricity: 3950, water: 286, gas: 96, carbon: 173, cost: 1392 },
        { label: "Sun", electricity: 3880, water: 279, gas: 94, carbon: 170, cost: 1368 }
      ]),
      monthly: buildTrend([
        { label: "Jan", electricity: 84200, water: 6640, gas: 2360, carbon: 30.9, cost: 27420 },
        { label: "Feb", electricity: 83120, water: 6490, gas: 2320, carbon: 30.4, cost: 26980 },
        { label: "Mar", electricity: 85450, water: 6720, gas: 2380, carbon: 31.2, cost: 27710 },
        { label: "Apr", electricity: 84810, water: 6670, gas: 2360, carbon: 30.9, cost: 27540 },
        { label: "May", electricity: 86740, water: 6780, gas: 2410, carbon: 31.5, cost: 28190 }
      ])
    },
    breakdownBySpace: [
      { label: "Tower 1", value: 46 },
      { label: "Tower 2", value: 54 }
    ],
    breakdownByTag: [
      { label: "Lighting", value: 26 },
      { label: "Plug Load", value: 34 },
      { label: "Air Conditioning", value: 31 },
      { label: "Others", value: 9 }
    ],
    topIssues: [
      { id: "iss-d1", issueType: "No data received", location: "Tower 2 LV panel", severity: "warning", updatedAt: "10:44" },
      { id: "iss-d2", issueType: "Stagnant meter reading", location: "Tower 1 meter cluster", severity: "info", updatedAt: "09:58" }
    ]
  }
];

export const overviewAlarms: AlarmRecord[] = [
  {
    id: "oa-1",
    projectId: "proj-cag-dorm",
    siteName: "CAG Dormitory",
    type: "Communication failure",
    severity: "critical",
    status: "active",
    time: "11:19",
    category: "communication_failure"
  },
  {
    id: "oa-2",
    projectId: "proj-cag-dorm",
    siteName: "CAG Dormitory",
    type: "Data unavailable",
    severity: "critical",
    status: "active",
    time: "11:09",
    category: "data_unavailable"
  },
  {
    id: "oa-3",
    projectId: "proj-st-b",
    siteName: "ST Lodge Site B",
    type: "Abnormal electricity spike",
    severity: "critical",
    status: "active",
    time: "10:56",
    category: "abnormal_electricity_spike"
  },
  {
    id: "oa-4",
    projectId: "proj-st-b",
    siteName: "ST Lodge Site B",
    type: "High water usage",
    severity: "warning",
    status: "active",
    time: "10:41",
    category: "high_water_usage"
  },
  {
    id: "oa-5",
    projectId: "proj-st-a",
    siteName: "ST Lodge Site A",
    type: "Stagnant reading",
    severity: "warning",
    status: "active",
    time: "10:12",
    category: "stagnant_reading"
  }
];

export const facilityTypeOptions: Array<FacilityType | "All"> = [
  "All",
  "Dormitory",
  "Commercial Building",
  "School",
  "Multi-site Portfolio"
];

export const operationalStatusOptions: Array<OperationalStatus | "All"> = ["All", "normal", "warning", "critical"];

export const analysisSpaceLevels: AnalysisSpaceLevel[] = ["Project", "Block", "Floor", "Room"];
export const analysisTimeRanges: AnalysisTimeRange[] = ["Today", "Last 7 Days", "MTD", "Last Month", "YTD", "Custom"];
export const analysisOperationalProfiles: OperationalProfileOption[] = [
  "Office Hours",
  "Dormitory Weekday",
  "Dormitory Weekend",
  "24-Hour Operation",
  "Custom Profile"
];
export const analysisCompareModes: CompareMode[] = ["Previous Period", "Similar Property Benchmark", "National Average"];

export const analysisDataByUtility: Record<AnalysisUtilityKey, AnalysisUtilityData> = {
  electricity: {
    highlights: [
      { key: "total", label: "Total Consumption", value: 128420, unit: "kWh", trendPct: 4.8, note: "Portfolio load increased in evening periods.", icon: "bolt" },
      { key: "eui", label: "EUI", value: 82.4, unit: "kWh/m2", trendPct: -1.2, note: "Efficiency improved at project level.", icon: "building" },
      { key: "peak", label: "Peak Demand", value: 238, unit: "kW", trendPct: 6.5, note: "Peak shifted to post-work dormitory hours.", icon: "gauge" },
      { key: "cost", label: "Estimated Cost", value: 34680, unit: "SGD", trendPct: 5.1, note: "Cost uplift follows tariff and demand increase.", icon: "coins" }
    ],
    assistantTemplates: [
      {
        id: "q1",
        prompt: "Why did electricity consumption increase yesterday?",
        response:
          "AI-assisted insight: Electricity consumption increased by 12.4% yesterday. Main contributors were Block A Floor 03 air-conditioning circuits and Room 03-12 plug load during non-operational hours."
      },
      {
        id: "q2",
        prompt: "Show top 10 abnormal rooms this month.",
        response:
          "AI-assisted insight: Top abnormal rooms are concentrated in Block A and Block C. 3 rooms exceeded similar-room averages by more than 25% and should be inspected for HVAC schedule drift."
      },
      {
        id: "q3",
        prompt: "Generate monthly utility summary.",
        response:
          "AI-assisted summary: Electricity +4.8%, Water -2.3%, Gas +1.2%. Biggest controllable load remains air-conditioning at 46% share."
      },
      {
        id: "q4",
        prompt: "Which block has the highest EUI?",
        response:
          "AI-assisted insight: Block A currently has the highest EUI at 96.1 kWh/m2, mainly driven by late-evening cooling and concentrated plug loads."
      },
      {
        id: "q5",
        prompt: "Suggest energy saving actions.",
        response:
          "AI-assisted recommendation: Prioritize HVAC schedule optimization on Block A Floor 03, then plug-load control in Room 03-12 and lighting retrofits in Block B corridors."
      },
      {
        id: "q6",
        prompt: "Compare this dormitory with similar properties.",
        response:
          "AI-assisted comparison: Current dormitory is slightly above similar-property electricity intensity (+6%) but below national average for water intensity (-4%)."
      }
    ],
    efficiency: {
      intensityLabel: "EUI",
      intensityValue: "82.4 kWh/m2",
      statusText: "Better than 62% of similar properties",
      historicalGfaNote: "Historical GFA records are applied based on the selected reporting period.",
      percentile: "Top 38%",
      percentileLabel: "Top 38%",
      benchmarkBars: [
        { label: "Current Property", value: 82.4 },
        { label: "Similar Average", value: 87.6 },
        { label: "National Average", value: 92.1 },
        { label: "Previous Period", value: 86.4 }
      ]
    },
    operationalProfileInsight:
      "Actual evening peak is 18% higher than the expected dormitory weekday profile.",
    profileData: [
      { hour: "00:00", expected: 38, actual: 41 },
      { hour: "04:00", expected: 35, actual: 37 },
      { hour: "08:00", expected: 42, actual: 48 },
      { hour: "12:00", expected: 46, actual: 50 },
      { hour: "16:00", expected: 44, actual: 49 },
      { hour: "20:00", expected: 58, actual: 69 },
      { hour: "23:00", expected: 52, actual: 61 }
    ],
    applianceDistribution: [
      { tag: "Air Conditioning", value: 59070, percentage: 46 },
      { tag: "Lighting", value: 26970, percentage: 21 },
      { tag: "Plug Load", value: 23120, percentage: 18 },
      { tag: "Kitchen", value: 11560, percentage: 9 },
      { tag: "Heater", value: 7700, percentage: 6 }
    ],
    topConsumers: [
      { rank: 1, name: "Room 03-12", type: "Room", consumption: 2140, intensity: 102.6, comparedToAverage: 29, status: "Outlier" },
      { rank: 2, name: "Block A Floor 03", type: "Floor", consumption: 15840, intensity: 96.1, comparedToAverage: 22, status: "High" },
      { rank: 3, name: "Block B", type: "Block", consumption: 24200, intensity: 81.4, comparedToAverage: 7, status: "High" },
      { rank: 4, name: "Lighting Tag", type: "Appliance Tag", consumption: 29620, intensity: 72.8, comparedToAverage: -4, status: "Normal" },
      { rank: 5, name: "Project ST-A", type: "Project", consumption: 81200, intensity: 68.3, comparedToAverage: -11, status: "Efficient" }
    ],
    anomalies: [
      {
        time: "2026-05-09 21:00",
        utility: "Electricity",
        location: "Block A Floor 03",
        anomalyType: "Abnormal electricity spike",
        severity: "Critical",
        possibleCause: "HVAC override schedule",
        recommendedAction: "Check BMS schedule and thermostat setpoints",
        status: "Pending Review"
      },
      {
        time: "2026-05-09 02:00",
        utility: "Electricity",
        location: "Room 03-12",
        anomalyType: "Weekend consumption above baseline",
        severity: "Warning",
        possibleCause: "Plug load left active overnight",
        recommendedAction: "Conduct room-level load inspection",
        status: "In Review"
      },
      {
        time: "2026-05-08 19:45",
        utility: "Electricity",
        location: "Main Incomer",
        anomalyType: "Peak load increase",
        severity: "Warning",
        possibleCause: "Concurrent AC startup",
        recommendedAction: "Stagger startup sequence",
        status: "Resolved"
      },
      {
        time: "2026-05-08 04:30",
        utility: "Electricity",
        location: "Block C Panel",
        anomalyType: "Data unavailable",
        severity: "Info",
        possibleCause: "Gateway packet loss",
        recommendedAction: "Validate communication link quality",
        status: "In Review"
      }
    ],
    anomalyStats: { total: 14, critical: 3, resolved: 6, pendingReview: 5 },
    behaviour24h: [
      { hour: "00", baseline: 40, actual: 43, abnormal: false },
      { hour: "02", baseline: 36, actual: 50, abnormal: true },
      { hour: "04", baseline: 35, actual: 39, abnormal: false },
      { hour: "06", baseline: 37, actual: 41, abnormal: false },
      { hour: "08", baseline: 45, actual: 50, abnormal: false },
      { hour: "10", baseline: 47, actual: 49, abnormal: false },
      { hour: "12", baseline: 50, actual: 53, abnormal: false },
      { hour: "14", baseline: 49, actual: 51, abnormal: false },
      { hour: "16", baseline: 48, actual: 52, abnormal: false },
      { hour: "18", baseline: 54, actual: 63, abnormal: true },
      { hour: "20", baseline: 58, actual: 69, abnormal: true },
      { hour: "22", baseline: 55, actual: 61, abnormal: true }
    ],
    costSummary: { totalEstimatedCost: 34680, highestCostBlock: "Block A", highestCostRoom: "Room 03-12", increaseVsPreviousPct: 5.1 },
    tariff: { electricity: "SGD 0.30 / kWh", water: "SGD 2.80 / m3", gas: "SGD 1.20 / m3" },
    costByBlock: [
      { name: "Block A", cost: 14120 },
      { name: "Block B", cost: 9620 },
      { name: "Block C", cost: 6940 },
      { name: "Block D", cost: 4000 }
    ],
    costByTag: [
      { name: "Air Conditioning", cost: 15950, secondary: 46 },
      { name: "Lighting", cost: 7280, secondary: 21 },
      { name: "Plug Load", cost: 6240, secondary: 18 },
      { name: "Kitchen", cost: 3120, secondary: 9 },
      { name: "Heater", cost: 2090, secondary: 6 }
    ],
    costBySpace: [
      { name: "Block A", level: "Block", cost: 14120 },
      { name: "Block B", level: "Block", cost: 9620 },
      { name: "Floor A-03", level: "Floor", cost: 5380 },
      { name: "Floor B-02", level: "Floor", cost: 4310 },
      { name: "Room 03-12", level: "Room", cost: 2140, perCapitaCost: 178.3 },
      { name: "Room 03-08", level: "Room", cost: 1890, perCapitaCost: 157.5 },
      { name: "Room 02-17", level: "Room", cost: 1760, perCapitaCost: 146.7 }
    ],
    findings: [
      "Total electricity consumption increased by 4.8% compared with previous period.",
      "Air-conditioning circuits contributed the largest share of consumption.",
      "Block A Floor 03 shows abnormal evening peak behavior.",
      "Three rooms exceeded peer average by more than 25%.",
      "Recommended action: inspect air-conditioning schedule and plug load usage."
    ],
    recommendations: [
      {
        id: "rec-e-1",
        title: "Optimize air-conditioning schedule for Block A Floor 03",
        affectedArea: "Block A Floor 03",
        estimatedSaving: "8-11% electricity",
        priority: "High",
        reason: "Evening peak exceeds expected dormitory profile.",
        suggestedAction: "Shift HVAC schedule by occupancy window and tighten setpoint bands.",
        status: "New",
        owner: "TBD"
      },
      {
        id: "rec-e-2",
        title: "Investigate plug load usage in Room 03-12",
        affectedArea: "Room 03-12",
        estimatedSaving: "3-5% electricity",
        priority: "High",
        reason: "Night baseline remains elevated after midnight.",
        suggestedAction: "Audit always-on devices and install timed controls.",
        status: "In Review",
        owner: "Ops Lead"
      },
      {
        id: "rec-e-3",
        title: "Replace inefficient lighting in Block B common corridor",
        affectedArea: "Block B",
        estimatedSaving: "2-4% electricity",
        priority: "Medium",
        reason: "Lighting intensity above comparable corridor benchmark.",
        suggestedAction: "Deploy LED retrofit and occupancy sensors.",
        status: "New",
        owner: "Facilities"
      },
      {
        id: "rec-e-4",
        title: "Review weekend operation profile",
        affectedArea: "Portfolio",
        estimatedSaving: "1-3% electricity",
        priority: "Low",
        reason: "Weekend load remains close to weekday baseline.",
        suggestedAction: "Adjust profile and auto-alert thresholds for weekends.",
        status: "New",
        owner: "Energy Manager"
      }
    ],
    actionLog: [
      { recommendation: "Optimize air-conditioning schedule for Block A Floor 03", owner: "TBD", status: "New", createdDate: "2026-05-09", expectedSaving: "8-11%" },
      { recommendation: "Investigate plug load usage in Room 03-12", owner: "Ops Lead", status: "In Review", createdDate: "2026-05-09", expectedSaving: "3-5%" }
    ]
  },
  water: {
    highlights: [
      { key: "total", label: "Total Consumption", value: 9860, unit: "m3", trendPct: -2.3, note: "Portfolio water usage declined after leak fixes.", icon: "droplet" },
      { key: "wei", label: "WEI", value: 1.92, unit: "m3/m2", trendPct: 1.1, note: "WEI slightly above similar-property baseline.", icon: "building" },
      { key: "area", label: "Highest Usage Area", value: "Block A Floor 03", unit: "", trendPct: 3.8, note: "Persistent high draw in sanitation area.", icon: "triangle" },
      { key: "cost", label: "Estimated Cost", value: 18420, unit: "SGD", trendPct: 2.7, note: "Water tariff and high-use area drive cost.", icon: "coins" }
    ],
    assistantTemplates: [
      {
        id: "w1",
        prompt: "Why is water usage high on Floor 03?",
        response: "AI-assisted insight: Floor 03 usage is 17% above expected profile, likely from intermittent leakage and continuous night flow signatures."
      },
      {
        id: "w2",
        prompt: "Show possible water leak locations.",
        response: "AI-assisted insight: Candidate leak points include Block A Floor 03 toilet zone and Block C utility shaft with stagnant-recovery patterns."
      },
      {
        id: "w3",
        prompt: "Generate monthly utility summary.",
        response: "AI-assisted summary: Water consumption reduced by 2.3%, while two zones remain above benchmark and require follow-up."
      },
      {
        id: "w4",
        prompt: "Which block has highest WEI?",
        response: "AI-assisted insight: Block A currently has highest WEI (2.18 m3/m2), especially during evening occupancy windows."
      },
      {
        id: "w5",
        prompt: "Suggest energy saving actions.",
        response: "AI-assisted recommendation: Prioritize leak repair, optimize flushing schedules, and tighten nightly flow thresholds."
      },
      {
        id: "w6",
        prompt: "Compare this dormitory with similar properties.",
        response: "AI-assisted comparison: WEI is slightly worse than 45% of peers, but monthly trend is improving."
      }
    ],
    efficiency: {
      intensityLabel: "WEI",
      intensityValue: "1.92 m3/m2",
      statusText: "Worse than 45% of similar properties",
      historicalGfaNote: "Historical GFA records are applied based on the selected reporting period.",
      percentile: "Average",
      percentileLabel: "Average",
      benchmarkBars: [
        { label: "Current Property", value: 1.92 },
        { label: "Similar Average", value: 1.84 },
        { label: "National Average", value: 2.01 },
        { label: "Previous Period", value: 1.97 }
      ]
    },
    operationalProfileInsight: "Actual evening water usage is 11% higher than expected dormitory weekday profile.",
    profileData: [
      { hour: "00:00", expected: 26, actual: 30 },
      { hour: "04:00", expected: 22, actual: 24 },
      { hour: "08:00", expected: 35, actual: 38 },
      { hour: "12:00", expected: 41, actual: 44 },
      { hour: "16:00", expected: 39, actual: 43 },
      { hour: "20:00", expected: 48, actual: 55 },
      { hour: "23:00", expected: 36, actual: 41 }
    ],
    applianceDistribution: [
      { tag: "Lighting", value: 0, percentage: 0 },
      { tag: "Plug Load", value: 0, percentage: 0 },
      { tag: "Air Conditioning", value: 2810, percentage: 28 },
      { tag: "Others", value: 7050, percentage: 72 }
    ],
    topConsumers: [
      { rank: 1, name: "Block A Floor 03", type: "Floor", consumption: 1240, intensity: 2.18, comparedToAverage: 18, status: "Outlier" },
      { rank: 2, name: "Block C Toilet Zone", type: "Room", consumption: 580, intensity: 2.01, comparedToAverage: 14, status: "High" },
      { rank: 3, name: "Block B", type: "Block", consumption: 2140, intensity: 1.85, comparedToAverage: 5, status: "High" },
      { rank: 4, name: "Project ST-A", type: "Project", consumption: 6420, intensity: 1.74, comparedToAverage: -2, status: "Normal" },
      { rank: 5, name: "Cooling Tower", type: "Appliance Tag", consumption: 910, intensity: 1.62, comparedToAverage: -9, status: "Efficient" }
    ],
    anomalies: [
      {
        time: "2026-05-09 03:15",
        utility: "Water",
        location: "Block A Floor 03",
        anomalyType: "Possible water leak",
        severity: "Critical",
        possibleCause: "Continuous flow overnight",
        recommendedAction: "Inspect valves and toilet cisterns",
        status: "Pending Review"
      },
      {
        time: "2026-05-09 01:50",
        utility: "Water",
        location: "Block B Floor 02",
        anomalyType: "Stagnant water reading",
        severity: "Warning",
        possibleCause: "Meter pulse interruption",
        recommendedAction: "Validate meter wiring and pulse output",
        status: "In Review"
      },
      {
        time: "2026-05-08 22:30",
        utility: "Water",
        location: "Block C Utility Shaft",
        anomalyType: "Data unavailable",
        severity: "Info",
        possibleCause: "Gateway communication instability",
        recommendedAction: "Check gateway signal and reboot",
        status: "Resolved"
      }
    ],
    anomalyStats: { total: 9, critical: 2, resolved: 4, pendingReview: 3 },
    behaviour24h: [
      { hour: "00", baseline: 25, actual: 28, abnormal: false },
      { hour: "02", baseline: 22, actual: 31, abnormal: true },
      { hour: "04", baseline: 21, actual: 23, abnormal: false },
      { hour: "06", baseline: 24, actual: 26, abnormal: false },
      { hour: "08", baseline: 32, actual: 37, abnormal: false },
      { hour: "10", baseline: 35, actual: 37, abnormal: false },
      { hour: "12", baseline: 39, actual: 42, abnormal: false },
      { hour: "14", baseline: 38, actual: 40, abnormal: false },
      { hour: "16", baseline: 37, actual: 41, abnormal: false },
      { hour: "18", baseline: 42, actual: 48, abnormal: true },
      { hour: "20", baseline: 45, actual: 54, abnormal: true },
      { hour: "22", baseline: 39, actual: 44, abnormal: true }
    ],
    costSummary: { totalEstimatedCost: 18420, highestCostBlock: "Block A", highestCostRoom: "Floor 03 Toilet Area", increaseVsPreviousPct: 2.7 },
    tariff: { electricity: "SGD 0.30 / kWh", water: "SGD 2.80 / m3", gas: "SGD 1.20 / m3" },
    costByBlock: [
      { name: "Block A", cost: 7620 },
      { name: "Block B", cost: 5020 },
      { name: "Block C", cost: 3780 },
      { name: "Block D", cost: 2000 }
    ],
    costByTag: [
      { name: "Cooling Tower", cost: 6160, secondary: 33 },
      { name: "Toilet / Sanitary", cost: 7280, secondary: 40 },
      { name: "Kitchen", cost: 3120, secondary: 17 },
      { name: "Others", cost: 1860, secondary: 10 }
    ],
    costBySpace: [
      { name: "Block A", level: "Block", cost: 7620 },
      { name: "Block B", level: "Block", cost: 5020 },
      { name: "Floor A-03", level: "Floor", cost: 2860 },
      { name: "Floor B-02", level: "Floor", cost: 2180 },
      { name: "Room A03-Toilet", level: "Room", cost: 1120, perCapitaCost: 93.3 },
      { name: "Room B02-Utility", level: "Room", cost: 860, perCapitaCost: 71.7 },
      { name: "Room C01-Wash", level: "Room", cost: 740, perCapitaCost: 61.7 }
    ],
    findings: [
      "Total water consumption decreased by 2.3% compared with previous period.",
      "Floor 03 remains the highest-use area and requires leak checks.",
      "Night-time baseline remains elevated in two blocks.",
      "Data quality improved after gateway stabilization.",
      "Recommended action: prioritize leak inspection and meter health checks."
    ],
    recommendations: [
      {
        id: "rec-w-1",
        title: "Check possible water leakage at Floor 02 toilet area",
        affectedArea: "Block B Floor 02",
        estimatedSaving: "4-6% water",
        priority: "High",
        reason: "Continuous overnight flow signature detected.",
        suggestedAction: "Inspect fixtures and valve integrity.",
        status: "New",
        owner: "TBD"
      },
      {
        id: "rec-w-2",
        title: "Review weekend operation profile",
        affectedArea: "Portfolio",
        estimatedSaving: "1-2% water",
        priority: "Medium",
        reason: "Weekend pattern close to weekday baseline.",
        suggestedAction: "Apply lower weekend baseline thresholds.",
        status: "In Review",
        owner: "Ops Lead"
      }
    ],
    actionLog: [{ recommendation: "Check possible water leakage at Floor 02 toilet area", owner: "TBD", status: "New", createdDate: "2026-05-09", expectedSaving: "4-6%" }]
  },
  gas: {
    highlights: [
      { key: "total", label: "Total Consumption", value: 3240, unit: "m3", trendPct: 1.2, note: "Gas usage slightly increased with evening demand.", icon: "flame" },
      { key: "period", label: "Highest Usage Period", value: "7 PM – 10 PM", unit: "", trendPct: 2.1, note: "Evening cooking and heating window dominates.", icon: "clock" },
      { key: "alerts", label: "Abnormal Usage Alerts", value: 2, unit: "alerts", trendPct: 0, note: "Two gas anomalies flagged for review.", icon: "triangle" },
      { key: "cost", label: "Estimated Cost", value: 4280, unit: "SGD", trendPct: 1.9, note: "Cost increase tracks minor usage growth.", icon: "coins" }
    ],
    assistantTemplates: [
      {
        id: "g1",
        prompt: "Why did gas consumption increase yesterday?",
        response: "AI-assisted insight: Gas usage rose 6.2% during 19:00-22:00, mainly from extended kitchen operation and delayed shutdown."
      },
      {
        id: "g2",
        prompt: "Show top 10 abnormal rooms this month.",
        response: "AI-assisted insight: Abnormal gas readings are concentrated near central kitchen risers and two utility rooms."
      },
      {
        id: "g3",
        prompt: "Generate monthly utility summary.",
        response: "AI-assisted summary: Gas remains stable overall, with two short out-of-profile evening spikes."
      },
      {
        id: "g4",
        prompt: "Which block has the highest EUI?",
        response: "AI-assisted note: Gas intensity benchmarking is not configured at full granularity for all blocks."
      },
      {
        id: "g5",
        prompt: "Suggest energy saving actions.",
        response: "AI-assisted recommendation: Tighten evening cutoff controls and verify gas meter battery health for reliable telemetry."
      },
      {
        id: "g6",
        prompt: "Compare this dormitory with similar properties.",
        response: "AI-assisted comparison: Gas usage is near peer median; benchmark confidence is medium due to partial schema coverage."
      }
    ],
    efficiency: {
      intensityLabel: "Gas Intensity",
      intensityValue: "Benchmarking not configured",
      statusText: "Gas benchmarking not configured for this profile",
      historicalGfaNote: "Historical GFA records are applied based on the selected reporting period.",
      percentile: "Below benchmark",
      percentileLabel: "Below benchmark",
      benchmarkBars: [
        { label: "Current Property", value: 64 },
        { label: "Similar Average", value: 61 },
        { label: "National Average", value: 65 },
        { label: "Previous Period", value: 62 }
      ]
    },
    operationalProfileInsight: "Actual evening gas peak is 9% higher than expected profile between 19:00 and 22:00.",
    profileData: [
      { hour: "00:00", expected: 12, actual: 13 },
      { hour: "04:00", expected: 9, actual: 10 },
      { hour: "08:00", expected: 11, actual: 12 },
      { hour: "12:00", expected: 16, actual: 17 },
      { hour: "16:00", expected: 17, actual: 18 },
      { hour: "20:00", expected: 22, actual: 24 },
      { hour: "23:00", expected: 14, actual: 15 }
    ],
    applianceDistribution: [
      { tag: "Lighting", value: 0, percentage: 0 },
      { tag: "Plug Load", value: 0, percentage: 0 },
      { tag: "Air Conditioning", value: 0, percentage: 0 },
      { tag: "Others", value: 3240, percentage: 100 }
    ],
    topConsumers: [
      { rank: 1, name: "Central Kitchen Riser", type: "Appliance Tag", consumption: 880, intensity: 2.8, comparedToAverage: 19, status: "High" },
      { rank: 2, name: "Block A Kitchen", type: "Room", consumption: 610, intensity: 2.3, comparedToAverage: 13, status: "High" },
      { rank: 3, name: "Block C Utility", type: "Floor", consumption: 530, intensity: 2.1, comparedToAverage: 7, status: "Normal" },
      { rank: 4, name: "Block B", type: "Block", consumption: 1140, intensity: 1.9, comparedToAverage: -2, status: "Efficient" }
    ],
    anomalies: [
      {
        time: "2026-05-09 20:30",
        utility: "Gas",
        location: "Central Kitchen",
        anomalyType: "Gas usage outside expected period",
        severity: "Warning",
        possibleCause: "Extended cooking schedule",
        recommendedAction: "Verify operating schedule and auto shutoff",
        status: "Pending Review"
      },
      {
        time: "2026-05-09 06:20",
        utility: "Gas",
        location: "Block B Meter",
        anomalyType: "Data unavailable",
        severity: "Info",
        possibleCause: "Low battery warning",
        recommendedAction: "Replace meter battery and verify telemetry",
        status: "In Review"
      }
    ],
    anomalyStats: { total: 5, critical: 0, resolved: 2, pendingReview: 3 },
    behaviour24h: [
      { hour: "00", baseline: 12, actual: 13, abnormal: false },
      { hour: "02", baseline: 10, actual: 10, abnormal: false },
      { hour: "04", baseline: 9, actual: 10, abnormal: false },
      { hour: "06", baseline: 10, actual: 12, abnormal: true },
      { hour: "08", baseline: 11, actual: 12, abnormal: false },
      { hour: "10", baseline: 13, actual: 14, abnormal: false },
      { hour: "12", baseline: 16, actual: 17, abnormal: false },
      { hour: "14", baseline: 15, actual: 16, abnormal: false },
      { hour: "16", baseline: 17, actual: 18, abnormal: false },
      { hour: "18", baseline: 20, actual: 23, abnormal: true },
      { hour: "20", baseline: 22, actual: 24, abnormal: true },
      { hour: "22", baseline: 16, actual: 18, abnormal: true }
    ],
    costSummary: { totalEstimatedCost: 4280, highestCostBlock: "Block A", highestCostRoom: "Central Kitchen", increaseVsPreviousPct: 1.9 },
    tariff: { electricity: "SGD 0.30 / kWh", water: "SGD 2.80 / m3", gas: "SGD 1.20 / m3" },
    costByBlock: [
      { name: "Block A", cost: 1650 },
      { name: "Block B", cost: 1220 },
      { name: "Block C", cost: 890 },
      { name: "Block D", cost: 520 }
    ],
    costByTag: [
      { name: "Kitchen", cost: 2380, secondary: 56 },
      { name: "Heating", cost: 1210, secondary: 28 },
      { name: "Others", cost: 690, secondary: 16 }
    ],
    costBySpace: [
      { name: "Block A", level: "Block", cost: 1650 },
      { name: "Block B", level: "Block", cost: 1220 },
      { name: "Floor A-01", level: "Floor", cost: 680 },
      { name: "Floor B-01", level: "Floor", cost: 520 },
      { name: "Room Central Kitchen", level: "Room", cost: 480, perCapitaCost: 40.0 },
      { name: "Room B01-Pantry", level: "Room", cost: 340, perCapitaCost: 28.3 },
      { name: "Room A01-Prep", level: "Room", cost: 290, perCapitaCost: 24.2 }
    ],
    findings: [
      "Total gas consumption increased by 1.2% compared with previous period.",
      "Highest usage period remains 19:00-22:00.",
      "Two out-of-profile events were detected in kitchen circuits.",
      "Data reliability is moderate due to one battery-related telemetry issue.",
      "Recommended action: enforce shutdown checks and meter battery maintenance."
    ],
    recommendations: [
      {
        id: "rec-g-1",
        title: "Review evening gas operation profile",
        affectedArea: "Central Kitchen",
        estimatedSaving: "2-4% gas",
        priority: "Medium",
        reason: "Evening consumption extends beyond expected window.",
        suggestedAction: "Apply stricter cutoff and occupancy checks.",
        status: "New",
        owner: "TBD"
      },
      {
        id: "rec-g-2",
        title: "Check gas meter battery alert",
        affectedArea: "Block B Meter Cluster",
        estimatedSaving: "Data reliability improvement",
        priority: "High",
        reason: "Low battery increases risk of missing telemetry.",
        suggestedAction: "Replace battery and validate transmission quality.",
        status: "In Review",
        owner: "Maintenance Team"
      }
    ],
    actionLog: [
      { recommendation: "Review evening gas operation profile", owner: "TBD", status: "New", createdDate: "2026-05-09", expectedSaving: "2-4%" },
      { recommendation: "Check gas meter battery alert", owner: "Maintenance Team", status: "In Review", createdDate: "2026-05-08", expectedSaving: "Reliability" }
    ]
  }
};

