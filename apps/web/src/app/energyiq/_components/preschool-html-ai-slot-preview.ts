import { PRESCHOOL_HTML_AI_SLOT_IDS } from "@datafoundry/contracts";
import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";

import type {
  PreschoolHtmlAiSlotPresentationId,
  PreschoolHtmlAiSlotRenderSet,
} from "./preschool-html-ai-slot-presentation";

export const PRESCHOOL_HTML_AI_SLOT_PREVIEW_PROFILE_ID = "html-slot-preview" as const;

const PREVIEW_SLOTS: readonly PreschoolHtmlAiSlotPresentationId[] = PRESCHOOL_HTML_AI_SLOT_IDS;

const previewTitle: Record<PreschoolHtmlAiSlotPresentationId, string> = {
  "executive-summary": "Executive",
  "centre-benchmark": "Centre benchmark",
  "standby-wastage": "Closed-hours",
  "operating-behaviour": "Operating behaviour",
  "planning-outlook": "Planning outlook",
  "additional-insight": "Additional Insight",
};

export function buildPreschoolHtmlAiSlotPreview(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolHtmlAiSlotRenderSet {
  const identityBase = {
    workspaceId: snapshot.context.workspaceId,
    projectId: snapshot.context.projectId,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.context.dataSnapshotId,
    projectReleaseId: snapshot.projectRelease.id,
    analysisPeriod: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    modelProfileId: PRESCHOOL_HTML_AI_SLOT_PREVIEW_PROFILE_ID,
    modelProfileRevision: 0,
    promptRevision: "preview-fixture@1",
  };
  return Object.fromEntries(PREVIEW_SLOTS.map((slotId) => {
    const identity = {
      ...identityBase,
      slotDefinitionRevision: `preview-${slotId}@1`,
    };
    const evidenceRef = `preview:${slotId}`;
    return [slotId, {
      expectedIdentity: identity,
      allowedEvidenceRefs: [evidenceRef],
      candidate: {
        contract: "energyiq-ai-slot-html-artifact@1",
        slotId,
        identity,
        evidenceRefs: [evidenceRef],
        preferredHeightPx: 220,
        html: `<article><p><mark>Preview fixture · not model output</mark></p><h2>${previewTitle[slotId]}</h2><p>Static layout preview. Replace this fixture with an explicit generated Artifact.</p><details><summary>Evidence boundary</summary><p>Only ${evidenceRef} is cited by this local preview.</p></details></article>`,
      },
    }];
  })) as PreschoolHtmlAiSlotRenderSet;
}
