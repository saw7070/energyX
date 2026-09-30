import {
  ENERGYIQ_OVERVIEW_DEFINITION_REVISION,
  type EnergyIqOverviewBlockEmphasis,
  type EnergyIqOverviewDefinition,
  type ReportTimePolicyRevision,
} from "@datafoundry/contracts";
import { createHash } from "node:crypto";

import {
  validateAndCanonicalizeTemplateDocument,
  type EnergyIqComponentRevisionRecord,
  type EnergyIqTemplateDraftDocument,
} from "./energyiq-template-store.js";

export type CompiledEnergyIqOverviewDefinition = {
  definition: EnergyIqOverviewDefinition;
  definitionFingerprint: string;
  templateDocument: EnergyIqTemplateDraftDocument;
  diff: EnergyIqOverviewDefinitionDiffItem[];
};

export type EnergyIqOverviewDefinitionDiffItem =
  | {
      kind: "ai_slot_presentation_mode_updated";
      before: "structured" | "html";
      after: "structured" | "html";
    }
  | {
      kind: "section_added" | "section_removed";
      sectionKey: string;
      index: number;
    }
  | {
      kind: "section_order_changed";
      before: string[];
      after: string[];
    }
  | {
      kind: "section_updated";
      sectionKey: string;
      changedFields: string[];
    }
  | {
      kind: "block_updated";
      sectionKey: string;
      blockKey: string;
      changedFields: string[];
    }
  | {
      kind: "block_order_changed";
      sectionKey: string;
      before: string[];
      after: string[];
    }
  | {
      kind: "block_added" | "block_removed";
      sectionKey: string;
      blockKey: string;
      index: number;
    }
  | {
      kind: "ai_slot_added" | "ai_slot_removed";
      slotId: string;
      index: number;
    }
  | {
      kind: "ai_slot_order_changed";
      before: string[];
      after: string[];
    }
  | {
      kind: "ai_slot_updated";
      slotId: string;
      changedFields: string[];
    };

export const compileEnergyIqOverviewDefinition = (input: {
  definition: unknown;
  baseDefinition?: unknown;
  catalog: readonly EnergyIqComponentRevisionRecord[];
  reportTimePolicy: ReportTimePolicyRevision;
}): CompiledEnergyIqOverviewDefinition => {
  const parsedDefinition = canonicalizeDefinition(input.definition);
  const baseDefinition = input.baseDefinition === undefined
    ? undefined
    : canonicalizeDefinition(input.baseDefinition);
  const definition = {
    ...parsedDefinition,
    ...(parsedDefinition.aiSlots === undefined && baseDefinition?.aiSlots !== undefined
      ? { aiSlots: baseDefinition.aiSlots }
      : {}),
    ...(parsedDefinition.aiSlotPresentationMode === undefined
      && baseDefinition?.aiSlotPresentationMode !== undefined
      ? { aiSlotPresentationMode: baseDefinition.aiSlotPresentationMode }
      : {}),
  };
  assertUniqueDefinitionKeys(definition);
  const expectedPolicyRevisionId = `${input.reportTimePolicy.policyId}@${input.reportTimePolicy.revision}`;
  if (definition.timePolicyRevisionId !== expectedPolicyRevisionId) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_TIME_POLICY_MISMATCH");
  }
  const windowIds = new Set(input.reportTimePolicy.windows.map((window) => window.windowId));
  const catalogIds = new Set(input.catalog.map((capability) => capability.revision_id));
  for (const section of definition.sections) {
    if (!windowIds.has(section.primaryWindowId)
      || section.supportingWindowIds.some((windowId) => !windowIds.has(windowId))) {
      throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_WINDOW_INVALID");
    }
    for (const block of section.blocks) {
      if (!windowIds.has(block.windowId)) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_WINDOW_INVALID");
      if (!catalogIds.has(block.capabilityRevisionId)) {
        throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_CAPABILITY_INVALID");
      }
    }
  }

  const canonicalTemplate = validateAndCanonicalizeTemplateDocument({
    document: {
      templates: [
        {
          template_id: "project",
          target_kind: "project",
          sections: definition.sections.map((section) => ({
            section_id: section.key,
            title: section.title,
            navigation_label: section.title,
            description: section.managementQuestion,
          })),
          // The Overview Definition may reuse one Capability across different
          // report windows. The legacy Template document only permits one
          // placement per Component revision, so keep its first placement as
          // a compatibility projection; the immutable Definition remains the
          // complete Stage 5 rendering contract.
          components: uniqueCapabilityPlacements(definition),
        },
      ],
    },
    tier_definition_ids: [],
    catalog: input.catalog,
  });

  const blocksByKey = new Map(definition.sections.flatMap((section) =>
    section.blocks.map((block) => [block.key, block] as const)));
  const project = canonicalTemplate.templates[0]!;
  for (const placement of project.components) {
    const block = blocksByKey.get(placement.placement_id!);
    const capability = input.catalog.find((item) => item.revision_id === placement.component_revision_id);
    if (!block || !capability || !placement.presentation) continue;
    const requestedTone = toneFor(block.emphasis);
    if (capability.allowed_presentation.visuals.tones.includes(requestedTone)) {
      placement.presentation.tone = requestedTone;
    }
  }

  if (baseDefinition) assertUniqueDefinitionKeys(baseDefinition);
  return {
    definition,
    definitionFingerprint: createHash("sha256").update(JSON.stringify(definition)).digest("hex"),
    templateDocument: canonicalTemplate,
    diff: baseDefinition ? describeDefinitionChanges(baseDefinition, definition) : [],
  };
};

const uniqueCapabilityPlacements = (
  definition: EnergyIqOverviewDefinition,
): EnergyIqTemplateDraftDocument["templates"][number]["components"] => {
  const seen = new Set<string>();
  return definition.sections.flatMap((section) => section.blocks.flatMap((block) => {
    if (seen.has(block.capabilityRevisionId)) return [];
    seen.add(block.capabilityRevisionId);
    return [{
      placement_id: block.key,
      component_revision_id: block.capabilityRevisionId,
      enabled: true,
      section_id: section.key,
    }];
  }));
};

export const parseEnergyIqOverviewDefinition = (value: unknown): EnergyIqOverviewDefinition =>
  canonicalizeDefinition(value);

const describeDefinitionChanges = (
  base: EnergyIqOverviewDefinition,
  desired: EnergyIqOverviewDefinition,
): EnergyIqOverviewDefinitionDiffItem[] => {
  const diff: EnergyIqOverviewDefinitionDiffItem[] = [];
  const beforePresentationMode = base.aiSlotPresentationMode ?? "structured";
  const afterPresentationMode = desired.aiSlotPresentationMode ?? "structured";
  if (beforePresentationMode !== afterPresentationMode) {
    diff.push({
      kind: "ai_slot_presentation_mode_updated",
      before: beforePresentationMode,
      after: afterPresentationMode,
    });
  }
  const beforeSectionOrder = base.sections.map((section) => section.key);
  const afterSectionOrder = desired.sections.map((section) => section.key);
  if (sameMembers(beforeSectionOrder, afterSectionOrder)
    && JSON.stringify(beforeSectionOrder) !== JSON.stringify(afterSectionOrder)) {
    diff.push({
      kind: "section_order_changed",
      before: beforeSectionOrder,
      after: afterSectionOrder,
    });
  }
  const baseSections = new Map(base.sections.map((section) => [section.key, section]));
  const desiredSections = new Map(desired.sections.map((section) => [section.key, section]));
  for (const [sectionIndex, section] of base.sections.entries()) {
    if (!desiredSections.has(section.key)) {
      diff.push({ kind: "section_removed", sectionKey: section.key, index: sectionIndex });
    }
  }
  for (const [sectionIndex, section] of desired.sections.entries()) {
    const previous = baseSections.get(section.key);
    if (!previous) {
      diff.push({ kind: "section_added", sectionKey: section.key, index: sectionIndex });
      continue;
    }
    const sectionFields = [
      ...changed("title", previous.title, section.title),
      ...changed("managementQuestion", previous.managementQuestion, section.managementQuestion),
      ...changed("primaryWindowId", previous.primaryWindowId, section.primaryWindowId),
      ...changed(
        "supportingWindowIds",
        JSON.stringify(previous.supportingWindowIds),
        JSON.stringify(section.supportingWindowIds),
      ),
    ];
    if (sectionFields.length > 0) {
      diff.push({ kind: "section_updated", sectionKey: section.key, changedFields: sectionFields });
    }
    const previousBlocks = new Map(previous.blocks.map((block) => [block.key, block]));
    const desiredBlocks = new Map(section.blocks.map((block) => [block.key, block]));
    const beforeBlockOrder = previous.blocks.map((block) => block.key);
    const afterBlockOrder = section.blocks.map((block) => block.key);
    if (sameMembers(beforeBlockOrder, afterBlockOrder)
      && JSON.stringify(beforeBlockOrder) !== JSON.stringify(afterBlockOrder)) {
      diff.push({
        kind: "block_order_changed",
        sectionKey: section.key,
        before: beforeBlockOrder,
        after: afterBlockOrder,
      });
    }
    for (const [blockIndex, block] of previous.blocks.entries()) {
      if (!desiredBlocks.has(block.key)) {
        diff.push({
          kind: "block_removed",
          sectionKey: section.key,
          blockKey: block.key,
          index: blockIndex,
        });
      }
    }
    for (const [blockIndex, block] of section.blocks.entries()) {
      const previousBlock = previousBlocks.get(block.key);
      if (!previousBlock) {
        diff.push({
          kind: "block_added",
          sectionKey: section.key,
          blockKey: block.key,
          index: blockIndex,
        });
        continue;
      }
      const blockFields = [
        ...changed("capabilityRevisionId", previousBlock.capabilityRevisionId, block.capabilityRevisionId),
        ...changed("windowId", previousBlock.windowId, block.windowId),
        ...changed("emphasis", previousBlock.emphasis, block.emphasis),
      ];
      if (blockFields.length > 0) {
        diff.push({
          kind: "block_updated",
          sectionKey: section.key,
          blockKey: block.key,
          changedFields: blockFields,
        });
      }
    }
  }
  const beforeAiSlotOrder = (base.aiSlots ?? []).map((slot) => slot.slotId);
  const afterAiSlotOrder = (desired.aiSlots ?? []).map((slot) => slot.slotId);
  if (sameMembers(beforeAiSlotOrder, afterAiSlotOrder)
    && JSON.stringify(beforeAiSlotOrder) !== JSON.stringify(afterAiSlotOrder)) {
    diff.push({
      kind: "ai_slot_order_changed",
      before: beforeAiSlotOrder,
      after: afterAiSlotOrder,
    });
  }
  const baseAiSlots = new Map((base.aiSlots ?? []).map((slot) => [slot.slotId, slot]));
  const desiredAiSlots = new Map((desired.aiSlots ?? []).map((slot) => [slot.slotId, slot]));
  for (const [slotIndex, slot] of (base.aiSlots ?? []).entries()) {
    if (!desiredAiSlots.has(slot.slotId)) {
      diff.push({ kind: "ai_slot_removed", slotId: slot.slotId, index: slotIndex });
    }
  }
  for (const [slotIndex, slot] of (desired.aiSlots ?? []).entries()) {
    const previous = baseAiSlots.get(slot.slotId);
    if (!previous) {
      diff.push({ kind: "ai_slot_added", slotId: slot.slotId, index: slotIndex });
      continue;
    }
    const changedFields = [
      ...changed("revision", previous.revision, slot.revision),
      ...changed("role", previous.role, slot.role),
      ...changed("label", previous.label, slot.label),
      ...changed("order", JSON.stringify(previous.order), JSON.stringify(slot.order)),
      ...changed("regionIntent", previous.regionIntent, slot.regionIntent),
      ...changed("businessObjective", previous.businessObjective, slot.businessObjective),
      ...changed("audience", previous.audience, slot.audience),
      ...changed("decisionUse", previous.decisionUse, slot.decisionUse),
      ...changed("presentationIntent", JSON.stringify(previous.presentationIntent), JSON.stringify(slot.presentationIntent)),
      ...changed("skillId", previous.skillId, slot.skillId),
      ...changed("skillRevision", previous.skillRevision, slot.skillRevision),
      ...changed("methodId", previous.methodId, slot.methodId),
      ...changed("methodRevision", previous.methodRevision, slot.methodRevision),
      ...changed("contextRevision", previous.contextRevision, slot.contextRevision),
      ...changed("toolPolicyRevision", previous.toolPolicyRevision, slot.toolPolicyRevision),
      ...changed("outputContractRevision", previous.outputContractRevision, slot.outputContractRevision),
      ...changed("validatorRevision", previous.validatorRevision, slot.validatorRevision),
      ...changed("presentationReferenceRevision", previous.presentationReferenceRevision, slot.presentationReferenceRevision),
    ];
    if (changedFields.length > 0) diff.push({ kind: "ai_slot_updated", slotId: slot.slotId, changedFields });
  }
  return diff;
};

const changed = (field: string, before: string, after: string): string[] => before === after ? [] : [field];

const sameMembers = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

const assertUniqueDefinitionKeys = (definition: EnergyIqOverviewDefinition): void => {
  const sectionKeys = new Set<string>();
  const blockKeys = new Set<string>();
  for (const section of definition.sections) {
    if (sectionKeys.has(section.key)) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_KEY_DUPLICATE");
    sectionKeys.add(section.key);
    for (const block of section.blocks) {
      if (blockKeys.has(block.key)) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_KEY_DUPLICATE");
      blockKeys.add(block.key);
    }
  }
  const slotIds = new Set<string>();
  const slotRevisions = new Set<string>();
  const slotOrders = new Set<number>();
  for (const slot of definition.aiSlots ?? []) {
    if (slotIds.has(slot.slotId) || slotRevisions.has(slot.revision) || slotOrders.has(slot.order)) {
      throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_KEY_DUPLICATE");
    }
    slotIds.add(slot.slotId);
    slotRevisions.add(slot.revision);
    slotOrders.add(slot.order);
  }
};

const canonicalizeDefinition = (value: unknown): EnergyIqOverviewDefinition => {
  const record = requireRecord(value);
  requireExactKeys(record, ["contractRevision", "timePolicyRevisionId", "sections"], ["aiSlots", "aiSlotPresentationMode"]);
  if (record.contractRevision !== ENERGYIQ_OVERVIEW_DEFINITION_REVISION) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_CONTRACT_INVALID");
  }
  if (!Array.isArray(record.sections) || record.sections.length === 0) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_SECTIONS_INVALID");
  }
  const aiSlots = record.aiSlots === undefined
    ? undefined
    : canonicalizeAiSlots(record.aiSlots);
  const aiSlotPresentationMode = record.aiSlotPresentationMode === undefined
    ? undefined
    : requireAiSlotPresentationMode(record.aiSlotPresentationMode);
  return {
    contractRevision: ENERGYIQ_OVERVIEW_DEFINITION_REVISION,
    timePolicyRevisionId: requireText(record.timePolicyRevisionId),
    sections: record.sections.map((sectionValue) => {
      const section = requireRecord(sectionValue);
      requireExactKeys(
        section,
        ["key", "title", "managementQuestion", "primaryWindowId", "blocks"],
        ["supportingWindowIds"],
      );
      const primaryWindowId = requireText(section.primaryWindowId);
      if (!Array.isArray(section.blocks) || section.blocks.length === 0) {
        throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_BLOCKS_INVALID");
      }
      return {
        key: requireKey(section.key),
        title: requireText(section.title),
        managementQuestion: requireText(section.managementQuestion),
        primaryWindowId,
        supportingWindowIds: Array.isArray(section.supportingWindowIds)
          ? section.supportingWindowIds.map(requireText)
          : [],
        blocks: section.blocks.map((blockValue) => {
          const block = requireRecord(blockValue);
          requireExactKeys(block, ["key", "capabilityRevisionId"], ["windowId", "emphasis"]);
          return {
            key: requireKey(block.key),
            capabilityRevisionId: requireText(block.capabilityRevisionId),
            windowId: block.windowId === undefined ? primaryWindowId : requireText(block.windowId),
            emphasis: requireEmphasis(block.emphasis),
          };
        }),
      };
    }),
    ...(aiSlots === undefined ? {} : { aiSlots }),
    ...(aiSlotPresentationMode === undefined ? {} : { aiSlotPresentationMode }),
  };
};

const requireAiSlotPresentationMode = (value: unknown): "structured" | "html" => {
  if (value !== "structured" && value !== "html") {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_AI_PRESENTATION_MODE_INVALID");
  }
  return value;
};

const canonicalizeAiSlots = (value: unknown): EnergyIqOverviewDefinition["aiSlots"] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_AI_SLOTS_INVALID");
  }
  return value.map((slotValue) => {
    const slot = requireRecord(slotValue);
    requireExactKeys(slot, [
      "slotId", "revision", "role", "label", "order", "regionIntent",
      "businessObjective", "audience", "decisionUse", "presentationIntent",
    ], [
      "skillId", "skillRevision", "methodId", "methodRevision", "contextRevision",
      "toolPolicyRevision", "outputContractRevision", "validatorRevision", "presentationReferenceRevision",
    ]);
    const order = typeof slot.order === "number" ? slot.order : NaN;
    if (!Number.isInteger(order) || order < 0
      || !Array.isArray(slot.presentationIntent) || slot.presentationIntent.length === 0) {
      throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_AI_SLOTS_INVALID");
    }
    return {
      slotId: requireKey(slot.slotId),
      revision: requireText(slot.revision),
      role: requireText(slot.role),
      label: requireText(slot.label),
      order,
      regionIntent: requireText(slot.regionIntent),
      businessObjective: requireText(slot.businessObjective),
      audience: requireText(slot.audience),
      decisionUse: requireText(slot.decisionUse),
      presentationIntent: slot.presentationIntent.map(requireText),
      skillId: requireOptionalText(slot.skillId, "energyiq-evidence-first"),
      skillRevision: requireOptionalText(slot.skillRevision, "1"),
      methodId: requireOptionalText(slot.methodId, "energyiq-overview-slot-method"),
      methodRevision: requireOptionalText(slot.methodRevision, "1"),
      contextRevision: requireOptionalText(slot.contextRevision, "energyiq-overview-context@1"),
      toolPolicyRevision: requireOptionalText(slot.toolPolicyRevision, "none@1"),
      outputContractRevision: requireOptionalText(slot.outputContractRevision, "energyiq-overview-slot@1"),
      validatorRevision: requireOptionalText(slot.validatorRevision, "energyiq-overview-slot@1"),
      presentationReferenceRevision: requireOptionalText(slot.presentationReferenceRevision, "energyiq-overview-slot@1"),
    };
  });
};

const requireExactKeys = (
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in record)) || Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_FIELD_UNKNOWN");
  }
};

const requireRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_INVALID");
  }
  return value as Record<string, unknown>;
};

const requireText = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_TEXT_INVALID");
  const normalized = value.trim();
  if (/[<>]/u.test(normalized)) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_TEXT_INVALID");
  return normalized;
};

const requireOptionalText = (value: unknown, fallback: string): string =>
  value === undefined ? fallback : requireText(value);

const requireKey = (value: unknown): string => {
  const key = requireText(value);
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(key)) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_KEY_INVALID");
  }
  return key;
};

const requireEmphasis = (value: unknown): EnergyIqOverviewBlockEmphasis => {
  if (value === undefined) return "standard";
  if (value === "primary" || value === "standard" || value === "supporting") return value;
  throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_EMPHASIS_INVALID");
};

const toneFor = (emphasis: EnergyIqOverviewBlockEmphasis): "highlight" | "default" | "quiet" => {
  if (emphasis === "primary") return "highlight";
  if (emphasis === "supporting") return "quiet";
  return "default";
};
