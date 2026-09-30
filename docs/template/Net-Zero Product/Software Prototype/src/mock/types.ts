export type ModuleKey =
  | "overview"
  | "utilities"
  | "analysis"
  | "billing"
  | "data"
  | "project"
  | "system"
  | "reports";

export type UtilityType = "electricity" | "water" | "gas";
export type HealthStatus = "healthy" | "warning" | "critical" | "offline";

export interface Organization {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  location: string;
  type: "dormitory" | "commercial" | "school" | "portfolio";
}

export interface HierarchyNode {
  id: string;
  name: string;
  level: "project" | "block" | "floor" | "room" | "bed" | "device";
  status?: HealthStatus;
  children?: HierarchyNode[];
}

export interface Device {
  id: string;
  projectId: string;
  name: string;
  category: string;
  status: HealthStatus;
  locationPath: string;
}

export interface Meter {
  id: string;
  projectId: string;
  utility: UtilityType;
  serialNumber: string;
  status: HealthStatus;
  reading: number;
  unit: string;
}

export interface Tenant {
  id: string;
  projectId: string;
  name: string;
  unit: string;
  contractType: string;
  billingCycle: string;
}

export interface Incident {
  id: string;
  projectId: string;
  title: string;
  severity: "low" | "medium" | "high";
  status: "open" | "in_progress" | "resolved";
  openedAt: string;
}

export interface Alarm {
  id: string;
  projectId: string;
  source: string;
  level: "info" | "warning" | "critical";
  status: "active" | "acknowledged" | "cleared";
  timestamp: string;
}

export interface Bill {
  id: string;
  tenantId: string;
  period: string;
  amount: number;
  status: "draft" | "generated" | "sent" | "paid";
}

export interface ReportItem {
  id: string;
  type: string;
  projectId: string;
  generatedAt: string;
  status: "ready" | "queued" | "failed";
}

export interface KpiMetric {
  key: string;
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down";
  unitHint?: string;
}

export interface TrendPoint {
  name: string;
  electricity: number;
  water: number;
  gas: number;
  carbon: number;
  cost: number;
}

export type FacilityType = "Dormitory" | "Commercial Building" | "School" | "Multi-site Portfolio";
export type OperationalStatus = "normal" | "warning" | "critical";
export type SeverityLevel = "critical" | "warning" | "info";

export interface UtilityMetricValue {
  value: number;
  unit: string;
  changePct: number;
  description: string;
}

export interface SiteKpiSet {
  electricity: UtilityMetricValue;
  water: UtilityMetricValue;
  gas: UtilityMetricValue;
  carbon: UtilityMetricValue;
  cost: UtilityMetricValue;
}

export interface SiteDeviceStatistics {
  total: number;
  online: number;
  offline: number;
  warning: number;
  gatewaysOnline: number;
  gatewaysOffline: number;
}

export interface SiteHierarchyCounts {
  blocks: number;
  floors: number;
  rooms: number;
  devices: number;
}

export interface SiteRankingMetrics {
  eui: number;
  wei: number;
  utilityCost: number;
  carbon: number;
  performance: "Good" | "Average" | "Poor";
}

export interface SiteTrendDataPoint {
  label: string;
  electricity: number;
  water: number;
  gas: number;
  carbon: number;
  cost: number;
}

export interface OverviewIssueItem {
  id: string;
  issueType: string;
  location: string;
  severity: SeverityLevel;
  updatedAt: string;
}

export interface AlarmRecord {
  id: string;
  projectId: string;
  siteName: string;
  type: string;
  severity: SeverityLevel;
  status: "active" | "acknowledged" | "resolved";
  time: string;
  category: "communication_failure" | "data_unavailable" | "abnormal_electricity_spike" | "high_water_usage" | "stagnant_reading";
}

export interface OverviewSite {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  address: string;
  facilityType: FacilityType;
  operationalStatus: OperationalStatus;
  description: string;
  gfa: number;
  mapPosition: { x: number; y: number };
  activeAlarms: number;
  kpis: SiteKpiSet;
  mtd: {
    electricity: number;
    water: number;
    carbon: number;
    cost: number;
  };
  hierarchyCounts: SiteHierarchyCounts;
  deviceStats: SiteDeviceStatistics;
  ranking: SiteRankingMetrics;
  trends: {
    realtime: SiteTrendDataPoint[];
    daily: SiteTrendDataPoint[];
    monthly: SiteTrendDataPoint[];
  };
  breakdownBySpace: { label: string; value: number }[];
  breakdownByTag: { label: string; value: number }[];
  topIssues: OverviewIssueItem[];
}

export type AnalysisUtilityKey = "electricity" | "water" | "gas";
export type AnalysisSpaceLevel = "Project" | "Block" | "Floor" | "Room";
export type AnalysisTimeRange = "Today" | "Last 7 Days" | "MTD" | "Last Month" | "YTD" | "Custom";
export type OperationalProfileOption = "Office Hours" | "Dormitory Weekday" | "Dormitory Weekend" | "24-Hour Operation" | "Custom Profile";
export type CompareMode = "Previous Period" | "Similar Property Benchmark" | "National Average";
export type InsightSeverity = "critical" | "warning" | "normal" | "info";

export interface AnalysisHighlight {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  trendPct: number;
  note: string;
  icon: "bolt" | "droplet" | "flame" | "coins" | "gauge" | "building" | "clock" | "triangle";
}

export interface AssistantTemplate {
  id: string;
  prompt: string;
  response: string;
}

export interface BenchmarkBarItem {
  label: string;
  value: number;
}

export interface EfficiencyBenchmarkData {
  intensityLabel: string;
  intensityValue: string;
  statusText: string;
  historicalGfaNote: string;
  percentile: string;
  percentileLabel: "Top 38%" | "Average" | "Below benchmark";
  benchmarkBars: BenchmarkBarItem[];
}

export interface ProfilePoint {
  hour: string;
  expected: number;
  actual: number;
}

export interface ApplianceDistributionItem {
  tag: string;
  value: number;
  percentage: number;
}

export interface TopConsumerRecord {
  rank: number;
  name: string;
  type: string;
  consumption: number;
  intensity: number;
  comparedToAverage: number;
  status: "Outlier" | "High" | "Normal" | "Efficient";
}

export interface AnalysisAnomalyRecord {
  time: string;
  utility: string;
  location: string;
  anomalyType: string;
  severity: "Critical" | "Warning" | "Info";
  possibleCause: string;
  recommendedAction: string;
  status: "Pending Review" | "In Review" | "Resolved";
}

export interface BehaviourPoint {
  hour: string;
  baseline: number;
  actual: number;
  abnormal: boolean;
}

export interface CostByDimensionItem {
  name: string;
  cost: number;
  secondary?: number;
}

export interface CostBySpaceItem {
  name: string;
  level: "Block" | "Floor" | "Room";
  cost: number;
  perCapitaCost?: number;
}

export interface RecommendationItem {
  id: string;
  title: string;
  affectedArea: string;
  estimatedSaving: string;
  priority: "High" | "Medium" | "Low";
  reason: string;
  suggestedAction: string;
  status: "New" | "In Review" | "Implemented" | "Rejected";
  owner: string;
}

export interface ActionLogItem {
  recommendation: string;
  owner: string;
  status: "New" | "In Review" | "Implemented" | "Rejected";
  createdDate: string;
  expectedSaving: string;
}

export interface AnalysisUtilityData {
  highlights: AnalysisHighlight[];
  assistantTemplates: AssistantTemplate[];
  efficiency: EfficiencyBenchmarkData;
  operationalProfileInsight: string;
  profileData: ProfilePoint[];
  applianceDistribution: ApplianceDistributionItem[];
  topConsumers: TopConsumerRecord[];
  anomalies: AnalysisAnomalyRecord[];
  anomalyStats: {
    total: number;
    critical: number;
    resolved: number;
    pendingReview: number;
  };
  behaviour24h: BehaviourPoint[];
  costSummary: {
    totalEstimatedCost: number;
    highestCostBlock: string;
    highestCostRoom: string;
    increaseVsPreviousPct: number;
  };
  tariff: {
    electricity: string;
    water: string;
    gas: string;
  };
  costByBlock: CostByDimensionItem[];
  costByTag: CostByDimensionItem[];
  costBySpace: CostBySpaceItem[];
  findings: string[];
  recommendations: RecommendationItem[];
  actionLog: ActionLogItem[];
}
