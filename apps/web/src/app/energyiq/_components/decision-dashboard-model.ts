import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";

export type DashboardInsight = {
  id: string;
  scopeId: string;
  severity: "high" | "medium" | "info";
  scope: string;
  title: string;
  finding: string;
  impact: string;
  action: string;
  evidence: string;
};

export type DecisionDashboardModel = {
  projectName: string;
  periodLabel: string;
  summary: Array<{
    label: string;
    value: string;
    note: string;
    tone: "warning" | "muted" | "success";
  }>;
  trend: Array<{ day: string; current: number; baseline: number }>;
  ranking: Array<{ scope: string; value: number; change: number }>;
  insights: DashboardInsight[];
  benchmarkRows: Array<{
    scope: string;
    nodeId: string;
    energy: number;
    area?: number;
    occupants?: number;
    eui?: number;
    perPerson?: number;
    sharePct: number;
  }>;
  operatingMix: Array<{ category: string; operating: number; offHours: number }>;
  timeProfile: Array<{ slot: string; average: number; peak: number }>;
  forecast: {
    projectedUsage: string;
    projectedCost: string;
    readiness: string;
  };
  provenanceLabel: string;
};

export function buildDecisionDashboardModel(
  analysis: EnergyScopeAnalysisDto,
): DecisionDashboardModel {
  const { context, summary } = analysis;
  const insights = buildInsights(analysis);
  const circuitsForComposition = analysis.circuits.some((circuit) => circuit.meterRole !== "total")
    ? analysis.circuits.filter((circuit) => circuit.meterRole !== "total")
    : analysis.circuits;
  const offHours = analysis.offHours.status === "available" ? analysis.offHours : null;
  const cost = analysis.cost.status === "available" ? analysis.cost : null;
  const offHoursUnavailableReason = analysis.offHours.status === "unavailable"
    ? analysis.offHours.reason.message
    : null;
  const costUnavailableReason = analysis.cost.status === "unavailable"
    ? analysis.cost.reason.message
    : null;

  return {
    projectName: context.projectName,
    periodLabel: formatPeriod(context.from, context.to),
    summary: [
      {
        label: "Total consumption",
        value: `${formatNumber(summary.usageKwh, 2)} kWh`,
        note: offHours
          ? `${formatNumber(offHours.standbyKwh, 2)} kWh outside operating hours`
          : `Operating-hours unavailable: ${offHoursUnavailableReason ?? "Policy facts unavailable"}`,
        tone: offHours && offHours.sharePct >= 10 ? "warning" : "muted",
      },
      {
        label: "Energy cost",
        value: cost ? formatCurrencyAmount(cost.amount, cost.currency, 2) : "Unavailable",
        note: cost ? `Tariff ${cost.tariffScheduleVersion}` : costUnavailableReason ?? "Policy facts unavailable",
        tone: "muted",
      },
      {
        label: "Off-hours share",
        value: offHours ? `${offHours.sharePct.toFixed(1)}%` : "Unavailable",
        note: offHours
          ? offHours.sharePct >= 10 ? "Review shutdown schedules" : "Within the current rule threshold"
          : offHoursUnavailableReason ?? "Policy facts unavailable",
        tone: offHours ? offHours.sharePct >= 10 ? "warning" : "success" : "muted",
      },
      {
        label: "Data quality",
        value: summary.qualityEventCount > 0 ? "Review" : "Validated",
        note: `${summary.validIntervalCount.toLocaleString()} valid · ${summary.qualityEventCount} flagged`,
        tone: summary.qualityEventCount > 0 ? "warning" : "success",
      },
    ],
    trend: analysis.hourlyProfile.map((point) => ({
      day: `${String(point.hour).padStart(2, "0")}:00`,
      current: point.averageKw,
      baseline: point.peakKw,
    })),
    ranking: analysis.childScopes.slice(0, 8).map((child) => ({
      scope: child.name,
      value: child.usageKwh,
      change: child.sharePct,
    })),
    insights,
    benchmarkRows: analysis.childScopes.slice(0, 12).map((child) => ({
      scope: child.name,
      nodeId: child.nodeId,
      energy: child.usageKwh,
      ...(child.areaSqm !== undefined ? { area: child.areaSqm } : {}),
      ...(child.occupantCount !== undefined ? { occupants: child.occupantCount } : {}),
      ...(child.kwhPerSqm !== undefined ? { eui: child.kwhPerSqm } : {}),
      ...(child.kwhPerPerson !== undefined ? { perPerson: child.kwhPerPerson } : {}),
      sharePct: child.sharePct,
    })),
    operatingMix: offHours ? buildOperatingMix(circuitsForComposition) : [],
    timeProfile: buildTimeProfile(analysis.hourlyProfile),
    forecast: {
      projectedUsage: `${formatNumber(summary.usageKwh, 0)} kWh`,
      projectedCost: cost ? formatCurrencyAmount(cost.amount, cost.currency, 0) : "Unavailable",
      readiness: "Not released",
    },
    provenanceLabel: `${analysis.provenance.dataSnapshotId} · ${analysis.provenance.metricVersion}`,
  };
}

function buildInsights(analysis: EnergyScopeAnalysisDto): DashboardInsight[] {
  const mapped = analysis.attention.map((item, index) => {
    const child = analysis.childScopes.find((candidate) => item.title.startsWith(candidate.name));
    return {
      id: `${item.code.toLowerCase()}-${index}`,
      scopeId: child?.nodeId ?? analysis.context.scopeId,
      severity: item.severity === "warning" ? "high" as const : "info" as const,
      scope: child?.name ?? analysis.context.scopeName,
      title: item.title,
      finding: item.evidence,
      impact: impactForAttention(item.code, analysis),
      action: item.suggestedAction,
      evidence: `${analysis.provenance.dataSnapshotId} · ${analysis.provenance.queryIds.join(", ")}`,
    };
  });
  if (mapped.length > 0) return mapped;
  return [{
    id: "no-deterministic-exception",
    scopeId: analysis.context.scopeId,
    severity: "info",
    scope: analysis.context.scopeName,
    title: "No deterministic exception was triggered",
    finding: "The selected period passed the currently published time, quality and normalisation rules.",
    impact: `${formatNumber(analysis.summary.usageKwh, 2)} kWh analysed`,
    action: "Continue monitoring after the next scheduled data import.",
    evidence: `${analysis.provenance.dataSnapshotId} · ${analysis.provenance.queryIds.join(", ")}`,
  }];
}

function impactForAttention(code: string, analysis: EnergyScopeAnalysisDto): string {
  if (code === "NON_OPERATING_SHARE") {
    return analysis.offHours.status === "available"
      ? `${formatNumber(analysis.offHours.standbyKwh, 2)} kWh outside operating hours`
      : "Operating-hours fact unavailable";
  }
  if (code === "NO_DATA") return "No validated energy was included";
  return `${formatNumber(analysis.summary.usageKwh, 2)} kWh analysed in this scope`;
}

function buildOperatingMix(
  circuits: EnergyScopeAnalysisDto["circuits"],
): DecisionDashboardModel["operatingMix"] {
  const grouped = new Map<string, { operating: number; offHours: number }>();
  for (const circuit of circuits) {
    if (circuit.nonOperatingKwh === undefined) continue;
    const label = categoryLabel(circuit.category);
    const current = grouped.get(label) ?? { operating: 0, offHours: 0 };
    current.operating += Math.max(0, circuit.usageKwh - circuit.nonOperatingKwh);
    current.offHours += circuit.nonOperatingKwh;
    grouped.set(label, current);
  }
  return [...grouped.entries()]
    .map(([category, values]) => ({ category, ...values }))
    .sort((left, right) => right.offHours - left.offHours);
}

function formatCurrencyAmount(amount: number, currency: string, digits: number): string {
  const code = currency.trim().toUpperCase();
  const value = formatNumber(amount, digits);
  return code === "SGD" ? `S$${value}` : `${code} ${value}`;
}

function buildTimeProfile(
  profile: EnergyScopeAnalysisDto["hourlyProfile"],
): DecisionDashboardModel["timeProfile"] {
  const bands = [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
    { start: 8, end: 12 },
    { start: 12, end: 16 },
    { start: 16, end: 20 },
    { start: 20, end: 24 },
  ];
  return bands.map((band) => {
    const points = profile.filter((point) => point.hour >= band.start && point.hour < band.end);
    return {
      slot: `${String(band.start).padStart(2, "0")}–${String(band.end).padStart(2, "0")}`,
      average: average(points.map((point) => point.averageKw)),
      peak: Math.max(0, ...points.map((point) => point.peakKw)),
    };
  });
}

function formatPeriod(from: string, to: string): string {
  const format = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
  const start = format.format(new Date(from));
  const exclusiveEnd = new Date(new Date(to).getTime() - 1);
  return `${start}–${format.format(exclusiveEnd)}`;
}

function categoryLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "aircon") return "Aircon";
  if (normalized === "light" || normalized === "lighting") return "Lighting";
  return "Load";
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString("en-SG", { maximumFractionDigits, minimumFractionDigits: maximumFractionDigits });
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
