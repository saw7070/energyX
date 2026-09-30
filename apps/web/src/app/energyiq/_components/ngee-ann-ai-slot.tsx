"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import {
  buildNgeeAnnAiRunInput,
  getOrStartNgeeAnnAiRun,
  toFriendlyNgeeAnnAiUnavailableReason,
  type NgeeAnnAiFinding,
  type NgeeAnnAiProgress,
  type NgeeAnnAiProgressCallback,
  type NgeeAnnAiRelationship,
  type NgeeAnnAiRunInput,
  type NgeeAnnAiRunResult,
} from "./ngee-ann-ai-run";
import type { NgeeAnnDecisionPrioritiesViewModel } from "./ngee-ann-overview-view-model";
import { AiFindingPresentationView } from "./ai-finding-presentation-view";

type SettledRun = {
  identityKey: string;
  result: NgeeAnnAiRunResult;
};

type RunProgress = {
  identityKey: string;
  stage: NgeeAnnAiProgress;
};

export function NgeeAnnAiSlot({
  snapshot,
  decisionPriorities,
  aiAnalystHref,
  mode = "live",
  savedResult,
  onCompletedResult,
  startRun = getOrStartNgeeAnnAiRun,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  decisionPriorities: NgeeAnnDecisionPrioritiesViewModel;
  aiAnalystHref?: string;
  mode?: "live" | "saved";
  savedResult?: Extract<NgeeAnnAiRunResult, { status: "available" }>;
  onCompletedResult?: (result: Extract<NgeeAnnAiRunResult, { status: "available" }>) => void;
  startRun?: (input: NgeeAnnAiRunInput, onProgress?: NgeeAnnAiProgressCallback) => Promise<NgeeAnnAiRunResult>;
}) {
  const input = useMemo(
    () => buildNgeeAnnAiRunInput(snapshot, decisionPriorities),
    [decisionPriorities, snapshot],
  );
  const identityKey = input?.identityKey ?? null;
  const inputRef = useRef(input);
  const startRunRef = useRef(startRun);
  const onCompletedResultRef = useRef(onCompletedResult);
  const [settled, setSettled] = useState<SettledRun | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  inputRef.current = input;
  startRunRef.current = startRun;
  onCompletedResultRef.current = onCompletedResult;

  useEffect(() => {
    if (mode === "saved") return;
    if (!identityKey) return;
    const currentInput = inputRef.current;
    if (!currentInput) return;
    let active = true;
    const onProgress: NgeeAnnAiProgressCallback = (stage) => {
      if (active) setProgress({ identityKey, stage });
    };
    void startRunRef.current(currentInput, onProgress)
      .then((result) => {
        if (active) {
          setSettled({ identityKey, result });
          if (result.status === "available") onCompletedResultRef.current?.(result);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSettled({
            identityKey,
            result: {
              status: "unavailable",
              reason: toFriendlyNgeeAnnAiUnavailableReason(error instanceof Error && error.message.trim()
                ? error.message
                : "The energy advisor is unavailable for this Snapshot."),
            },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [identityKey, mode]);

  if (mode === "saved" && !savedResult) {
    return (
      <AiSlotFrame>
        <AiUnavailable detail="No completed AI result was attached when this analysis was saved. Opening a saved result never starts a new AI run." />
      </AiSlotFrame>
    );
  }

  if (!input) {
    return (
      <AiSlotFrame>
        <AiUnavailable detail="AI analysis needs a ready electricity Snapshot with complete 1d, 7d and 28d decision context." />
      </AiSlotFrame>
    );
  }

  const displayedResult = mode === "saved"
    ? savedResult
    : settled?.identityKey === input.identityKey
      ? settled.result
      : null;

  if (!displayedResult) {
    const stage = progress?.identityKey === input.identityKey ? progress.stage : "inspecting";
    return (
      <AiSlotFrame>
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 animate-pulse items-center justify-center rounded-full bg-primary/10 text-primary motion-reduce:animate-none">
              <EnergyIcon name="spark" className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-foreground">{progressLabel(stage)}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                The deterministic Overview is ready. The AI energy analyst is independently working against this pinned Snapshot in the background.
              </p>
            </div>
          </div>
        </div>
      </AiSlotFrame>
    );
  }

  if (displayedResult.status === "unavailable") {
    return (
      <AiSlotFrame>
        <AiUnavailable detail={toFriendlyNgeeAnnAiUnavailableReason(displayedResult.reason)} />
      </AiSlotFrame>
    );
  }

  if (displayedResult.findings.length === 0) {
    return (
      <AiSlotFrame>
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">No additional Evidence-backed candidates</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            The energy advisor did not find a distinct angle worth adding to the deterministic Overview for this Snapshot.
          </p>
        </div>
        {mode === "saved" ? (
          <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
            Saved AI result · Run {displayedResult.runId}
          </p>
        ) : null}
      </AiSlotFrame>
    );
  }

  return (
    <AiSlotFrame>
      <div className="space-y-4" aria-label="AI energy analyst findings">
        {displayedResult.findings.map((finding) => (
          <AiFindingCard
            key={finding.id}
            finding={finding}
            projectId={input.projectId}
            aiAnalystHref={aiAnalystHref}
          />
        ))}
      </div>
      {mode === "saved" ? (
        <p className="mt-3 text-[10px] font-medium text-muted" data-saved-ai-result="true">
          Saved AI result · Run {displayedResult.runId}
        </p>
      ) : null}
      <details className="mt-4 text-xs leading-5 text-muted-light">
        <summary className="cursor-pointer font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          AI analysis data details
        </summary>
        <p className="mt-1">
          AI suggestions use Snapshot {input.snapshotId} through {input.dataCutoff}. Verified KPIs and Evidence remain authoritative.
        </p>
      </details>
    </AiSlotFrame>
  );
}

function progressLabel(progress: NgeeAnnAiProgress): string {
  switch (progress) {
    case "querying":
      return "Querying Snapshot…";
    case "drafting":
      return "Drafting findings…";
    default:
      return "Inspecting scoped data…";
  }
}

function AiSlotFrame({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="ngee-ann-ai-slot" className="border-b border-border bg-surface px-5 py-5 lg:px-7 lg:py-6">
      <div className="mb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="ngee-ann-ai-slot" className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              AI analyst briefing
            </h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">
              AI-generated
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            What stands out, why it matters, and what to check next.
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function AiUnavailable({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
      <p className="text-xs font-semibold text-foreground">AI analysis unavailable</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-light">The deterministic Overview remains available and unchanged.</p>
    </div>
  );
}

function AiFindingCard({
  finding,
  projectId,
  aiAnalystHref,
}: {
  finding: NgeeAnnAiFinding;
  projectId: string;
  aiAnalystHref?: string;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeDialog = useCallback(() => {
    setEvidenceOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!evidenceOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDialog, evidenceOpen]);

  const askAiHref = aiAnalystHref
    ? buildAskAiDeeperHref(aiAnalystHref, projectId, finding)
    : null;

  return (
    <article className="min-w-0 rounded-xl border border-border bg-surface px-5 py-5 lg:px-6 lg:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="max-w-5xl text-lg font-semibold leading-7 tracking-[-0.015em] text-foreground">{finding.title}</h4>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${relationshipTone(finding.relationship)}`}>
            {relationshipSummary(finding.relationship)}
          </span>
          {finding.horizons.map((horizon) => (
            <span key={horizon} className="rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-xs font-medium text-muted">
              {horizonLabel(horizon)}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5" data-ai-primary-takeaway="true">
        <p className="text-xs font-semibold text-muted">What the data shows</p>
        <p className="mt-1.5 max-w-[75ch] text-base font-semibold leading-7 text-foreground">{finding.what}</p>
      </div>

      <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-muted">Why this matters</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${whyKindTone(finding.why.kind)}`}>
              {whyKindLabel(finding.why.kind)}
            </span>
          </div>
          <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-foreground/80">{finding.why.text}</p>
        </div>
        <div className="rounded-xl bg-primary px-5 py-4 text-white" data-ai-primary-action="true">
          <p className="text-xs font-semibold text-white/70">Recommended next check</p>
          <p className="mt-1.5 text-base font-semibold leading-6">{finding.how}</p>
        </div>
      </div>

      <AiFindingPresentationView presentation={finding.presentation} />

      <details className="mt-5 border-t border-border pt-4" data-ai-secondary-details="true">
        <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Verification and limitations
        </summary>
        <dl className="mt-4 grid gap-5 text-sm leading-6 sm:grid-cols-2">
          <FindingDetail label="How to verify" text={finding.howToVerify} />
          <FindingDetail label="What to keep in mind" text={finding.evidenceNote} />
        </dl>
      </details>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setEvidenceOpen(true)}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        >
          View evidence
        </button>
        {askAiHref ? (
          <a
            href={askAiHref}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-white transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2"
          >
            Ask the advisor
            <EnergyIcon name="arrow" className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      {evidenceOpen ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${finding.id}-evidence-title`}
            tabIndex={-1}
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">Finding Evidence</p>
                <h4 id={`${finding.id}-evidence-title`} className="mt-1 text-base font-semibold text-foreground">{finding.title}</h4>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDialog}
                className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-[11px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                Close
              </button>
            </div>
            <dl className="mt-4 grid gap-2 text-[11px] sm:grid-cols-2">
              <EvidencePin label="Snapshot" value={finding.evidence.snapshotId} mono />
              <EvidencePin label="Data cutoff" value={finding.evidence.dataCutoff} />
              <EvidencePin label="Horizon" value={finding.horizons.join(" / ")} />
              <EvidencePin label="Relationship" value={relationshipLabel(finding.relationship)} />
              <EvidencePin label="Quality scope" value="Deterministic Overview period" />
              <EvidencePin
                label="Quality period"
                value={`${finding.evidence.dataQuality.period.from} / ${finding.evidence.dataQuality.period.to}`}
                mono
              />
              <EvidencePin label="Data quality" value={titleCase(finding.evidence.dataQuality.status)} />
              <EvidencePin label="Coverage" value={`${finding.evidence.dataQuality.coveragePct.toLocaleString("en-SG")}%`} />
              <EvidencePin
                label="Valid intervals"
                value={`${finding.evidence.dataQuality.validIntervalCount.toLocaleString("en-SG")} / ${finding.evidence.dataQuality.expectedMeterIntervalCount.toLocaleString("en-SG")}`}
              />
              <EvidencePin label="Quality events" value={finding.evidence.dataQuality.qualityEventCount.toLocaleString("en-SG")} />
            </dl>
            <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-3" role="note">
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light">Data-quality limitation</p>
              <p className="mt-1 text-xs leading-5 text-muted">{finding.evidence.dataQuality.limitation}</p>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light">Evidence note</p>
              <p className="mt-1 text-xs leading-5 text-muted">{finding.evidenceNote}</p>
            </div>
            {finding.evidence.deterministic.length > 0 ? (
              <div className="mt-4 space-y-3" aria-label="Deterministic Snapshot Evidence">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                  Deterministic Snapshot Evidence
                </p>
                {finding.evidence.deterministic.map((item) => (
                  <section key={item.id} className="rounded-lg border border-border p-4" aria-label={`Deterministic Evidence ${item.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-foreground">{item.label}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted-light">{item.id}</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {titleCase(item.kind)}
                      </span>
                    </div>
                    <p className="mt-2 text-[10px] text-muted-light">
                      {item.period === "primary"
                        ? "Primary Period"
                        : item.period
                          ? `${item.period.from} / ${item.period.to}`
                          : "Not period-bound"}
                      {item.unit ? ` / ${item.unit}` : ""}
                    </p>
                    <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-subtle px-3 py-2 font-mono text-[10px] leading-5 text-muted">
                      {JSON.stringify(item.values, null, 2)}
                    </pre>
                    {item.queryIds.length > 0 ? (
                      <p className="mt-2 break-words font-mono text-[10px] text-muted-light">
                        Queries: {item.queryIds.join(" / ")}
                      </p>
                    ) : null}
                    {item.limitation ? (
                      <p className="mt-2 text-[10px] leading-4 text-muted">{item.limitation}</p>
                    ) : null}
                  </section>
                ))}
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              {finding.evidence.tools.map((tool, index) => (
                <section key={tool.toolCallId} className="rounded-lg border border-border p-4" aria-label={`SQL Evidence ${index + 1}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">SQL Evidence {index + 1}</p>
                    <p className="font-mono text-[10px] text-muted-light">{tool.toolCallId}</p>
                  </div>
                  {tool.sql ? (
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface-subtle p-3 font-mono text-[10px] leading-5 text-foreground">{tool.sql}</pre>
                  ) : null}
                  <p className="mt-2 text-[10px] text-muted-light">
                    {tool.rowCount === null ? "Rows unavailable" : `${tool.rowCount} rows`}
                    {tool.elapsedMs === null ? "" : ` / ${tool.elapsedMs} ms`}
                    {tool.auditLogId ? ` / Audit ${tool.auditLogId}` : ""}
                  </p>
                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface px-3 py-2 font-mono text-[10px] leading-5 text-muted">{tool.resultPreview}</pre>
                </section>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </article>
  );
}

function FindingDetail({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="font-semibold text-foreground">{label}</dt>
      <dd className="mt-1 text-muted">{text}</dd>
    </div>
  );
}

function EvidencePin({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-light">{label}</dt>
      <dd className={`${mono ? "break-all font-mono" : "break-words"} text-foreground`}>{value}</dd>
    </div>
  );
}

export function buildAskAiDeeperHref(
  baseHref: string,
  projectId: string,
  finding: NgeeAnnAiFinding,
): string | null {
  const url = new URL(baseHref, "https://energyiq.local");
  const params = url.searchParams;
  const baseProjectId = params.get("projectId");
  if (baseProjectId && baseProjectId !== projectId) return null;
  if (!baseProjectId) params.set("projectId", projectId);
  params.set("finding", JSON.stringify({
      title: finding.title,
      what: finding.what,
      why: finding.why,
      how: finding.how,
      howToVerify: finding.howToVerify,
    }));
  params.set("evidence", JSON.stringify({
      snapshotId: finding.evidence.snapshotId,
      dataCutoff: finding.evidence.dataCutoff,
      note: finding.evidenceNote,
      dataQuality: finding.evidence.dataQuality,
      deterministicEvidenceIds: finding.evidence.deterministic.map((item) => item.id),
      toolCallIds: finding.evidence.tools.map((tool) => tool.toolCallId),
      auditLogIds: finding.evidence.tools.flatMap((tool) => tool.auditLogId ? [tool.auditLogId] : []),
    }));
  return `${url.pathname}?${params.toString()}`;
}

function relationshipLabel(relationship: NgeeAnnAiRelationship): string {
  if (relationship === "supports") return "Supports";
  if (relationship === "challenges") return "Challenges";
  return "Independent";
}

function relationshipTone(relationship: NgeeAnnAiRelationship): string {
  if (relationship === "supports") return "bg-step-success/10 text-step-success";
  if (relationship === "challenges") return "bg-step-warning/10 text-step-warning";
  return "bg-primary/10 text-primary";
}

function relationshipSummary(relationship: NgeeAnnAiRelationship): string {
  if (relationship === "supports") return "Reinforces a known issue";
  if (relationship === "challenges") return "Challenges the current view";
  return "New investigation angle";
}

function horizonLabel(horizon: NgeeAnnAiFinding["horizons"][number]): string {
  if (horizon === "1d") return "Latest day";
  if (horizon === "7d") return "Recent 7 days";
  return "Rolling 28 days";
}

function whyKindLabel(kind: NgeeAnnAiFinding["why"]["kind"]): string {
  if (kind === "Evidence") return "Evidence-backed";
  if (kind === "Hypothesis") return "Hypothesis";
  return "Needs more evidence";
}

function whyKindTone(kind: NgeeAnnAiFinding["why"]["kind"]): string {
  if (kind === "Evidence") return "bg-step-success-soft text-step-success";
  if (kind === "Hypothesis") return "bg-step-warning-soft text-step-warning";
  return "bg-surface-subtle text-muted";
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
