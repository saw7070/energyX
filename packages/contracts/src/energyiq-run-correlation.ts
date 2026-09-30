export const ENERGY_RUN_CORRELATION_CONTRACT = "energyiq-run-correlation@1" as const;

export type EnergyRunCorrelation = {
  contract: typeof ENERGY_RUN_CORRELATION_CONTRACT;
  correlation_id: string;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Parse only a cryptographically opaque UUID-v4 correlation envelope. */
export const parseEnergyRunCorrelation = (value: unknown): EnergyRunCorrelation | undefined => {
  if (!isRecord(value)
    || value.contract !== ENERGY_RUN_CORRELATION_CONTRACT
    || typeof value.correlation_id !== "string"
    || !UUID_V4.test(value.correlation_id)) return undefined;
  return {
    contract: ENERGY_RUN_CORRELATION_CONTRACT,
    correlation_id: value.correlation_id.toLowerCase(),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);
