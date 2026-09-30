export const ENERGY_RUN_PREPARATION_EVENT = "energy.run.preparation" as const;
export const ENERGY_RUN_PREPARATION_CONTRACT = "energyiq-run-preparation@1" as const;
export const ENERGY_RUN_LATENCY_EVENT = "energy.run.latency" as const;
export const ENERGY_RUN_LATENCY_CONTRACT = "energyiq-run-latency@1" as const;

export const ENERGY_RUN_PREPARATION_PHASES = [
  "request-accepted",
  "query-context-resolved",
  "meter-route-resolved",
  "analysis-context-package-resolved",
  "scoped-datasource-ready",
  "project-analysis-resolved",
  "run-claimed",
] as const;
export type EnergyRunPreparationPhase = typeof ENERGY_RUN_PREPARATION_PHASES[number];

export const ENERGY_RUN_LATENCY_PHASES = [
  "request-received",
  "agent-runtime-started",
  "model-request-prepared",
  "first-model-event",
  "first-model-content",
] as const;
export type EnergyRunLatencyPhase = typeof ENERGY_RUN_LATENCY_PHASES[number];

export const ENERGY_RUN_PACKAGE_STATUSES = [
  "package_hit",
  "targeted_query",
  "full_materialization_missing",
] as const;
export type EnergyRunPackageStatus = typeof ENERGY_RUN_PACKAGE_STATUSES[number];

export const isEnergyRunPreparationPhase = (value: unknown): value is EnergyRunPreparationPhase =>
  typeof value === "string" && ENERGY_RUN_PREPARATION_PHASES.includes(value as EnergyRunPreparationPhase);

export const isEnergyRunLatencyPhase = (value: unknown): value is EnergyRunLatencyPhase =>
  typeof value === "string" && ENERGY_RUN_LATENCY_PHASES.includes(value as EnergyRunLatencyPhase);

export const isEnergyRunPackageStatus = (value: unknown): value is EnergyRunPackageStatus =>
  typeof value === "string" && ENERGY_RUN_PACKAGE_STATUSES.includes(value as EnergyRunPackageStatus);
