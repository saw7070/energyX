"use client";

import React from "react";
import type { AiSlotHtmlArtifactIdentity, PreschoolHtmlAiSlotId } from "@datafoundry/contracts";

import { SandboxedAiSlotHtml } from "./sandboxed-ai-slot-html";

export type PreschoolHtmlAiSlotPresentationId = PreschoolHtmlAiSlotId;

export type PreschoolHtmlAiSlotRenderInput = {
  candidate: unknown;
  expectedIdentity: AiSlotHtmlArtifactIdentity;
  allowedEvidenceRefs: readonly string[];
  acceptance?: {
    status: "accepted" | "accepted_with_warnings";
    droppedClaims: Array<{
      blockId: string;
      reason: "unsupported-fact" | "unsupported-causal-claim" | "unsupported-evidence-ref" | "empty-structure";
    }>;
  };
};

export type PreschoolHtmlAiSlotRenderSet = Partial<Record<PreschoolHtmlAiSlotPresentationId, PreschoolHtmlAiSlotRenderInput>>;

export function PreschoolHtmlAiSlotPresentation({
  mode,
  slotId,
  htmlSlot,
  children,
}: {
  mode: "structured" | "html";
  slotId: PreschoolHtmlAiSlotPresentationId;
  htmlSlot?: PreschoolHtmlAiSlotRenderInput;
  children: React.ReactNode;
}) {
  if (mode !== "html" || !htmlSlot) return children;
  const rendered = (
    <SandboxedAiSlotHtml
      candidate={htmlSlot.candidate}
      expected={{ slotId, identity: htmlSlot.expectedIdentity }}
      allowedEvidenceRefs={htmlSlot.allowedEvidenceRefs}
      fallback={children ?? (
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status" data-ai-slot-structured-fallback="true">
          <p className="text-xs font-semibold text-foreground">No completed AI interpretation was saved for this section.</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">The deterministic Overview remains authoritative while this HTML presentation is unavailable.</p>
        </div>
      )}
      title={`${slotTitle(slotId)} AI analysis`}
    />
  );
  if (htmlSlot.acceptance?.status !== "accepted_with_warnings") return rendered;
  return (
    <div data-ai-slot-claim-warnings="true">
      <p className="mb-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-[11px] leading-5 text-muted" role="status">
        AI presentation verified against the published Overview evidence; unsupported draft text was excluded.
      </p>
      {rendered}
    </div>
  );
}

const slotTitle = (slotId: PreschoolHtmlAiSlotPresentationId): string => ({
  "executive-summary": "Executive summary",
  "centre-benchmark": "Centre benchmark",
  "standby-wastage": "Closed-hours pattern",
  "operating-behaviour": "Operating behaviour",
  "planning-outlook": "Monthly planning outlook",
  "additional-insight": "Additional insight",
})[slotId];
