"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1 } from "@datafoundry/contracts";

import type {
  EnergyProjectAnalysisSnapshotDto,
  PreschoolExecutiveSynthesisResultDto,
  PreschoolOverviewAiBindingDto,
  PreschoolOverviewAiReadModelDto,
  PreschoolOverviewAiSectionIdDto,
  PreschoolOverviewAiUnitStatusDto,
  PreschoolSectionInterpretationResultDto,
} from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import {
  buildPreschoolAiArtifactReadInput,
  getOrStartPreschoolAiRun,
  isPendingPreschoolSectionedReadModel,
  type PreschoolAiFinding,
  type PreschoolAiLegacyRunResult,
  type PreschoolAiProgress,
  type PreschoolAiArtifactReadInput,
  type PreschoolAiRunResult,
  type PreschoolAiSectionId,
} from "./preschool-ai-run";
import type {
  PreschoolAiAcceptedArtifact,
  PreschoolAiAcceptedFinding,
  PreschoolAiEpistemicLevel,
} from "./preschool-ai-artifact";
import { AiFindingPresentationView } from "./ai-finding-presentation-view";
import {
  PreschoolAdditionalAiInsights,
  type PreschoolAdditionalFeedbackClient,
  type PreschoolAdditionalMethodProposalClient,
} from "./preschool-additional-ai-insights";
import { SafeAiMarkdown } from "./safe-ai-markdown";

type ProgressCallback = (progress: PreschoolAiProgress) => void;
type Settled = { identityKey: string; result: PreschoolAiRunResult };
type PreschoolSectionInterpretationV3Result = Extract<PreschoolSectionInterpretationResultDto, { keyPoints: unknown[] }>;
type PreschoolSectionInterpretationV4Result = Extract<PreschoolSectionInterpretationResultDto, { insights: unknown[] }>;
type PreschoolSectionInterpretationV4AvailableResult = Extract<PreschoolSectionInterpretationV4Result, { status: "available" }>;
type PreschoolExecutiveSynthesisV3Result = Extract<PreschoolExecutiveSynthesisResultDto, { keyFindings: unknown[] }>;
type PreschoolExecutiveSynthesisV4Result = Extract<PreschoolExecutiveSynthesisResultDto, { findings: unknown[] }>;
type PreschoolExecutiveSynthesisV4AvailableResult = Extract<PreschoolExecutiveSynthesisV4Result, { status: "available" }>;

export function PreschoolAiSlot({
  snapshot,
  sectionId = "page-synthesis",
  aiAnalystHref,
  mode = "live",
  savedResult,
  liveResult,
  onResult,
  onCompletedResult,
  startRun = getOrStartPreschoolAiRun,
  additionalFeedbackClient,
  additionalMethodProposalClient,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  sectionId?: PreschoolAiSectionId;
  aiAnalystHref?: string;
  mode?: "live" | "saved";
  savedResult?: Extract<PreschoolAiRunResult, { status: "available" }>;
  liveResult?: PreschoolAiRunResult;
  onResult?: (result: PreschoolAiRunResult) => void;
  onCompletedResult?: (result: Extract<PreschoolAiRunResult, { status: "available" }>) => void;
  startRun?: (input: PreschoolAiArtifactReadInput, onProgress?: ProgressCallback) => Promise<PreschoolAiRunResult>;
  additionalFeedbackClient?: PreschoolAdditionalFeedbackClient;
  additionalMethodProposalClient?: PreschoolAdditionalMethodProposalClient;
}) {
  const input = useMemo(() => buildPreschoolAiArtifactReadInput(snapshot), [snapshot]);
  const inputRef = useRef(input);
  const startRunRef = useRef(startRun);
  const onResultRef = useRef(onResult);
  const onCompletedResultRef = useRef(onCompletedResult);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [progress, setProgress] = useState<{ identityKey: string; stage: PreschoolAiProgress } | null>(null);
  inputRef.current = input;
  startRunRef.current = startRun;
  onResultRef.current = onResult;
  onCompletedResultRef.current = onCompletedResult;

  useEffect(() => {
    if (mode === "saved") return;
    if (!input) return;
    const currentInput = inputRef.current;
    if (!currentInput) return;
    const identityKey = currentInput.identityKey;
    let active = true;
    void startRunRef.current(currentInput, (stage) => {
      if (active) setProgress({ identityKey, stage });
    }).then((result) => {
      if (active) {
        setSettled({ identityKey, result });
        onResultRef.current?.(result);
      }
    }).catch(() => {
      if (active) {
        const result = { status: "unavailable", reason: "AI analysis is temporarily unavailable." } as const;
        setSettled({ identityKey, result });
        onResultRef.current?.(result);
      }
    });
    return () => { active = false; };
  }, [input?.identityKey, mode]);

  const completedResult = mode === "live"
    ? liveResult ?? (input && settled?.identityKey === input.identityKey ? settled.result : undefined)
    : undefined;
  useEffect(() => {
    if (completedResult?.status === "available"
      && !isPendingPreschoolSectionedReadModel(completedResult)
      && isAvailableResultRenderableForSlot(completedResult, snapshot, sectionId, "live")) {
      onCompletedResultRef.current?.(completedResult);
    }
  }, [completedResult, sectionId, snapshot]);

  if (mode === "saved" && !savedResult) {
    return (
      <AiFrame sectionId={sectionId}>
        <Unavailable detail="No completed AI result was attached when this analysis was saved. Opening a saved result never starts a new AI run." />
      </AiFrame>
    );
  }

  if (!input) return sectionId === "page-synthesis"
    ? <AiFrame sectionId={sectionId}><Unavailable detail="AI analysis needs one complete, release-pinned Preschool Snapshot." /></AiFrame>
    : null;
  const displayedResult = mode === "saved"
    ? savedResult
    : liveResult ?? (settled?.identityKey === input.identityKey
      ? settled.result
      : null);
  if (!displayedResult) {
    if (sectionId !== "page-synthesis") return null;
    const stage = progress?.identityKey === input.identityKey ? progress.stage : "queued";
    return (
      <AiFrame sectionId={sectionId}>
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 animate-pulse items-center justify-center rounded-full bg-primary/10 text-primary motion-reduce:animate-none">
              <EnergyIcon name="spark" className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-foreground">{progressLabel(stage)}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                The deterministic Overview is ready. The AI energy analyst is inspecting this pinned Preschool Snapshot in the background.
              </p>
            </div>
          </div>
        </div>
      </AiFrame>
    );
  }
  if (displayedResult.status === "unavailable") return sectionId === "page-synthesis"
    ? <AiFrame sectionId={sectionId}><Unavailable detail={displayedResult.reason} /></AiFrame>
    : null;
  const availableResult = displayedResult;
  if (hasSectionedReadModelArtifactKind(availableResult)) {
    if (!isPreschoolOverviewAiReadModelRenderable(availableResult, snapshot, mode)) {
      if (sectionId === "overall-summary") return null;
      return (
        <AiFrame sectionId={sectionId}>
          <Unavailable detail={invalidReadModelDetail(mode)} />
        </AiFrame>
      );
    }
    return (
      <SectionedAiResult
        result={availableResult}
        snapshot={snapshot}
        sectionId={sectionId}
        mode={mode}
        aiAnalystHref={aiAnalystHref}
        additionalFeedbackClient={additionalFeedbackClient}
        additionalMethodProposalClient={additionalMethodProposalClient}
      />
    );
  }
  const consumableResult = autonomousAvailableResult(availableResult);
  if (!consumableResult) {
    if (sectionId !== "page-synthesis") return null;
    return (
      <AiFrame sectionId={sectionId}>
        <Unavailable detail={invalidResultDetail(mode, "Legacy AI result")} />
      </AiFrame>
    );
  }
  const sectionFindings = consumableResult.findings.filter((finding) => findingMatchesSection(finding, sectionId));
  if (sectionFindings.length === 0) {
    if (sectionId !== "page-synthesis") return null;
    return (
      <AiFrame sectionId={sectionId}>
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">
            {consumableResult.findings.length > 0 ? "Section interpretations ready" : "No additional Evidence-backed candidates"}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            {consumableResult.findings.length > 0
              ? "The accepted AI findings are shown beside the analysis sections they explain."
              : "The energy advisor did not find a distinct angle worth adding to the verified signals for this Snapshot."}
          </p>
        </div>
        {mode === "saved" ? (
          <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
            Saved AI result · Run {consumableResult.runId}
          </p>
        ) : null}
      </AiFrame>
    );
  }
  return (
    <AiFrame sectionId={sectionId}>
      <div
        className="space-y-4"
        aria-label="Preschool AI energy analyst findings"
      >
        {sectionFindings.map((finding) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            pack={`${consumableResult.packId}@${consumableResult.packRevision}`}
            projectId={input.projectId}
            aiAnalystHref={aiAnalystHref}
          />
        ))}
      </div>
      {mode === "saved" ? (
        <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
          Saved AI result · Run {consumableResult.runId}
        </p>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-muted-light">
        AI suggestions are based on this pinned Snapshot. Verified KPIs and Evidence remain authoritative.
      </p>
    </AiFrame>
  );
}

function SectionedAiResult({
  result,
  snapshot,
  sectionId,
  mode,
  aiAnalystHref,
  additionalFeedbackClient,
  additionalMethodProposalClient,
}: {
  result: PreschoolOverviewAiReadModelDto;
  snapshot: EnergyProjectAnalysisSnapshotDto;
  sectionId: PreschoolAiSectionId;
  mode: "live" | "saved";
  aiAnalystHref?: string;
  additionalFeedbackClient?: PreschoolAdditionalFeedbackClient;
  additionalMethodProposalClient?: PreschoolAdditionalMethodProposalClient;
}) {
  if (sectionId === "page-synthesis") {
    const lineage = buildExecutiveLineage(result, mode);
    const executiveRenderable = isRenderableExecutiveUnit(result.executive, result.binding, mode)
      && executiveUnitLineageIsValid(result.executive, lineage);
    const legacyHeading = mode === "saved"
      && executiveRenderable
      && (result.executive.status === "available" || result.executive.status === "empty")
      && isV3ExecutiveResult(result.executive.result, result.executive.status);
    return (
      <AiFrame sectionId={sectionId} pageSynthesisVersion={legacyHeading ? "v3" : "v4"}>
        <ExecutiveUnit
          unit={result.executive}
          mode={mode}
          completedSectionCount={completedSectionCount(result)}
          outerBinding={result.binding}
          lineage={lineage}
        />
        <SavedRunMarker mode={mode} unit={result.executive} isRenderable={executiveRenderable} />
      </AiFrame>
    );
  }
  if (sectionId === "overall-summary") {
    if (Object.prototype.hasOwnProperty.call(result, "additional")) {
      return (
        <PreschoolAdditionalAiInsights
          unit={result.additional}
          outerBinding={result.binding}
          mode={mode}
          feedbackClient={additionalFeedbackClient}
          methodProposalClient={additionalMethodProposalClient}
        />
      );
    }
    if (mode === "live") {
      return (
        <PreschoolAdditionalAiInsights
          unit={undefined}
          outerBinding={result.binding}
          mode={mode}
        />
      );
    }
    const autonomous = autonomousAvailableResult(result.autonomous);
    if (!autonomous || autonomous.findings.length === 0) return null;
    return (
      <AiFrame sectionId={sectionId}>
        <p className="mb-5 max-w-[75ch] text-sm leading-6 text-muted">
          Distinct Evidence-backed angles that sit outside the structured Section summaries.
        </p>
        <div className="space-y-4" aria-label="Additional AI energy insights">
          {autonomous.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              pack={`${autonomous.packId}@${autonomous.packRevision}`}
              projectId={result.binding.projectId}
              aiAnalystHref={aiAnalystHref}
            />
          ))}
        </div>
        {mode === "saved" ? (
          <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
            Saved AI result · Run {autonomous.runId}
          </p>
        ) : null}
      </AiFrame>
    );
  }
  const target = sectionIdToValueTarget(sectionId);
  if (!target) return null;
  const unit = result.sections[target];
  const unitRenderable = isRenderableSectionUnit(unit, target, result.binding, mode);
  return (
    <AiFrame sectionId={sectionId}>
      <SectionUnit
        unit={unit}
        expectedSectionId={target}
        outerBinding={result.binding}
        snapshot={snapshot}
        mode={mode}
        aiAnalystHref={aiAnalystHref}
      />
      <SavedRunMarker mode={mode} unit={unit} isRenderable={unitRenderable} />
    </AiFrame>
  );
}

function ExecutiveUnit({
  unit,
  mode,
  completedSectionCount,
  outerBinding,
  lineage,
}: {
  unit: unknown;
  mode: "live" | "saved";
  completedSectionCount: number;
  outerBinding: PreschoolOverviewAiBindingDto;
  lineage: ExecutiveLineage;
}) {
  const coverage = <p className="mb-3 text-xs font-medium text-muted">Reviewed {completedSectionCount} of 4 sections</p>;
  if (!isRenderableExecutiveUnit(unit, outerBinding, mode) || !executiveUnitLineageIsValid(unit, lineage)) {
    return <Unavailable detail={invalidResultDetail(mode, "Key Findings")} />;
  }
  if (unit.status === "queued" || unit.status === "running") {
    return <>{coverage}<PendingValue detail="The Executive Summary is being composed from completed Section interpretations." /></>;
  }
  if (unit.status === "unavailable") {
    return <>{coverage}<Unavailable detail="The Executive Summary is unavailable. Completed Section interpretations remain visible below." /></>;
  }
  if (unit.status === "empty") {
    return isV4ExecutiveResult(unit.result, "empty")
      ? <>{coverage}<EmptyValue title="No additional Key Findings" detail="The accepted Sections did not support a distinct cross-section theme for this Snapshot." /></>
      : <>{coverage}<EmptyValue title="No additional Executive Summary finding" detail="The accepted Sections did not support a distinct cross-section message for this Snapshot." /></>;
  }
  if (isV4ExecutiveResult(unit.result, "available")) {
    return <KeyFindingsUnit result={unit.result} completedSectionCount={completedSectionCount} />;
  }
  return (
    <div>
      <p className="mb-3 text-xs font-medium text-muted">Based on {Math.min(unit.result.sourceSectionArtifactIds.length || completedSectionCount, 4)} of 4 sections</p>
      <ol className="divide-y divide-border" aria-label="AI management priorities">
        {unit.result.keyFindings.map((finding) => (
          <li key={finding.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
              <EnergyIcon name="arrow" className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 max-w-[75ch]">
              <SafeAiMarkdown className="text-sm leading-6 text-foreground" children={finding.takeaway} />
              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] font-semibold text-muted">Source Sections and Evidence</summary>
                <p className="mt-1 break-words font-mono text-[10px] leading-4 text-muted-light">
                  {finding.sectionIds.join(" / ")} · {finding.evidenceRefs.join(" / ")}
                </p>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function KeyFindingsUnit({
  result,
  completedSectionCount,
}: {
  result: PreschoolExecutiveSynthesisV4AvailableResult;
  completedSectionCount: number;
}) {
  const summaryDuplicatesFinding = result.findings.some((finding) => (
    normalizedAiHeadline(result.summary.text) === normalizedAiHeadline(finding.title)
  ));
  return (
    <div>
      <p className="mb-3 text-xs font-medium text-muted">
        Reviewed {completedSectionCount} of 4 Sections · Findings cite {result.sourceSectionArtifactIds.length} source {result.sourceSectionArtifactIds.length === 1 ? "Section" : "Sections"}
      </p>
      {summaryDuplicatesFinding ? null : (
        <div className="rounded-lg border border-primary/15 bg-primary/[0.04] px-4 py-3" aria-label="Key findings summary">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-primary">Summary</p>
          <SafeAiMarkdown className="max-w-[75ch] text-base leading-7 text-foreground" children={result.summary.text} />
        </div>
      )}
      {result.findings.length > 0 ? (
        <div className={`mt-4 grid gap-3 ${result.findings.length > 1 ? "lg:grid-cols-2" : ""}`} aria-label="Key Findings" data-key-findings-grid="true">
          {result.findings.map((finding) => (
            <article key={finding.id} className="rounded-xl border border-border bg-surface px-4 py-4 lg:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h4 className="max-w-[62ch] text-base font-semibold leading-6 text-foreground">{finding.title}</h4>
                {finding.alert ? (
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${finding.alert.severity === "urgent" ? "bg-step-error-soft text-step-error" : "bg-step-warning-soft text-step-warning"}`}>
                    {finding.alert.severity} · {finding.alert.certainty}
                  </span>
                ) : null}
              </div>
              <details className="mt-3 border-t border-border pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                  Read full finding
                </summary>
                <SafeAiMarkdown className="mt-3 max-w-[75ch] text-sm leading-6 text-foreground" children={finding.text} />
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs font-semibold text-muted">Sources and Evidence</p>
                  <p className="mt-2 break-words font-mono text-[10px] leading-4 text-muted-light">
                    {finding.sectionIds.join(" / ")} · {finding.evidenceRefs.join(" / ")}
                  </p>
                  <p className="mt-3 text-xs leading-5 text-muted">For the next evidence check, open a related Section insight.</p>
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : null}
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Source Artifacts</summary>
        <p className="mt-2 break-words font-mono text-[10px] leading-4 text-muted-light">{result.sourceSectionArtifactIds.join(" / ")}</p>
      </details>
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Summary Evidence</summary>
        <p className="mt-2 break-words font-mono text-[10px] leading-4 text-muted-light">{result.summary.evidenceRefs.join(" / ")}</p>
      </details>
    </div>
  );
}

function SectionUnit({
  unit,
  expectedSectionId,
  outerBinding,
  snapshot,
  mode,
  aiAnalystHref,
}: {
  unit: unknown;
  expectedSectionId: PreschoolOverviewAiSectionIdDto;
  outerBinding: PreschoolOverviewAiBindingDto;
  snapshot: EnergyProjectAnalysisSnapshotDto;
  mode: "live" | "saved";
  aiAnalystHref?: string;
}) {
  if (!isRenderableSectionUnit(unit, expectedSectionId, outerBinding, mode)) {
    return <Unavailable detail={invalidResultDetail(mode, "Section interpretation")} />;
  }
  if (unit.status === "queued" || unit.status === "running") {
    return <PendingValue detail="This Section interpretation is being prepared from its verified Section Pack." />;
  }
  if (unit.status === "unavailable") {
    return <Unavailable detail="This Section interpretation is unavailable. Other Sections and the verified Overview are unchanged." />;
  }
  if (unit.status === "empty") {
    const planningReviewDetail = expectedSectionId === "planning-outlook"
      ? planningHonestEmptyDetail(snapshot)
      : null;
    return (
      <>
        <EmptyValue
          title={planningReviewDetail ? "AI review complete" : "No additional AI interpretation"}
          detail={planningReviewDetail ?? "This Section Pack did not support a useful additional conclusion."}
        />
        {unit.result.limitation ? (
          <details className="mt-3 border-t border-border pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Limitation</summary>
            <SafeAiMarkdown className="mt-2 text-xs leading-5 text-muted" children={unit.result.limitation} />
          </details>
        ) : null}
      </>
    );
  }
  if (isV4SectionResult(unit.result, "available")) {
    return (
      <SectionInterpretationV4Unit
        artifactId={unit.artifactId}
        result={unit.result}
        reportTimeContext={snapshot.reportTimeContext}
        aiAnalystHref={aiAnalystHref}
      />
    );
  }
  return (
    <div>
      <div className="border-b border-primary/15 pb-4" data-ai-takeaway="true">
        <div className="flex items-center gap-2 text-primary">
          <EnergyIcon name="spark" className="h-3.5 w-3.5" />
          <p className="text-xs font-semibold">AI takeaway</p>
        </div>
        {unit.result.summary ? (
          <SafeAiMarkdown className="mt-2 max-w-[75ch] text-base leading-7 text-foreground" children={unit.result.summary} />
        ) : null}
      </div>
      <ul className="divide-y divide-border">
        {unit.result.keyPoints.map((point, index) => (
          <li key={`${point.kind}-${index}`} className="flex gap-3 py-4" data-ai-point-role={point.kind}>
            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${sectionPointMeta[point.kind].tone}`}>
              <EnergyIcon name={sectionPointMeta[point.kind].icon} className="h-4 w-4" />
            </span>
            <div className="min-w-0 max-w-[75ch]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${sectionPointMeta[point.kind].tone}`}>
                  {sectionPointMeta[point.kind].label}
                </span>
                {point.label ? <p className="text-sm font-semibold text-foreground">{point.label}</p> : null}
              </div>
              <SafeAiMarkdown className="mt-1 text-sm leading-6 text-foreground" children={point.text} />
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[10px] font-medium text-muted">Evidence references</summary>
                <p className="mt-1 break-words font-mono text-[10px] leading-4 text-muted-light">{point.evidenceRefs.join(" / ")}</p>
              </details>
            </div>
          </li>
        ))}
      </ul>
      {unit.result.limitation ? (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Limitation</summary>
          <SafeAiMarkdown className="mt-1 text-xs leading-5 text-muted" children={unit.result.limitation} />
        </details>
      ) : null}
    </div>
  );
}

function SectionInterpretationV4Unit({
  artifactId,
  result,
  reportTimeContext,
  aiAnalystHref,
}: {
  artifactId: string;
  result: PreschoolSectionInterpretationV4AvailableResult;
  reportTimeContext?: EnergyProjectAnalysisSnapshotDto["reportTimeContext"];
  aiAnalystHref?: string;
}) {
  return (
    <div>
      <div className="rounded-lg border border-border bg-surface px-3 py-2.5" aria-label="Section summary">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-primary">Summary</p>
        <SafeAiMarkdown className="w-full text-base leading-7 text-foreground" children={result.summary.text} />
      </div>
      {result.insights.length > 0 ? (
        <section className="mt-4" aria-label="Section insights">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-primary">Insights</p>
          <div className={`grid gap-3 ${result.insights.length > 1 ? "lg:grid-cols-2" : ""}`} aria-label="Section AI insights">
          {result.insights.map((insight) => {
            const exploreHref = insight.deepDiveQuestion && aiAnalystHref
              ? buildSectionInsightHref(aiAnalystHref, artifactId, result, insight, reportTimeContext)
              : null;
            return (
              <article key={insight.id} className="rounded-xl border border-primary/15 bg-surface px-4 py-4 lg:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {insight.label ? <p className="mb-1 text-xs font-medium text-muted">{insight.label}</p> : null}
                    <h4 className="max-w-[62ch] text-base font-semibold leading-6 text-foreground">{insight.title}</h4>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${sectionInsightStatusMeta[insight.epistemicStatus].tone}`}>
                    {sectionInsightStatusMeta[insight.epistemicStatus].label}
                  </span>
                </div>
                <details className="mt-3 border-t border-border pt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                    Read full insight
                  </summary>
                  <SafeAiMarkdown className="mt-3 max-w-[75ch] text-sm leading-6 text-foreground" children={insight.text} />
                  {insight.deepDiveQuestion ? (
                    <div className="mt-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-muted">Question to verify</p>
                      <p className="mt-1 text-sm leading-6 text-foreground">{insight.deepDiveQuestion}</p>
                    </div>
                  ) : null}
                  {result.limitation ? (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold text-muted">Limitation</p>
                      <SafeAiMarkdown className="mt-1 text-xs leading-5 text-muted" children={result.limitation} />
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-muted">Evidence</p>
                      <p className="mt-2 break-words font-mono text-[10px] leading-4 text-muted-light">{insight.evidenceRefs.join(" / ")}</p>
                    </div>
                    {exploreHref ? (
                      <a href={exploreHref} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2">
                        Explore with the advisor <EnergyIcon name="arrow" className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </details>
              </article>
            );
          })}
          </div>
        </section>
      ) : null}
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Summary Evidence and limitation</summary>
        <p className="mt-2 break-words font-mono text-[10px] leading-4 text-muted-light">{result.summary.evidenceRefs.join(" / ")}</p>
        {result.limitation ? <SafeAiMarkdown className="mt-2 text-xs leading-5 text-muted" children={result.limitation} /> : null}
      </details>
    </div>
  );
}

function PendingValue({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3" role="status">
      <p className="text-xs font-semibold text-foreground">AI interpretation in progress</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
    </div>
  );
}

function EmptyValue({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3" role="status">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
    </div>
  );
}

const normalizedAiHeadline = (value: string): string => (value
  .replaceAll(/[*_`]/gu, "")
  .toLocaleLowerCase("en")
  .match(/[\p{L}\p{N}]+/gu) ?? [])
  .join(" ");

const planningHonestEmptyDetail = (snapshot: EnergyProjectAnalysisSnapshotDto): string => {
  const lifecycle = snapshot.preschoolPlanningLifecycle;
  if (lifecycle?.status === "unavailable") {
    return `AI reviewed the pinned planning inputs. ${lifecycle.reason.message}`;
  }
  if (lifecycle?.status === "available" && lifecycle.actual.completeDayCount === 0) {
    return "AI reviewed the pinned planning inputs. Current Actual has no complete day yet, so no additional comparison was published.";
  }
  const operational = snapshot.preschoolOperational;
  if (operational?.status === "available" && operational.planningOutlook.status === "unavailable") {
    return `AI reviewed the pinned planning inputs. ${operational.planningOutlook.reason.message}`;
  }
  return "AI reviewed the pinned planning inputs, but the current Actual and Planning Baseline did not support a distinct additional conclusion.";
};

function SavedRunMarker({
  mode,
  unit,
  isRenderable,
}: {
  mode: "live" | "saved";
  unit: unknown;
  isRenderable: boolean;
}) {
  if (!isRenderable || !isRecord(unit) || mode !== "saved" || (unit.status !== "available" && unit.status !== "empty")) return null;
  if (!isRecord(unit.result)) return null;
  const runId = unit.result.runId;
  if (!isNonEmptyString(runId)) return null;
  return (
    <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
      Saved AI result · Run {runId}
    </p>
  );
}

export const isPreschoolOverviewAiReadModelRenderable = (
  value: unknown,
  snapshot: EnergyProjectAnalysisSnapshotDto,
  _mode: "live" | "saved",
): value is PreschoolOverviewAiReadModelDto => {
  if (!hasSectionedReadModelArtifactKind(value)
    || value.status !== "available"
    || !isValidBinding(value.binding)
    || !isRecord(value.sections)
    || !isRecord(value.executive)) return false;
  const readModel = value as unknown as PreschoolOverviewAiReadModelDto;
  if (!requiredSectionIds.every((sectionId) => Object.prototype.hasOwnProperty.call(readModel.sections, sectionId))) return false;
  if (!bindingMatchesSnapshot(readModel.binding, snapshot)) return false;
  return true;
};

export const isPreschoolSavedAiArtifactIdentityMatch = (
  value: unknown,
  snapshot: EnergyProjectAnalysisSnapshotDto,
): value is { snapshotId: string; projectReleaseId: string } =>
  isRecord(value)
  && value.snapshotId === snapshot.dataSnapshot.id
  && value.projectReleaseId === snapshot.projectRelease.id;

const hasSectionedReadModelArtifactKind = (
  value: unknown,
): value is Record<string, unknown> & { artifactKind: "preschool-overview-ai-read-model" } =>
  isRecord(value) && value.artifactKind === "preschool-overview-ai-read-model";

const requiredSectionIds = [
  "centre-benchmark",
  "standby-wastage",
  "operating-behaviour",
  "planning-outlook",
] as const satisfies readonly PreschoolOverviewAiSectionIdDto[];

const bindingMatchesSnapshot = (
  binding: PreschoolOverviewAiBindingDto,
  snapshot: EnergyProjectAnalysisSnapshotDto,
): boolean => binding.workspaceId === snapshot.context.workspaceId
  && binding.projectId === snapshot.context.projectId
  && binding.scopeId === snapshot.context.scopeId
  && binding.dataSnapshotId === snapshot.dataSnapshot.id
  && binding.projectReleaseId === snapshot.projectRelease.id
  && binding.analysisPeriod.from === snapshot.context.primaryPeriod.start
  && binding.analysisPeriod.to === snapshot.context.primaryPeriod.endExclusive;

const bindingsEqual = (
  left: PreschoolOverviewAiBindingDto,
  right: PreschoolOverviewAiBindingDto,
): boolean => left.workspaceId === right.workspaceId
  && left.projectId === right.projectId
  && left.scopeId === right.scopeId
  && left.dataSnapshotId === right.dataSnapshotId
  && left.projectReleaseId === right.projectReleaseId
  && left.analysisPeriod.from === right.analysisPeriod.from
  && left.analysisPeriod.to === right.analysisPeriod.to
  && left.modelProfileId === right.modelProfileId
  && left.modelProfileRevision === right.modelProfileRevision;

const sectionUnitIdentityMatches = (
  value: unknown,
  expectedSectionId: PreschoolOverviewAiSectionIdDto,
  outerBinding: PreschoolOverviewAiBindingDto,
): boolean => {
  if (!isRecord(value) || (value.status !== "available" && value.status !== "empty")) return true;
  if (!isRecord(value.result)) return false;
  if (value.result.status !== value.status) return true;
  return isValidBinding(value.result.binding)
    && bindingsEqual(value.result.binding, outerBinding)
    && value.result.sectionId === expectedSectionId
    && value.result.providerProfileId === value.result.binding.modelProfileId;
};

const executiveUnitIdentityMatches = (
  value: unknown,
  outerBinding: PreschoolOverviewAiBindingDto,
): boolean => {
  if (!isRecord(value) || (value.status !== "available" && value.status !== "empty")) return true;
  if (!isRecord(value.result)) return false;
  if (value.result.status !== value.status) return true;
  return isValidBinding(value.result.binding)
    && bindingsEqual(value.result.binding, outerBinding)
    && value.result.providerProfileId === value.result.binding.modelProfileId;
};

const isRenderableSectionUnit = (
  value: unknown,
  expectedSectionId: PreschoolOverviewAiSectionIdDto,
  outerBinding: PreschoolOverviewAiBindingDto,
  mode: "live" | "saved",
): value is PreschoolOverviewAiUnitStatusDto<PreschoolSectionInterpretationResultDto> => {
  if (!isValidSectionUnit(value)) return false;
  if ((value.status !== "available" && value.status !== "empty")) return true;
  if (!sectionUnitIdentityMatches(value, expectedSectionId, outerBinding)) return false;
  return mode === "saved" || !isV3SectionResult(value.result, value.status);
};

const isRenderableExecutiveUnit = (
  value: unknown,
  outerBinding: PreschoolOverviewAiBindingDto,
  mode: "live" | "saved",
): value is PreschoolOverviewAiUnitStatusDto<PreschoolExecutiveSynthesisResultDto> => {
  if (!isValidExecutiveUnit(value)) return false;
  if ((value.status !== "available" && value.status !== "empty")) return true;
  if (!executiveUnitIdentityMatches(value, outerBinding)) return false;
  return mode === "saved" || !isV3ExecutiveResult(value.result, value.status);
};

type ExecutiveLineage = {
  sectionByArtifactId: ReadonlyMap<string, PreschoolOverviewAiSectionIdDto>;
  evidenceRefsBySection: ReadonlyMap<PreschoolOverviewAiSectionIdDto, ReadonlySet<string>>;
  hasDuplicateTerminalArtifactIds: boolean;
};

const buildExecutiveLineage = (
  value: PreschoolOverviewAiReadModelDto,
  mode: "live" | "saved",
): ExecutiveLineage => {
  const terminalOwners = new Map<string, PreschoolOverviewAiSectionIdDto[]>();
  for (const sectionId of requiredSectionIds) {
    const unit = value.sections[sectionId];
    if (!isRecord(unit)
      || (unit.status !== "available" && unit.status !== "empty" && unit.status !== "unavailable")
      || !isNonEmptyString(unit.artifactId)) continue;
    const owners = terminalOwners.get(unit.artifactId) ?? [];
    owners.push(sectionId);
    terminalOwners.set(unit.artifactId, owners);
  }

  const sectionByArtifactId = new Map<string, PreschoolOverviewAiSectionIdDto>();
  const evidenceRefsBySection = new Map<PreschoolOverviewAiSectionIdDto, ReadonlySet<string>>();
  for (const sectionId of requiredSectionIds) {
    const unit = value.sections[sectionId];
    if (!isRenderableSectionUnit(unit, sectionId, value.binding, mode)
      || unit.status !== "available"
      || !isV4SectionResult(unit.result, "available")) continue;
    if (terminalOwners.get(unit.artifactId)?.length === 1) {
      sectionByArtifactId.set(unit.artifactId, sectionId);
      evidenceRefsBySection.set(sectionId, new Set([
        ...unit.result.summary.evidenceRefs,
        ...unit.result.insights.flatMap(({ evidenceRefs }) => evidenceRefs),
      ]));
    }
  }
  return {
    sectionByArtifactId,
    evidenceRefsBySection,
    hasDuplicateTerminalArtifactIds: [...terminalOwners.values()].some((owners) => owners.length > 1),
  };
};

const executiveUnitLineageIsValid = (
  value: PreschoolOverviewAiUnitStatusDto<PreschoolExecutiveSynthesisResultDto>,
  lineage: ExecutiveLineage,
): boolean => {
  if ((value.status !== "available" && value.status !== "empty")
    || !isV4ExecutiveResult(value.result, value.status)) return true;
  if (lineage.hasDuplicateTerminalArtifactIds) return false;
  const contributingSectionIds = new Set<PreschoolOverviewAiSectionIdDto>();
  for (const artifactId of value.result.sourceSectionArtifactIds) {
    const sectionId = lineage.sectionByArtifactId.get(artifactId);
    if (!sectionId) return false;
    contributingSectionIds.add(sectionId);
  }
  if (value.status === "empty") return true;
  const overviewFactIds = new Set(value.result.overviewEvidence?.factIds ?? []);
  const usedOverviewFactIds = new Set<string>();
  const evidenceOwners = new Map<string, Set<PreschoolOverviewAiSectionIdDto>>();
  for (const sectionId of contributingSectionIds) {
    for (const reference of lineage.evidenceRefsBySection.get(sectionId) ?? []) {
      const owners = evidenceOwners.get(reference) ?? new Set<PreschoolOverviewAiSectionIdDto>();
      owners.add(sectionId);
      evidenceOwners.set(reference, owners);
    }
  }
  const consumeOverviewOrSectionReference = (reference: string): ReadonlySet<PreschoolOverviewAiSectionIdDto> | null => {
    const owners = evidenceOwners.get(reference);
    if (owners) return owners;
    if (overviewFactIds.has(reference)) {
      usedOverviewFactIds.add(reference);
      return new Set();
    }
    return null;
  };
  if (value.result.summary.evidenceRefs.some((reference) => !consumeOverviewOrSectionReference(reference))) {
    return false;
  }
  for (const finding of value.result.findings) {
    const declared = new Set(finding.sectionIds);
    if ([...declared].some((sectionId) => !contributingSectionIds.has(sectionId))) return false;
    const evidenceBackedSections = new Set<PreschoolOverviewAiSectionIdDto>();
    for (const reference of finding.evidenceRefs) {
      const owners = consumeOverviewOrSectionReference(reference);
      if (!owners) return false;
      for (const owner of owners) {
        if (declared.has(owner)) evidenceBackedSections.add(owner);
      }
      if (owners.size > 0 && ![...owners].some((owner) => declared.has(owner))) return false;
    }
    if ([...declared].some((sectionId) => !evidenceBackedSections.has(sectionId))) return false;
  }
  return usedOverviewFactIds.size === overviewFactIds.size;
};

const isAvailableResultRenderableForSlot = (
  value: Extract<PreschoolAiRunResult, { status: "available" }>,
  snapshot: EnergyProjectAnalysisSnapshotDto,
  sectionId: PreschoolAiSectionId,
  mode: "live" | "saved",
): boolean => {
  if (!hasSectionedReadModelArtifactKind(value)) return Array.isArray(value.findings);
  if (!isPreschoolOverviewAiReadModelRenderable(value, snapshot, mode)) return false;
  if (sectionId === "page-synthesis") {
    const lineage = buildExecutiveLineage(value, mode);
    return isRenderableExecutiveUnit(value.executive, value.binding, mode)
      && executiveUnitLineageIsValid(value.executive, lineage);
  }
  const target = sectionIdToValueTarget(sectionId);
  return !target || isRenderableSectionUnit(value.sections[target], target, value.binding, mode);
};

const sectionIdToValueTarget = (sectionId: PreschoolAiSectionId): PreschoolOverviewAiSectionIdDto | null => {
  if (sectionId === "centre-benchmark"
    || sectionId === "standby-wastage"
    || sectionId === "operating-behaviour"
    || sectionId === "planning-outlook") return sectionId;
  return null;
};

const sectionPointMeta = {
  priority: { icon: "alert", label: "Priority", tone: "bg-step-error-soft text-step-error" },
  finding: { icon: "analysis", label: "Supporting signal", tone: "bg-step-inspect/10 text-step-inspect" },
  meaning: { icon: "info", label: "Why it matters", tone: "bg-step-warning-soft text-step-warning" },
  "next-check": { icon: "arrow", label: "Next action", tone: "bg-step-success-soft text-step-success" },
} as const;

const sectionInsightStatusMeta = {
  observed: { label: "Observed", tone: "bg-step-success-soft text-step-success" },
  inferred: { label: "Inferred", tone: "bg-step-warning-soft text-step-warning" },
  speculative: { label: "Possible", tone: "bg-step-warning-soft text-step-warning" },
} as const;

function AiFrame({
  children,
  sectionId,
  pageSynthesisVersion = "v4",
}: {
  children: React.ReactNode;
  sectionId: PreschoolAiSectionId;
  pageSynthesisVersion?: "v3" | "v4";
}) {
  if (sectionId === "overall-summary") {
    return (
      <section
        id="preschool-additional-ai-insights"
        aria-labelledby="preschool-additional-ai-insights-heading"
        data-overview-section="true"
        data-overview-navigation-label="Additional AI Insights"
        data-ai-section={sectionId}
        tabIndex={-1}
        className="scroll-mt-28 border-b border-border bg-surface px-5 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:py-7"
      >
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <h3 id="preschool-additional-ai-insights-heading" className="text-lg font-semibold tracking-[-0.02em] text-foreground">Additional AI Insights</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">AI-generated</span>
        </div>
        {children}
      </section>
    );
  }
  if (sectionId !== "page-synthesis") {
    return (
      <aside className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4 lg:p-5" aria-label="AI interpretation for this section" data-ai-section={sectionId}>
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-primary/15 pb-3">
          <EnergyIcon name="spark" className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">AI interpretation</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">AI-generated</span>
        </div>
        {children}
      </aside>
    );
  }
  return (
    <section aria-labelledby="preschool-ai-slot" className="border-b border-border bg-surface px-5 py-5 lg:px-7 lg:py-6" data-ai-section={sectionId}>
      <div className="mb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="preschool-ai-slot" className="text-xl font-semibold tracking-[-0.02em] text-foreground">{pageSynthesisVersion === "v3" ? "AI Executive Summary" : "Key Findings"}</h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">AI-generated</span>
          </div>
          <p className="mt-1.5 max-w-[75ch] text-sm leading-6 text-muted">
            {pageSynthesisVersion === "v3"
              ? "The main cross-section summary, composed only from accepted Section interpretations."
              : "The most useful cross-section themes supported by accepted Section interpretations."}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

const completedSectionCount = (result: PreschoolOverviewAiReadModelDto): number =>
  requiredSectionIds.filter((sectionId) => {
    const unit = result.sections[sectionId];
    return isValidSectionUnit(unit)
      && (unit.status === "available"
        || unit.status === "empty"
        || (unit.status === "unavailable" && unit.artifactId !== undefined));
  }).length;

const isV4SectionResult = (
  value: unknown,
  expectedStatus?: "available" | "empty",
): value is PreschoolSectionInterpretationV4Result => {
  if (!isValidSectionResultBase(value) || !Array.isArray(value.insights)) return false;
  if (expectedStatus && value.status !== expectedStatus) return false;
  if (value.status === "available") {
    return isSummary(value.summary, ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionSummaryChars)
      && value.insights.every(isSectionInsight)
      && isOptionalString(value.limitation)
      && (value.limitation === undefined
        || (typeof value.limitation === "string"
          && value.limitation.length <= ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionLimitationChars));
  }
  return value.status === "empty"
    && value.insights.length === 0
    && value.summary === undefined
    && isOptionalString(value.limitation);
};

const isV4ExecutiveResult = (
  value: unknown,
  expectedStatus?: "available" | "empty",
): value is PreschoolExecutiveSynthesisV4Result => {
  if (!isValidExecutiveResultBase(value) || !Array.isArray(value.findings)) return false;
  if (expectedStatus && value.status !== expectedStatus) return false;
  if (value.status === "available") {
    return isUniqueStringArray(value.sourceSectionArtifactIds, false, 4)
      && isSummary(value.summary, ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.executiveSummaryChars)
      && (value.overviewEvidence === undefined
        || isExecutiveOverviewEvidenceLineage(value.overviewEvidence, value.binding))
      && value.findings.every(isKeyFinding);
  }
  return value.status === "empty"
    && isUniqueStringArray(value.sourceSectionArtifactIds, true, 4)
    && value.findings.length === 0
    && value.summary === undefined
    && value.overviewEvidence === undefined;
};

const isV3ExecutiveResult = (
  value: unknown,
  expectedStatus?: "available" | "empty",
): value is PreschoolExecutiveSynthesisV3Result => {
  if (!isValidExecutiveResultBase(value) || !Array.isArray(value.keyFindings)) return false;
  if (expectedStatus && value.status !== expectedStatus) return false;
  if (value.status === "available") return value.keyFindings.every(isV3KeyFinding);
  return value.status === "empty" && value.keyFindings.length === 0;
};

const isV3SectionResult = (
  value: unknown,
  expectedStatus?: "available" | "empty",
): value is PreschoolSectionInterpretationV3Result => {
  if (!isValidSectionResultBase(value) || !Array.isArray(value.keyPoints)) return false;
  if (expectedStatus && value.status !== expectedStatus) return false;
  if (!isOptionalString(value.limitation)) return false;
  if (value.status === "available") {
    return isOptionalString(value.summary) && value.keyPoints.every(isV3SectionPoint);
  }
  return value.status === "empty"
    && value.keyPoints.length === 0
    && value.summary === undefined;
};

const isValidSectionUnit = (
  value: unknown,
): value is PreschoolOverviewAiUnitStatusDto<PreschoolSectionInterpretationResultDto> => {
  if (!isRecord(value)) return false;
  if (value.status === "queued" || value.status === "running") return true;
  if (value.status === "unavailable") {
    return isNonEmptyString(value.reason)
      && (value.artifactId === undefined || isNonEmptyString(value.artifactId));
  }
  if ((value.status !== "available" && value.status !== "empty") || !isNonEmptyString(value.artifactId)) return false;
  return isV4SectionResult(value.result, value.status) || isV3SectionResult(value.result, value.status);
};

const isValidExecutiveUnit = (
  value: unknown,
): value is PreschoolOverviewAiUnitStatusDto<PreschoolExecutiveSynthesisResultDto> => {
  if (!isRecord(value)) return false;
  if (value.status === "queued" || value.status === "running") return true;
  if (value.status === "unavailable") {
    return isNonEmptyString(value.reason)
      && (value.artifactId === undefined || isNonEmptyString(value.artifactId));
  }
  if ((value.status !== "available" && value.status !== "empty") || !isNonEmptyString(value.artifactId)) return false;
  return isV4ExecutiveResult(value.result, value.status) || isV3ExecutiveResult(value.result, value.status);
};

const isValidSectionResultBase = (value: unknown): value is Record<string, unknown> =>
  isRecord(value)
  && value.artifactKind === "section-interpretation"
  && (value.status === "available" || value.status === "empty")
  && isNonEmptyString(value.providerProfileId)
  && isNonEmptyString(value.runId)
  && isValidBinding(value.binding)
  && isPreschoolSectionId(value.sectionId);

const isValidExecutiveResultBase = (value: unknown): value is Record<string, unknown> =>
  isRecord(value)
  && value.artifactKind === "executive-synthesis"
  && (value.status === "available" || value.status === "empty")
  && isNonEmptyString(value.providerProfileId)
  && isNonEmptyString(value.runId)
  && isValidBinding(value.binding)
  && isStringArray(value.sourceSectionArtifactIds);

const isValidBinding = (value: unknown): value is PreschoolOverviewAiBindingDto => {
  if (!isRecord(value) || !isRecord(value.analysisPeriod)) return false;
  return isNonEmptyString(value.workspaceId)
    && isNonEmptyString(value.projectId)
    && isNonEmptyString(value.scopeId)
    && isNonEmptyString(value.dataSnapshotId)
    && isNonEmptyString(value.projectReleaseId)
    && isNonEmptyString(value.analysisPeriod.from)
    && isNonEmptyString(value.analysisPeriod.to)
    && isNonEmptyString(value.modelProfileId)
    && typeof value.modelProfileRevision === "number"
    && Number.isFinite(value.modelProfileRevision);
};

const isSummary = (value: unknown, maxLength: number): boolean =>
  isRecord(value)
  && isNonEmptyString(value.text)
  && value.text.length <= maxLength
  && isUniqueStringArray(value.evidenceRefs);

const isExecutiveOverviewEvidenceLineage = (
  value: unknown,
  binding: unknown,
): boolean => {
  const factIds = isRecord(value) ? value.factIds : undefined;
  const facts = isRecord(value) ? value.facts : undefined;
  if (!isRecord(value) || !isRecord(value.pins) || !isValidBinding(binding)
    || value.contract !== "analysis-context-evidence@1"
    || !isNonEmptyString(value.sourceId)
    || value.pins.workspaceId !== binding.workspaceId
    || value.pins.projectId !== binding.projectId
    || value.pins.scopeId !== binding.scopeId
    || value.pins.dataSnapshotId !== binding.dataSnapshotId
    || value.pins.projectReleaseId !== binding.projectReleaseId
    || !isNonEmptyString(value.pins.dataCutoff)
    || !isNonEmptyString(value.pins.metricVersion)
    || !isUniqueStringArray(factIds)
    || !Array.isArray(facts)
    || facts.length !== factIds.length) return false;
  return facts.every((fact, index) => isRecord(fact)
    && fact.id === factIds[index]
    && isNonEmptyString(fact.id)
    && isNonEmptyString(fact.label)
    && isNonEmptyString(fact.metricId)
    && (typeof fact.value === "string"
      || typeof fact.value === "number"
      || typeof fact.value === "boolean"
      || fact.value === null)
    && isOptionalString(fact.unit)
    && (fact.status === "confirmed" || fact.status === "provisional" || fact.status === "partial")
    && isUniqueStringArray(fact.evidenceRefs)
    && isRecord(fact.dimensions)
    && Object.values(fact.dimensions).every((dimension) => typeof dimension === "string"));
};

const isSectionInsight = (value: unknown): boolean =>
  isRecord(value)
  && isNonEmptyString(value.id)
  && isNonEmptyString(value.title)
  && value.title.length <= ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionInsightTitleChars
  && isOptionalString(value.label)
  && (value.label === undefined
    || (typeof value.label === "string"
      && value.label.length <= ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionInsightLabelChars))
  && (value.epistemicStatus === "observed" || value.epistemicStatus === "inferred" || value.epistemicStatus === "speculative")
  && isNonEmptyString(value.text)
  && value.text.length <= ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionInsightTextChars
  && isUniqueStringArray(value.evidenceRefs)
  && isOptionalString(value.deepDiveQuestion)
  && (value.deepDiveQuestion === undefined
    || (typeof value.deepDiveQuestion === "string"
      && value.deepDiveQuestion.length <= ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionDeepDiveQuestionChars));

const isKeyFinding = (value: unknown): boolean => {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.title)
    || value.title.length > ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.executiveFindingTitleChars
    || !isNonEmptyString(value.text)
    || value.text.length > ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.executiveFindingTextChars
    || !isUniqueStringArray(value.sectionIds)
    || !value.sectionIds.every(isPreschoolSectionId)
    || !isUniqueStringArray(value.evidenceRefs)) return false;
  if (value.alert === undefined) return true;
  return isRecord(value.alert)
    && (value.alert.severity === "attention" || value.alert.severity === "urgent")
    && (value.alert.certainty === "confirmed" || value.alert.certainty === "anomaly" || value.alert.certainty === "possible");
};

const isV3SectionPoint = (value: unknown): boolean =>
  isRecord(value)
  && (value.kind === "priority" || value.kind === "finding" || value.kind === "meaning" || value.kind === "next-check")
  && isOptionalString(value.label)
  && isNonEmptyString(value.text)
  && isStringArray(value.evidenceRefs);

const isV3KeyFinding = (value: unknown): boolean =>
  isRecord(value)
  && isNonEmptyString(value.id)
  && isNonEmptyString(value.takeaway)
  && isStringArray(value.sectionIds)
  && value.sectionIds.every(isPreschoolSectionId)
  && isStringArray(value.evidenceRefs);

const isPreschoolSectionId = (value: unknown): value is PreschoolOverviewAiSectionIdDto =>
  value === "centre-benchmark"
  || value === "standby-wastage"
  || value === "operating-behaviour"
  || value === "planning-outlook";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isNonEmptyString);
const isUniqueStringArray = (
  value: unknown,
  allowEmpty = false,
  maximumLength = Number.POSITIVE_INFINITY,
): value is string[] => isStringArray(value)
  && (allowEmpty || value.length > 0)
  && value.length <= maximumLength
  && new Set(value).size === value.length;

const invalidResultDetail = (mode: "live" | "saved", label: string): string =>
  mode === "saved"
    ? `Invalid saved AI result. ${label} was not rendered; other verified content is unchanged.`
    : `Invalid AI result. ${label} was not rendered; other verified content is unchanged.`;

const invalidReadModelDetail = (mode: "live" | "saved"): string =>
  mode === "saved"
    ? "Invalid saved AI read model. AI content was not rendered; the verified Overview is unchanged."
    : "Invalid AI read model. AI content was not rendered; the verified Overview is unchanged.";

function buildSectionInsightHref(
  base: string,
  artifactId: string,
  result: PreschoolSectionInterpretationV4AvailableResult,
  insight: PreschoolSectionInterpretationV4AvailableResult["insights"][number],
  reportTimeContext?: EnergyProjectAnalysisSnapshotDto["reportTimeContext"],
): string {
  const [path, query = ""] = base.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("projectId", result.binding.projectId);
  params.set("finding", JSON.stringify({
    kind: "section-insight",
    insightId: insight.id,
    sectionId: result.sectionId,
    artifactId,
    runId: result.runId,
    deepDiveQuestion: insight.deepDiveQuestion,
    title: insight.title,
    what: insight.text,
    why: {
      kind: insight.epistemicStatus === "observed" ? "Evidence" : "Hypothesis",
      text: insight.text,
    },
    how: insight.deepDiveQuestion,
    howToVerify: insight.deepDiveQuestion,
  }));
  params.set("evidence", JSON.stringify({
    snapshotId: result.binding.dataSnapshotId,
    projectReleaseId: result.binding.projectReleaseId,
    evidenceRefs: insight.evidenceRefs,
    period: result.binding.analysisPeriod,
    ...(reportTimeContext ? {
      reportTime: {
        contractRevision: reportTimeContext.contractRevision,
        timezone: reportTimeContext.timezone,
        acceptedDataEndExclusive: reportTimeContext.acceptedDataEndExclusive,
        dataThroughLocalDate: reportTimeContext.dataThroughLocalDate,
        policyId: reportTimeContext.policyId,
        policyRevision: reportTimeContext.policyRevision,
        windows: reportTimeContext.windows.map((window) => ({
          windowId: window.windowId,
          label: window.label,
          phase: window.phase,
          from: window.from,
          toExclusive: window.toExclusive,
          completeDayCount: window.completeDayCount,
        })),
      },
    } : {}),
    note: result.limitation ?? "Use only the cited Evidence within the pinned Snapshot and Release.",
  }));
  return `${path}?${params.toString()}`;
}

type DisplayFinding = PreschoolAiFinding | PreschoolAiAcceptedFinding;
type AutonomousAvailableResult =
  | Extract<PreschoolAiLegacyRunResult, { status: "available" }>
  | PreschoolAiAcceptedArtifact;

const autonomousAvailableResult = (value: unknown): AutonomousAvailableResult | null => {
  if (!isRecord(value)
    || value.status !== "available"
    || typeof value.providerProfileId !== "string"
    || typeof value.runId !== "string"
    || value.packId !== "preschool-analysis-pack"
    || value.packRevision !== "v1"
    || !Array.isArray(value.findings)) return null;
  const usesAcceptedContract = isRecord(value.contract)
    && value.contract.id === "preschool-ai-accepted-artifact";
  const findingsAreConsumable = usesAcceptedContract
    ? value.findings.every(isRenderableAcceptedFinding)
    : value.findings.every(isRenderableLegacyFinding);
  return findingsAreConsumable ? value as AutonomousAvailableResult : null;
};

function isRenderableLegacyFinding(value: unknown): value is PreschoolAiFinding {
  return isRecord(value)
    && typeof value.id === "string"
    && isLegacySectionId(value.sectionId)
    && isStringArray(value.signalRefs)
    && isFindingRelationship(value.relationship)
    && typeof value.title === "string"
    && typeof value.what === "string"
    && isRecord(value.why)
    && isLegacyWhyKind(value.why.kind)
    && typeof value.why.text === "string"
    && typeof value.how === "string"
    && typeof value.expectedIfAct === "string"
    && typeof value.ifIgnored === "string"
    && typeof value.howToVerify === "string"
    && typeof value.evidenceNote === "string"
    && isRenderablePresentation(value.presentation)
    && isRenderableFindingEvidence(value.evidence);
}

function isRenderableAcceptedFinding(value: unknown): value is PreschoolAiAcceptedFinding {
  return isRecord(value)
    && typeof value.id === "string"
    && isRecord(value.binding)
    && Array.isArray(value.placementTargets)
    && value.placementTargets.every(isPlacementTarget)
    && isEpistemicLevel(value.epistemicLevel)
    && isFindingRelationship(value.relationship)
    && isStringArray(value.signalRefs)
    && typeof value.title === "string"
    && typeof value.takeaway === "string"
    && isOptionalString(value.interpretation)
    && typeof value.action === "string"
    && typeof value.expectedIfAct === "string"
    && typeof value.ifIgnored === "string"
    && isOptionalString(value.possibleExplanation)
    && isOptionalString(value.verification)
    && typeof value.uncertainty === "string"
    && isRenderablePresentation(value.presentation)
    && isRenderableFindingEvidence(value.evidence);
}

function isRenderableFindingEvidence(value: unknown): boolean {
  return isRecord(value)
    && typeof value.snapshotId === "string"
    && isRecord(value.period)
    && typeof value.period.from === "string"
    && typeof value.period.to === "string"
    && Array.isArray(value.deterministic)
    && value.deterministic.every(isRenderableDeterministicEvidence)
    && Array.isArray(value.tools)
    && value.tools.every(isRenderableToolEvidence);
}

function isRenderableDeterministicEvidence(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && isDiscoveryEvidenceKind(value.kind)
    && typeof value.label === "string"
    && isDiscoveryEvidenceUnit(value.unit)
    && isRecord(value.values)
    && Object.values(value.values).every(isDiscoveryEvidenceValue)
    && isStringArray(value.queryIds)
    && (value.limitation === null || typeof value.limitation === "string");
}

function isRenderableToolEvidence(value: unknown): boolean {
  return isRecord(value)
    && Number.isSafeInteger(value.evidenceIndex)
    && typeof value.toolCallId === "string"
    && (value.sql === null || typeof value.sql === "string")
    && (value.rowCount === null || typeof value.rowCount === "number")
    && (value.auditLogId === null || typeof value.auditLogId === "string")
    && (value.elapsedMs === null || typeof value.elapsedMs === "number")
    && typeof value.resultPreview === "string";
}

const isRenderablePresentation = (value: unknown): boolean =>
  value === undefined
  || (isRecord(value)
    && value.version === "1"
    && Array.isArray(value.blocks)
    && value.blocks.every(isRenderablePresentationBlock));

function isRenderablePresentationBlock(value: unknown): boolean {
  if (!isRecord(value)
    || !isOptionalDisplayString(value.title)
    || !isOptionalDisplayString(value.unit)
    || !isOptionalDisplayString(value.context)
    || (value.prominence !== undefined && value.prominence !== "primary" && value.prominence !== "supporting")) return false;
  if (value.type === "metric") {
    return typeof value.label === "string" && isFiniteNumber(value.value);
  }
  if (value.type === "comparison" || value.type === "ranking" || value.type === "share" || value.type === "distribution") {
    return Array.isArray(value.items) && value.items.every(isRenderablePresentationValueItem);
  }
  if (value.type === "trend") {
    return Array.isArray(value.points) && value.points.every(isRenderablePresentationValueItem);
  }
  if (value.type === "heatmap") {
    return isStringArray(value.xLabels)
      && isStringArray(value.yLabels)
      && Array.isArray(value.values)
      && value.values.length === value.yLabels.length
      && value.values.every((row) => Array.isArray(row) && row.every(isFiniteNumber));
  }
  if (value.type === "table") {
    return isStringArray(value.columns)
      && Array.isArray(value.rows)
      && value.rows.every((row) => Array.isArray(row)
        && row.every((cell) => typeof cell === "string" || isFiniteNumber(cell)));
  }
  return value.type === "callout"
    && (value.tone === "insight" || value.tone === "caution" || value.tone === "positive" || value.tone === "neutral")
    && typeof value.text === "string";
}

const isRenderablePresentationValueItem = (value: unknown): boolean =>
  isRecord(value) && typeof value.label === "string" && isFiniteNumber(value.value);

const isOptionalDisplayString = (value: unknown): boolean => value === undefined || typeof value === "string";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isLegacySectionId = (value: unknown): value is PreschoolAiSectionId =>
  value === "overall-summary"
  || value === "centre-benchmark"
  || value === "standby-wastage"
  || value === "operating-behaviour"
  || value === "planning-outlook"
  || value === "page-synthesis";

const isLegacyWhyKind = (value: unknown): value is PreschoolAiFinding["why"]["kind"] =>
  value === "Evidence" || value === "Hypothesis" || value === "Missing Evidence";

const isFindingRelationship = (value: unknown): value is DisplayFinding["relationship"] =>
  value === "supports" || value === "challenges" || value === "independent";

const isEpistemicLevel = (value: unknown): value is PreschoolAiEpistemicLevel =>
  value === "verified" || value === "hypothesis" || value === "exploration-idea";

const isPlacementTarget = (value: unknown): boolean =>
  value === "preschool.overall-key-findings"
  || value === "preschool.benchmark"
  || value === "preschool.standby"
  || value === "preschool.operating-hours"
  || value === "preschool.forecast"
  || value === "cross-section";

const isDiscoveryEvidenceKind = (value: unknown): boolean =>
  value === "theme"
  || value === "portfolio"
  || value === "benchmark"
  || value === "centre"
  || value === "operating"
  || value === "spike"
  || value === "circuit"
  || value === "quality"
  || value === "limitation";

const isDiscoveryEvidenceUnit = (value: unknown): boolean =>
  value === null || value === "kWh" || value === "kWh/m2/year" || value === "kWh/person/month";

const isDiscoveryEvidenceValue = (value: unknown): boolean =>
  value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";

function findingMatchesSection(finding: DisplayFinding, sectionId: PreschoolAiSectionId): boolean {
  if (!isAcceptedFinding(finding)) return (finding.sectionId ?? "page-synthesis") === sectionId;
  return finding.placementTargets.some((target) => {
    if (target === "preschool.benchmark") return sectionId === "centre-benchmark";
    if (target === "preschool.standby") return false;
    if (target === "preschool.operating-hours") return sectionId === "operating-behaviour";
    if (target === "preschool.forecast") return sectionId === "planning-outlook";
    return sectionId === "page-synthesis";
  });
}

function Unavailable({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
      <p className="text-xs font-semibold text-foreground">AI analysis unavailable</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-light">The verified Overview remains available and unchanged.</p>
    </div>
  );
}

function FindingCard({
  finding,
  pack,
  projectId,
  aiAnalystHref,
}: {
  finding: DisplayFinding;
  pack: string;
  projectId: string;
  aiAnalystHref?: string;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setEvidenceOpen(false);
    triggerRef.current?.focus();
  }, []);
  const askHref = aiAnalystHref ? buildAskHref(aiAnalystHref, projectId, finding) : null;
  const accepted = isAcceptedFinding(finding);
  const takeaway = accepted ? finding.takeaway : finding.what;
  const interpretation = accepted ? finding.interpretation : finding.why.text;
  const action = accepted ? finding.action : finding.how;
  const expectedIfAct = finding.expectedIfAct;
  const ifIgnored = finding.ifIgnored;
  const possibleExplanation = accepted ? finding.possibleExplanation : undefined;
  const verification = accepted ? finding.verification : finding.howToVerify;
  const limitation = accepted ? finding.uncertainty : finding.evidenceNote;
  const epistemicLevel = accepted ? finding.epistemicLevel : whyKindToEpistemicLevel(finding.why.kind);
  return (
    <article className="min-w-0 rounded-xl border border-border bg-surface px-5 py-5 lg:px-6 lg:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="max-w-5xl text-lg font-semibold leading-7 tracking-[-0.015em] text-foreground">{finding.title}</h4>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${relationshipClass(finding.relationship)}`}>
          {relationshipLabel(finding.relationship)}
        </span>
      </div>

      <div className="mt-5" data-ai-primary-takeaway="true">
        <p className="text-xs font-semibold text-muted">What the data shows</p>
        <p className="mt-1.5 max-w-[75ch] text-base font-semibold leading-7 text-foreground">{takeaway}</p>
      </div>

      {interpretation || action ? <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        {interpretation ? <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-muted">Why this matters</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${epistemicLevelClass(epistemicLevel)}`}>
              {epistemicLevelLabel(epistemicLevel)}
            </span>
          </div>
          <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-foreground/80">{interpretation}</p>
        </div> : <div />}
        {action ? <div className="rounded-xl bg-primary px-5 py-4 text-white" data-ai-primary-action="true">
          <p className="text-xs font-semibold text-white/70">Recommended next check</p>
          <p className="mt-1.5 text-base font-semibold leading-6">{action}</p>
        </div> : null}
      </div> : null}

      {possibleExplanation ? <div className="mt-5 rounded-xl border border-step-warning/30 bg-step-warning-soft px-5 py-4">
        <p className="text-xs font-semibold text-step-warning">Possible explanation · needs verification</p>
        <p className="mt-1.5 max-w-[75ch] text-sm leading-6 text-foreground/80">{possibleExplanation}</p>
      </div> : null}

      <AiFindingPresentationView presentation={finding.presentation} />

      <dl className="mt-5 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
        <DecisionOutcome label="Expected if acted on" value={expectedIfAct} tone="positive" />
        <DecisionOutcome label="If ignored" value={ifIgnored} tone="warning" />
      </dl>

      {verification || limitation ? <details className="mt-5 border-t border-border pt-4" data-ai-secondary-details="true">
        <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Verification and limitations
        </summary>
        <dl className="mt-4 grid gap-5 text-sm leading-6 sm:grid-cols-2">
          {verification ? <DecisionDetail label="How to verify" value={verification} /> : null}
          {limitation ? <DecisionDetail label="Limitations" value={limitation} /> : null}
        </dl>
      </details> : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        <button ref={triggerRef} type="button" onClick={() => setEvidenceOpen(true)} className="h-8 rounded-md border border-border bg-surface px-3 text-[11px] font-semibold text-foreground">
          View evidence
        </button>
        {askHref ? <a href={askHref} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-white">Ask the advisor <EnergyIcon name="arrow" className="h-3 w-3" /></a> : null}
      </div>
      {evidenceOpen ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby={`${finding.id}-evidence`} className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">Finding Evidence</p><h4 id={`${finding.id}-evidence`} className="mt-1 text-base font-semibold text-foreground">{finding.title}</h4></div>
              <button type="button" onClick={close} className="h-8 rounded-md border border-border px-3 text-[11px] font-semibold text-foreground">Close</button>
            </div>
            <dl className="mt-4 grid gap-2 text-[11px] sm:grid-cols-2">
              <Pin label="Analysis Pack" value={pack} />
              <Pin label="Snapshot" value={finding.evidence.snapshotId} />
              <Pin label="Period" value={`${finding.evidence.period.from} / ${finding.evidence.period.to}`} />
              <Pin label="Relationship" value={titleCase(finding.relationship)} />
            </dl>
            {limitation ? <p className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-3 text-xs leading-5 text-muted">{limitation}</p> : null}
            {finding.evidence.deterministic.map((item) => (
              <section key={item.id} className="mt-4 rounded-lg border border-border p-4">
                <p className="text-xs font-semibold text-foreground">{item.label}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-light">{item.id}</p>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle p-3 font-mono text-[10px] text-muted">{JSON.stringify(item.values, null, 2)}</pre>
                {item.queryIds.length > 0 ? <p className="mt-2 break-words font-mono text-[10px] text-muted-light">Queries: {item.queryIds.join(" / ")}</p> : null}
                {item.limitation ? <p className="mt-2 text-[10px] leading-4 text-muted">{item.limitation}</p> : null}
              </section>
            ))}
            {finding.evidence.tools.map((tool) => (
              <section key={tool.toolCallId} className="mt-4 rounded-lg border border-border p-4">
                <p className="text-xs font-semibold text-foreground">Read-only SQL Evidence</p>
                <p className="mt-1 font-mono text-[10px] text-muted-light">{tool.auditLogId ?? tool.toolCallId}</p>
                <p className="mt-2 text-[10px] text-muted-light">
                  Rows {tool.rowCount?.toLocaleString("en-SG") ?? "unknown"} · {tool.elapsedMs === null ? "Elapsed unavailable" : `${tool.elapsedMs.toLocaleString("en-SG")} ms`}
                </p>
                {tool.sql ? <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle p-3 font-mono text-[10px] text-muted">{tool.sql}</pre> : null}
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle p-3 font-mono text-[10px] text-muted">{tool.resultPreview}</pre>
              </section>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </article>
  );
}

function DecisionOutcome({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "warning";
}) {
  return (
    <div>
      <dt className={tone === "positive" ? "font-semibold text-step-success" : "font-semibold text-step-warning"}>{label}</dt>
      <dd className="mt-1.5 max-w-[65ch] text-sm leading-6 text-foreground/80">{value}</dd>
    </div>
  );
}

function DecisionDetail({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold text-foreground">{label}</dt><dd className="mt-1 text-muted">{value}</dd></div>;
}

function Pin({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-surface-subtle px-3 py-2"><dt className="text-[10px] uppercase text-muted-light">{label}</dt><dd className="mt-1 break-all font-mono text-[10px] text-foreground">{value}</dd></div>;
}

function progressLabel(progress: PreschoolAiProgress): string {
  if (progress === "queued" || progress === "inspecting") return "Loading saved AI summary…";
  if (progress === "querying") return "Preparing AI summary…";
  if (progress === "validating") return "Validating the investigation…";
  if (progress === "drafting") return "Drafting findings…";
  return "Loading saved AI summary…";
}

function relationshipClass(relationship: PreschoolAiFinding["relationship"]): string {
  if (relationship === "challenges") return "bg-step-warning-soft text-step-warning";
  if (relationship === "independent") return "bg-primary/10 text-primary";
  return "bg-step-success-soft text-step-success";
}

function relationshipLabel(relationship: PreschoolAiFinding["relationship"]): string {
  if (relationship === "challenges") return "Challenges the current view";
  if (relationship === "independent") return "New investigation angle";
  return "Reinforces a known issue";
}

function epistemicLevelLabel(level: PreschoolAiEpistemicLevel): string {
  if (level === "verified") return "Evidence-backed";
  if (level === "hypothesis") return "Hypothesis";
  return "Exploration idea";
}

function epistemicLevelClass(level: PreschoolAiEpistemicLevel): string {
  if (level === "verified") return "bg-step-success-soft text-step-success";
  if (level === "hypothesis") return "bg-step-warning-soft text-step-warning";
  return "bg-surface-subtle text-muted";
}

function whyKindToEpistemicLevel(kind: PreschoolAiFinding["why"]["kind"]): PreschoolAiEpistemicLevel {
  if (kind === "Evidence") return "verified";
  if (kind === "Hypothesis") return "hypothesis";
  return "exploration-idea";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildAskHref(base: string, projectId: string, finding: DisplayFinding): string {
  const [path, query = ""] = base.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("projectId", projectId);
  params.set("finding", JSON.stringify(isAcceptedFinding(finding) ? {
    title: finding.title,
    takeaway: finding.takeaway,
    epistemicLevel: finding.epistemicLevel,
    interpretation: finding.interpretation,
    possibleExplanation: finding.possibleExplanation,
    action: finding.action,
    expectedIfAct: finding.expectedIfAct,
    ifIgnored: finding.ifIgnored,
    verification: finding.verification,
    uncertainty: finding.uncertainty,
  } : {
    title: finding.title,
    what: finding.what,
    why: finding.why,
    how: finding.how,
    expectedIfAct: finding.expectedIfAct,
    ifIgnored: finding.ifIgnored,
    howToVerify: finding.howToVerify,
  }));
  params.set("evidence", JSON.stringify({
    snapshotId: finding.evidence.snapshotId,
    dataCutoff: finding.evidence.period.to,
    period: finding.evidence.period,
    note: isAcceptedFinding(finding) ? finding.uncertainty : finding.evidenceNote,
    deterministicEvidenceIds: finding.evidence.deterministic.map((item) => item.id),
    toolCallIds: finding.evidence.tools.map((tool) => tool.toolCallId),
    auditLogIds: finding.evidence.tools.flatMap((tool) => tool.auditLogId ? [tool.auditLogId] : []),
  }));
  return `${path}?${params.toString()}`;
}

function isAcceptedFinding(finding: DisplayFinding): finding is PreschoolAiAcceptedFinding {
  return isRenderableAcceptedFinding(finding);
}
