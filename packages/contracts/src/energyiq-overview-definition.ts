export const ENERGYIQ_OVERVIEW_DEFINITION_REVISION = "energyiq-overview-definition@1" as const;
export const ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_REVISION = "energyiq-overview-definition-change@1" as const;

export type EnergyIqOverviewBlockEmphasis = "primary" | "standard" | "supporting";

export type EnergyIqOverviewBlockDefinition = {
  key: string;
  capabilityRevisionId: string;
  windowId: string;
  emphasis: EnergyIqOverviewBlockEmphasis;
};

export type EnergyIqOverviewSectionDefinition = {
  key: string;
  title: string;
  managementQuestion: string;
  primaryWindowId: string;
  supportingWindowIds: string[];
  blocks: EnergyIqOverviewBlockDefinition[];
};

export type EnergyIqOverviewAiSlotDefinition = {
  slotId: string;
  revision: string;
  role: string;
  label: string;
  order: number;
  regionIntent: string;
  businessObjective: string;
  audience: string;
  decisionUse: string;
  presentationIntent: string[];
  skillId: string;
  skillRevision: string;
  methodId: string;
  methodRevision: string;
  contextRevision: string;
  toolPolicyRevision: string;
  outputContractRevision: string;
  validatorRevision: string;
  presentationReferenceRevision: string;
};

export type EnergyIqOverviewDefinition = {
  contractRevision: typeof ENERGYIQ_OVERVIEW_DEFINITION_REVISION;
  timePolicyRevisionId: string;
  sections: EnergyIqOverviewSectionDefinition[];
  aiSlots?: EnergyIqOverviewAiSlotDefinition[];
  /** Release-owned rollout control. `structured` is the explicit rollback. */
  aiSlotPresentationMode?: "structured" | "html";
};

export type EnergyIqOverviewDefinitionChangeProposal = {
  contractRevision: typeof ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_REVISION;
  title: string;
  rationale: string;
  desiredDefinition: EnergyIqOverviewDefinition;
};
