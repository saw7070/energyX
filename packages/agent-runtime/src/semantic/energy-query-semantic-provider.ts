import type { AgentEnergyQueryContext } from "../types.js";
import type {
  TrustedEnergyPhysicalSchemaIdentity,
  TrustedEnergyTextQueryContract
} from "./trusted-energy-text.js";
import { SemanticProviderError, type SemanticRequest, type SemanticResolution } from "./types.js";

/**
 * Project the server-authoritative Energy Query Context into the protocol's
 * semantic boundary. It does not infer business meaning or replace DataLink;
 * it only certifies the already scoped canonical energy fact view.
 */
export class EnergyQuerySemanticProvider {
  readonly id = "energyiq" as const;

  constructor(private readonly context: AgentEnergyQueryContext | TrustedEnergyTextQueryContract) {}

  async resolve(request: SemanticRequest): Promise<SemanticResolution> {
    if (isTrustedTextContract(this.context)) {
      return resolveTrustedTextContext(this.context, request);
    }
    const context = this.context;
    return {
      value: {
        physicalSchema: request.physicalSchema,
        project: {
          id: context.projectId,
          name: context.projectName
        },
        scope: {
          id: context.scopeId,
          name: context.scopeName,
          type: context.scopeType
        },
        resource: context.resource,
        period: {
          label: context.period,
          from: context.from,
          to: context.to,
          endExclusive: true,
          timezone: context.timezone
        },
        ...(context.metricVersion ? { metricVersion: context.metricVersion } : {})
      },
      capabilities: ["physical-schema", "energy-query-context", "canonical-energy-fact"],
      trust: "authoritative",
      warnings: [],
      ...(context.dataSnapshotId ? { snapshotId: context.dataSnapshotId } : {}),
      provider: "energyiq",
      mode: "live",
      datasourceRevision: request.datasourceRevision
    };
  }
}

function isTrustedTextContract(
  context: AgentEnergyQueryContext | TrustedEnergyTextQueryContract
): context is TrustedEnergyTextQueryContract {
  return "kind" in context && context.kind === "trusted-energy-text-query";
}

const resolveTrustedTextContext = (
  contract: TrustedEnergyTextQueryContract,
  request: SemanticRequest
): SemanticResolution => {
  assertTrustedSourcePin(contract, request);
  return {
    value: {
      physicalSchema: contract.pins.sourcePin.physicalSchema,
      sourcePin: contract.pins.sourcePin,
      project: contract.pins.project,
      scope: contract.pins.scope,
      period: {
        label: contract.pins.period.label,
        from: contract.pins.period.start,
        to: contract.pins.period.endExclusive,
        endExclusive: true,
        timezone: contract.pins.period.timezone
      },
      metric: contract.pins.metric,
      supportingMetrics: contract.pins.supportingMetrics,
      dataAsOf: contract.pins.dataAsOf,
      evidenceRefs: contract.pins.evidenceRefs,
      expectedFacts: contract.pins.expectedFacts,
      trustedTextQuery: {
        id: contract.id,
        intent: contract.intent,
        selector: contract.selector
      }
    },
    capabilities: [
      "physical-schema",
      "energy-query-context",
      "canonical-energy-fact",
      "trusted-energy-text"
    ],
    trust: "authoritative",
    warnings: [],
    snapshotId: contract.pins.dataSnapshotId,
    provider: "energyiq",
    mode: "live",
    datasourceRevision: contract.pins.sourcePin.datasourceRevision
  };
};

const assertTrustedSourcePin = (
  contract: TrustedEnergyTextQueryContract,
  request: SemanticRequest
): void => {
  const pin = contract.pins.sourcePin;
  if (request.datasourceId !== pin.datasourceId) {
    throw new SemanticProviderError("TRUSTED_ENERGY_DATASOURCE_MISMATCH", false);
  }
  if (request.datasourceRevision !== pin.datasourceRevision) {
    throw new SemanticProviderError("TRUSTED_ENERGY_DATASOURCE_REVISION_MISMATCH", false);
  }
  const identity = physicalSchemaIdentity(request.physicalSchema);
  if (!identity || JSON.stringify(identity) !== JSON.stringify(pin.physicalSchema)) {
    throw new SemanticProviderError("TRUSTED_ENERGY_PHYSICAL_SCHEMA_MISMATCH", false);
  }
};

const physicalSchemaIdentity = (value: unknown): TrustedEnergyPhysicalSchemaIdentity | undefined => {
  if (!isRecord(value) || !Array.isArray(value.tables)) return undefined;
  const tables: TrustedEnergyPhysicalSchemaIdentity["tables"] = [];
  for (const table of value.tables) {
    if (!isRecord(table) || typeof table.name !== "string" || !table.name.trim()) return undefined;
    if (table.schema !== undefined && (typeof table.schema !== "string" || !table.schema.trim())) return undefined;
    tables.push({
      ...(typeof table.schema === "string" ? { schema: table.schema.trim() } : {}),
      name: table.name.trim()
    });
  }
  tables.sort((left, right) =>
    `${left.schema ?? ""}.${left.name}`.localeCompare(`${right.schema ?? ""}.${right.name}`));
  const rawSchemaId = value.schemaId ?? value.schema_id;
  if (rawSchemaId !== undefined && (typeof rawSchemaId !== "string" || !rawSchemaId.trim())) return undefined;
  return {
    ...(typeof rawSchemaId === "string" ? { schemaId: rawSchemaId.trim() } : {}),
    tables
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
