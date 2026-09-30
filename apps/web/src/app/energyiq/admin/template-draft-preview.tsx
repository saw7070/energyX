"use client";

import { useEffect, useState } from "react";

import { configApi, type EnergyScopeAnalysisDto } from "../../../lib/config-api";
import {
  type EnergyTemplateRendererState,
} from "../_components/energy-template-renderer";
import { EnergySelect } from "../_components/energy-select";
import { ProjectRenderer } from "../_components/project-renderer-registry";
import {
  buildTemplatePreviewRequest,
  type EnergyPreviewRange,
  type TemplatePreviewPlan,
} from "./template-draft-preview-model";

type PreviewPeriod = "Available facts" | "Yesterday" | "Last 7 days" | "Last 30 days" | "Custom";

export function TemplateDraftPreview({
  projectId,
  plan,
  previewRange,
  dirty,
  fixedIdentity,
}: {
  projectId: string;
  plan: TemplatePreviewPlan;
  previewRange: EnergyPreviewRange | null;
  dirty: boolean;
  fixedIdentity?: {
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
  };
}) {
  const [scopeId, setScopeId] = useState(plan.recommendedScopeId);
  const requestScopeId = fixedIdentity?.scopeId ?? scopeId;
  const [period, setPeriod] = useState<PreviewPeriod>(previewRange ? "Available facts" : "Last 30 days");
  const [customFrom, setCustomFrom] = useState(previewRange?.fromDate ?? "");
  const [customTo, setCustomTo] = useState(previewRange?.toDate ?? "");
  const [submittedRequest, setSubmittedRequest] = useState(() => buildTemplatePreviewRequest({
    projectId,
    scopeId: requestScopeId,
    period,
    previewRange,
    customFrom,
    customTo,
    fixedIdentity,
  }));
  const [analysis, setAnalysis] = useState<EnergyScopeAnalysisDto | null>(null);
  const [loading, setLoading] = useState(Boolean(submittedRequest));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!submittedRequest) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void configApi.executeEnergyScopeAnalysis(submittedRequest)
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch((reason) => {
        if (cancelled) return;
        setAnalysis(null);
        setError(reason instanceof Error ? reason.message : "Unable to run Draft Preview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [submittedRequest]);

  const nextRequest = buildTemplatePreviewRequest({
    projectId,
    scopeId: requestScopeId,
    period,
    previewRange,
    customFrom,
    customTo,
    fixedIdentity,
  });
  const renderedAnalysis = analysis?.context.projectId === projectId ? analysis : null;
  const rendererState = resolveDraftPreviewRendererState({
    scopeCount: plan.scopes.length,
    loading,
    error,
    analysis: renderedAnalysis,
    plan,
  });

  return (
    <div className="min-w-0 border-t border-border bg-background/40 p-4 sm:p-5 xl:border-t-0">
      <div className="rounded-xl border border-border bg-background p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-sm font-semibold">Draft Preview</h5>
              <span className="rounded-full bg-step-warning/10 px-2 py-0.5 text-[9px] font-semibold text-step-warning">ADMIN ONLY</span>
              {dirty ? <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[9px] font-semibold text-muted">Unsaved layout</span> : null}
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-4 text-muted">
              Run the current {plan.label} against a real scope and period. This does not publish a Template Revision or create an Analysis Run.
            </p>
          </div>
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[9px] font-semibold text-muted">{plan.modules.length} enabled modules</span>
        </div>

        <div className="mt-4 grid gap-3 rounded-lg bg-surface-subtle p-3 md:grid-cols-[minmax(160px,0.8fr)_minmax(180px,1fr)_auto] md:items-end">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Preview scope
            <EnergySelect
              ariaLabel="Preview scope"
              value={scopeId}
              options={plan.scopes.map((scope) => ({ value: scope.id, label: `${scope.name} · ${scope.detail}` }))}
              onValueChange={setScopeId}
              disabled={Boolean(fixedIdentity)}
              className="mt-1.5 w-full"
              size="small"
            />
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Analysis period
            <EnergySelect
              ariaLabel="Analysis period"
              value={period}
              options={[
                { value: "Available facts", label: `Available fact range${previewRange ? ` · ${previewRange.label}` : " · unavailable"}`, disabled: !previewRange },
                { value: "Yesterday", label: "Yesterday" },
                { value: "Last 7 days", label: "Last 7 days" },
                { value: "Last 30 days", label: "Last 30 days" },
                { value: "Custom", label: "Custom dates" },
              ]}
              onValueChange={(nextPeriod) => setPeriod(nextPeriod as PreviewPeriod)}
              className="mt-1.5 w-full"
              size="small"
            />
          </div>
          <button type="button" disabled={!nextRequest || loading || plan.scopes.length === 0} onClick={() => setSubmittedRequest(nextRequest)} className="h-9 rounded-md bg-foreground px-4 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40">
            {loading ? "Running..." : "Run preview"}
          </button>
        </div>

        {period === "Custom" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground" /></label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">To, inclusive<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground" /></label>
          </div>
        ) : null}

        <div className="mt-5">
          {rendererState.status === "ready" ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-light">
              <span>{rendererState.analysis.context.scopeName} · {formatPeriod(rendererState.analysis)} · {rendererState.analysis.summary.usageKwh.toLocaleString("en-SG", { maximumFractionDigits: 2 })} kWh</span>
              <span className="font-mono">{rendererState.analysis.provenance.dataSnapshotId}</span>
            </div>
          ) : null}
          <ProjectRenderer
            request={{ mode: "admin-preview" }}
            state={rendererState}
            onRetry={nextRequest ? () => setSubmittedRequest(nextRequest) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function resolveDraftPreviewRendererState(input: {
  scopeCount: number;
  loading: boolean;
  error: string | null;
  analysis: EnergyScopeAnalysisDto | null;
  plan: TemplatePreviewPlan;
}): EnergyTemplateRendererState {
  if (input.scopeCount === 0) {
    return { status: "empty", title: "No preview scope is available", detail: "Create at least one node in this Tier before previewing its shared template." };
  }
  if (input.error) {
    return { status: "error", title: "Draft Preview is unavailable", detail: `${input.error} Retry the same Draft, Scope and period without publishing it.` };
  }
  if (input.loading) {
    return { status: "loading", title: "Resolving Draft Preview", detail: "Loading the selected Project, Scope, period and trusted facts. This does not create an Analysis Run." };
  }
  if (!input.analysis) {
    return { status: "empty", title: "Preview has not been run", detail: "Choose a Scope and period, then run the Draft Preview." };
  }
  return { status: "ready", analysis: input.analysis, plan: input.plan.renderPlan };
}

function formatPeriod(analysis: EnergyScopeAnalysisDto): string {
  const formatter = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: analysis.context.timezone });
  const from = formatter.format(new Date(analysis.context.from));
  const to = formatter.format(new Date(new Date(analysis.context.to).getTime() - 1));
  return `${from}–${to}`;
}
