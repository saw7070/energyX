"use client";

import React, { useEffect, useMemo, useState } from "react";

import {
  configApi,
  type EnergyAdditionalInsightEvaluationSummaryDto,
  type EnergyAdditionalInsightTransitionSummaryDto,
} from "../../../lib/config-api";

export type PreschoolSnapshotTransitionPin = {
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  from: string;
  to: string;
};

export type PreschoolAdditionalEvaluationAdminClient = {
  listEvaluations(projectId: string): Promise<EnergyAdditionalInsightEvaluationSummaryDto[]>;
  listTransitions(projectId: string): Promise<EnergyAdditionalInsightTransitionSummaryDto[]>;
  createTransition(input: {
    projectId: string;
    body: PreschoolSnapshotTransitionPin & {
      idempotencyKey: string;
      previousEvaluationId: string;
      previousAttemptId: string;
    };
  }): Promise<EnergyAdditionalInsightTransitionSummaryDto>;
  getTransition(projectId: string, transitionId: string): Promise<EnergyAdditionalInsightTransitionSummaryDto>;
  publishEvaluation(
    projectId: string,
    evaluationId: string,
    expectedRevision: number,
  ): Promise<EnergyAdditionalInsightEvaluationSummaryDto>;
};

const configApiClient: PreschoolAdditionalEvaluationAdminClient = {
  listEvaluations: (projectId) => configApi.listEnergyAdditionalInsightEvaluations(projectId)
    .then(({ evaluations }) => evaluations),
  listTransitions: (projectId) => configApi.listEnergyAdditionalInsightTransitions(projectId)
    .then(({ transitions }) => transitions),
  createTransition: ({ projectId, body }) => configApi.createEnergyAdditionalInsightTransition(projectId, body),
  getTransition: (projectId, transitionId) => configApi.getEnergyAdditionalInsightTransition(projectId, transitionId),
  publishEvaluation: (projectId, evaluationId, expectedRevision) => (
    configApi.publishEnergyAdditionalInsightEvaluation(projectId, evaluationId, expectedRevision)
  ),
};

export function PreschoolAdditionalEvaluationAdmin({
  projectId,
  initialPin,
  client = configApiClient,
}: {
  projectId: string;
  initialPin: PreschoolSnapshotTransitionPin | null;
  client?: PreschoolAdditionalEvaluationAdminClient;
}) {
  const [evaluations, setEvaluations] = useState<EnergyAdditionalInsightEvaluationSummaryDto[]>([]);
  const [transitions, setTransitions] = useState<EnergyAdditionalInsightTransitionSummaryDto[]>([]);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<string>("");
  const [state, setState] = useState<"loading" | "ready" | "running" | "publishing" | "error">("loading");

  useEffect(() => {
    let active = true;
    setState("loading");
    void Promise.all([
      client.listEvaluations(projectId),
      client.listTransitions(projectId),
    ]).then(([loadedEvaluations, loadedTransitions]) => {
      if (!active) return;
      setEvaluations(loadedEvaluations);
      setTransitions(loadedTransitions);
      setSelectedEvaluationId(
        loadedEvaluations.find(isApprovedBaseline)?.evaluationId ?? "",
      );
      setState("ready");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [client, projectId]);

  const approved = useMemo(
    () => evaluations.filter(isApprovedBaseline),
    [evaluations],
  );
  const selected = approved.find(({ evaluationId }) => evaluationId === selectedEvaluationId)
    ?? approved[0]
    ?? null;

  const compare = async () => {
    if (!selected?.approval || !initialPin) return;
    setState("running");
    try {
      let result = await client.createTransition({
        projectId,
        body: {
          idempotencyKey: `overview-ab:${selected.evaluationId}:${initialPin.dataSnapshotId}`,
          previousEvaluationId: selected.evaluationId,
          previousAttemptId: selected.approval.selectedAttemptId,
          ...initialPin,
        },
      });
      if (result.status === "running") {
        result = await waitForTransition(client, projectId, result.transitionId);
      }
      setTransitions((current) => [result, ...current.filter(({ transitionId }) => transitionId !== result.transitionId)]);
      setState(result.status === "failed" ? "error" : "ready");
    } catch {
      setState("error");
    }
  };

  const publish = async () => {
    if (!selected || selected.publication || !initialPin || !isCurrentEvaluation(selected, initialPin)) return;
    setState("publishing");
    try {
      const published = await client.publishEvaluation(projectId, selected.evaluationId, 0);
      setEvaluations((current) => current.map((evaluation) => (
        evaluation.evaluationId === published.evaluationId ? published : evaluation
      )));
      setState("ready");
    } catch {
      setState("error");
    }
  };

  return (
    <section aria-labelledby="snapshot-ab-heading" className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="snapshot-ab-heading" className="text-lg font-semibold text-foreground">Snapshot A/B comparison</h2>
          <span className="rounded-full bg-step-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-step-warning">
            Admin preview
          </span>
        </div>
        <p className="mt-1 max-w-[75ch] text-sm leading-6 text-muted">
          Re-run Additional AI Insights on the current Snapshot B, then compare them with an approved Snapshot A baseline.
          The comparison never changes the published Overview automatically.
        </p>
      </div>

      {state === "loading" ? <p role="status" className="text-sm text-muted">Loading approved A baselines…</p> : null}
      {state === "running" ? <p role="status" className="text-sm font-medium text-primary">Generating B and comparing Evidence…</p> : null}
      {state === "publishing" ? <p role="status" className="text-sm font-medium text-primary">Publishing the approved result without another AI run…</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-step-error">The requested operation did not complete. No published result was changed.</p> : null}

      {state !== "loading" && approved.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-subtle p-4 text-sm text-muted">
          No approved A baseline is available. Complete a pass@3 blind review before starting A/B comparison.
        </p>
      ) : null}

      {selected ? (
        <div className="flex flex-wrap gap-2 text-xs font-semibold" aria-label="Evaluation governance state">
          <StatePill label="Review complete" tone="success" />
          <StatePill label="Approved candidate" tone="success" />
          {selected.publication ? (
            <StatePill label="Published" tone="success" />
          ) : initialPin && !isCurrentEvaluation(selected, initialPin) ? (
            <StatePill label="Out of date" tone="warning" />
          ) : (
            <StatePill label="Not published" tone="neutral" />
          )}
        </div>
      ) : null}

      {selected ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <SnapshotCard label="A · approved baseline" snapshotId={selected.target.dataSnapshotId} period={selected.target.analysisPeriod} />
          {initialPin ? (
            <SnapshotCard label="B · current Overview" snapshotId={initialPin.dataSnapshotId} period={{ from: initialPin.from, to: initialPin.to }} />
          ) : (
            <div className="rounded-lg border border-step-warning/30 bg-step-warning-soft p-4 text-sm text-muted">
              Open this lab from the Preschool Overview so Snapshot B and its period are pinned automatically.
            </div>
          )}
        </div>
      ) : null}

      {approved.length > 1 ? (
        <label className="block max-w-xl text-xs font-semibold text-muted">
          Approved A baseline
          <select
            value={selected?.evaluationId ?? ""}
            onChange={(event) => setSelectedEvaluationId(event.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          >
            {approved.map((evaluation) => (
              <option key={evaluation.evaluationId} value={evaluation.evaluationId}>
                {evaluation.target.dataSnapshotId} · {formatPeriod(evaluation.target.analysisPeriod)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selected && initialPin ? (
        <div className="flex flex-wrap gap-2">
          {!selected.publication && isCurrentEvaluation(selected, initialPin) ? (
            <button
              type="button"
              disabled={state === "publishing"}
              onClick={() => void publish()}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              Publish to current Overview
            </button>
          ) : null}
          <button
            type="button"
            disabled={state === "running" || state === "publishing"}
            onClick={() => void compare()}
            className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-60"
          >
            Compare A with current B
          </button>
        </div>
      ) : null}

      {transitions.length > 0 ? (
        <div className="space-y-3" aria-label="Snapshot A/B comparison history">
          <h3 className="text-sm font-semibold text-foreground">Comparison results</h3>
          {transitions.map((transition) => <TransitionResult key={transition.transitionId} transition={transition} />)}
        </div>
      ) : null}
    </section>
  );
}

function SnapshotCard({
  label,
  snapshotId,
  period,
}: {
  label: string;
  snapshotId: string;
  period: { from: string; to: string };
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</p>
      <p className="mt-2 break-all font-mono text-xs text-foreground">{snapshotId}</p>
      <p className="mt-1 text-xs text-muted">{formatPeriod(period)}</p>
    </div>
  );
}

function TransitionResult({ transition }: { transition: EnergyAdditionalInsightTransitionSummaryDto }) {
  if (transition.status === "running") {
    return <p className="rounded-lg border border-border bg-surface-subtle p-4 text-sm text-muted">Comparison is still running.</p>;
  }
  if (transition.status === "failed") {
    return <p className="rounded-lg border border-step-error/30 bg-step-error-soft p-4 text-sm text-step-error">Comparison failed at {transition.failureStage ?? "an unknown stage"}.</p>;
  }
  const counts = transition.outcomeCounts;
  return (
    <article className="rounded-lg border border-border bg-surface-subtle p-4">
      <p className="text-sm font-semibold text-foreground">A → B completed</p>
      <p className="mt-1 break-all text-xs text-muted">{transition.previousSnapshotId} → {transition.currentSnapshotId}</p>
      {counts ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <OutcomePill label="New" count={counts.new} />
          <OutcomePill label="Changed" count={counts.changed} />
          <OutcomePill label="Still supported" count={counts["still-supported"]} />
          <OutcomePill label="Resolved" count={counts.resolved} />
          <OutcomePill label="No material change" count={counts["no-material-change"]} />
        </div>
      ) : null}
    </article>
  );
}

function OutcomePill({ label, count }: { label: string; count: number }) {
  return <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-foreground">{label} {count}</span>;
}

function StatePill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "neutral";
}) {
  const className = tone === "success"
    ? "border-step-success/30 bg-step-success-soft text-step-success"
    : tone === "warning"
      ? "border-step-warning/30 bg-step-warning-soft text-step-warning"
      : "border-border bg-surface-subtle text-muted";
  return <span className={`rounded-full border px-2.5 py-1 ${className}`}>{label}</span>;
}

const isCurrentEvaluation = (
  evaluation: EnergyAdditionalInsightEvaluationSummaryDto,
  pin: PreschoolSnapshotTransitionPin,
): boolean => evaluation.target.dataSnapshotId === pin.dataSnapshotId
  && evaluation.target.projectReleaseId === pin.projectReleaseId
  && evaluation.target.analysisPeriod.from === pin.from
  && evaluation.target.analysisPeriod.to === pin.to;

function isApprovedBaseline(
  evaluation: EnergyAdditionalInsightEvaluationSummaryDto,
): evaluation is EnergyAdditionalInsightEvaluationSummaryDto & { approval: NonNullable<EnergyAdditionalInsightEvaluationSummaryDto["approval"]> } {
  return evaluation.status === "approved-candidate" && Boolean(evaluation.approval?.selectedAttemptId);
}

function formatPeriod(period: { from: string; to: string }): string {
  return `${period.from.slice(0, 10)} → ${period.to.slice(0, 10)}`;
}

async function waitForTransition(
  client: PreschoolAdditionalEvaluationAdminClient,
  projectId: string,
  transitionId: string,
): Promise<EnergyAdditionalInsightTransitionSummaryDto> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const current = await client.getTransition(projectId, transitionId);
    if (current.status !== "running") return current;
  }
  throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_POLL_TIMEOUT");
}
