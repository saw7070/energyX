"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  configApi,
  type EnergyProjectAiOperationsDto,
  type EnergyProjectAiRunDetailDto,
  type EnergyProjectAiRunSummaryDto,
} from "../../../lib/config-api";

export type ProjectAiOperationsClient = Pick<
  typeof configApi,
  "getEnergyProjectAiOperations" | "getEnergyProjectAiOperationsRun"
>;

export function ProjectAiOperations({
  projectId,
  client = configApi,
}: {
  projectId: string;
  client?: ProjectAiOperationsClient;
}) {
  const [state, setState] = useState<EnergyProjectAiOperationsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const pageGeneration = useRef(0);

  useEffect(() => {
    const generation = ++projectGeneration.current;
    detailGeneration.current += 1;
    pageGeneration.current += 1;
    let active = true;
    setLoading(true);
    setPageLoading(false);
    setError(null);
    setState(null);
    setDetailLoadingId(null);
    void client.getEnergyProjectAiOperations(projectId)
      .then((next) => {
        if (active && projectGeneration.current === generation && next.project.id === projectId) setState(next);
      })
      .catch((reason) => {
        if (active) setError(messageFrom(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, projectId]);

  const openTrace = async (actorId: string, runId: string) => {
    const identity = runIdentity({ actorId, runId });
    const activeProjectGeneration = projectGeneration.current;
    const generation = ++detailGeneration.current;
    setDetailLoadingId(identity);
    setError(null);
    try {
      const detail = await client.getEnergyProjectAiOperationsRun(projectId, actorId, runId);
      if (projectGeneration.current !== activeProjectGeneration
        || detailGeneration.current !== generation
        || detail.project.id !== projectId
        || !detail.selectedRun
        || runIdentity(detail.selectedRun) !== identity) return;
      setState((current) => current && current.project.id === projectId ? {
        ...detail,
        runs: current.runs,
        pagination: current.pagination,
      } : current);
    } catch (reason) {
      if (projectGeneration.current === activeProjectGeneration && detailGeneration.current === generation) {
        setError(messageFrom(reason));
      }
    } finally {
      if (projectGeneration.current === activeProjectGeneration && detailGeneration.current === generation) {
        setDetailLoadingId(null);
      }
    }
  };

  const loadOlder = async () => {
    const cursor = state?.pagination.nextCursor;
    if (!cursor) return;
    const activeProjectGeneration = projectGeneration.current;
    const generation = ++pageGeneration.current;
    setPageLoading(true);
    setError(null);
    try {
      const next = await client.getEnergyProjectAiOperations(projectId, { cursor });
      if (projectGeneration.current !== activeProjectGeneration
        || pageGeneration.current !== generation
        || next.project.id !== projectId) return;
      setState((current) => current && current.project.id === projectId ? {
        ...current,
        runs: [...current.runs, ...next.runs.filter((run) => (
          !current.runs.some((existing) => runIdentity(existing) === runIdentity(run))
        ))],
        pagination: next.pagination,
      } : current);
    } catch (reason) {
      if (projectGeneration.current === activeProjectGeneration && pageGeneration.current === generation) {
        setError(messageFrom(reason));
      }
    } finally {
      if (projectGeneration.current === activeProjectGeneration && pageGeneration.current === generation) {
        setPageLoading(false);
      }
    }
  };

  if (loading && !state) {
    return (
      <section className="mx-auto min-h-40 max-w-6xl rounded-xl border border-border bg-surface p-6" role="status">
        <h2 className="text-lg font-semibold text-foreground">AI Operations</h2>
        <p className="mt-2 text-sm text-muted">Loading persisted Project Runs…</p>
      </section>
    );
  }

  if (!state) {
    return (
      <section className="mx-auto max-w-6xl rounded-xl border border-step-error/25 bg-surface p-6" role="status">
        <h2 className="text-lg font-semibold text-foreground">AI Operations</h2>
        <p className="mt-2 text-sm text-step-error">{error ?? "AI Operations are unavailable."}</p>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="ai-operations-heading">
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Historical Run evidence</p>
            <h2 id="ai-operations-heading" className="mt-2 text-xl font-semibold text-foreground">AI Operations</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              {state.project.name} · persisted execution evidence for the exact Project. Open a Run to inspect only what that Run recorded.
            </p>
          </div>
          <span className="rounded-full bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-muted">
            {state.runs.length} {state.runs.length === 1 ? "Run" : "Runs"} shown
          </span>
        </div>
        <div className="border-t border-border bg-surface-subtle px-6 py-4">
          <p className="text-sm leading-6 text-muted">
            Current Harness configuration is never substituted for missing historical evidence. Prompts, Tool arguments and Tool results are not exposed here.
          </p>
        </div>
      </section>

      {error ? <p className="rounded-xl border border-step-error/25 bg-surface px-5 py-4 text-sm text-step-error" role="status">{error}</p> : null}

      <section className="rounded-xl border border-border bg-surface p-6" aria-labelledby="project-runs-heading">
        <h3 id="project-runs-heading" className="text-lg font-semibold text-foreground">Project Runs</h3>
        <p className="mt-2 text-sm leading-6 text-muted">
          Newest persisted Runs across actors in this exact Project. Pages contain up to {state.pagination.limit} Runs.
        </p>
        {state.runs.length > 0 ? (
          <div className="mt-5 space-y-3">
            {state.runs.map((run) => (
              <RunRow
                key={runIdentity(run)}
                run={run}
                loading={detailLoadingId === runIdentity(run)}
                selected={state.selectedRun ? runIdentity(state.selectedRun) === runIdentity(run) : false}
                onOpen={() => void openTrace(run.actorId, run.runId)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-border px-5 py-6">
            <p className="text-sm font-semibold text-foreground">No persisted Runs are available for this Project.</p>
            <p className="mt-2 text-sm leading-6 text-muted">Current Harness configuration is not used to fill this gap.</p>
          </div>
        )}
        {state.pagination.hasMore ? (
          <button
            type="button"
            onClick={() => void loadOlder()}
            disabled={pageLoading}
            className="mt-5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:opacity-50"
          >
            {pageLoading ? "Loading older Runs…" : "Load older Runs"}
          </button>
        ) : null}
      </section>

      {state.selectedRun ? <RunTrace run={state.selectedRun} /> : null}
    </div>
  );
}

function RunRow({
  run,
  loading,
  selected,
  onOpen,
}: {
  run: EnergyProjectAiRunSummaryDto;
  loading: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <article className={["rounded-xl border p-4", selected ? "border-primary/40 bg-primary/5" : "border-border"].join(" ")}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[180px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-foreground">{run.stage ? humanize(run.stage) : "Open trace to load"}</h4>
            <StatusBadge status={run.status} />
            <TraceBadge availability={run.traceAvailability} />
          </div>
          <p className="mt-2 text-xs text-muted">{formatTimestamp(run.startedAt)} · {latencyLabel(run.latencyMs)}</p>
        </div>
        <dl className="grid min-w-[280px] flex-[2] grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fact label="Model" value={run.modelName ?? "Unavailable"} />
          <Fact label="Tokens" value={run.inputTokens === null || run.outputTokens === null
            ? "Open trace to load"
            : `${formatNumber(run.inputTokens + run.outputTokens)} tokens`} />
          <Fact label="Tools" value={run.toolCounts === null ? "Open trace to load" : `${run.toolCounts.succeeded} succeeded`} />
          <Fact label="Failures" value={run.errorCode ?? (run.toolCounts === null
            ? "Open trace to load"
            : String(run.toolCounts.failed + run.toolCounts.rejected))} />
        </dl>
        <button
          type="button"
          onClick={onOpen}
          disabled={loading}
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:opacity-50"
        >
          {loading ? "Loading trace…" : selected ? "Refresh trace" : "View trace"}
        </button>
      </div>
      <TechnicalDetails rows={[
        ["Run", run.runId],
        ["Session", run.sessionId],
        ["Actor", run.actorId],
        ["Provider", run.modelProvider ?? "Unavailable"],
        ["Parent Run", run.parentRunId ?? "None"],
      ]} />
    </article>
  );
}

function RunTrace({ run }: { run: EnergyProjectAiRunDetailDto }) {
  const config = run.historicalConfiguration;
  const materializedSkills = config.materializedSkills ?? { status: "unavailable" as const, items: [] };
  return (
    <section className="space-y-5" aria-labelledby="run-trace-heading">
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Exact Run trace</p>
        <h3 id="run-trace-heading" className="mt-2 text-lg font-semibold text-foreground">Historical effective configuration</h3>
        <p className="mt-2 text-sm leading-6 text-muted">{config.detail}</p>
        <p className="mt-2 text-sm font-medium text-foreground">Current configuration changes never rewrite this trace.</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <EvidenceBlock title="Selected for Run" status={config.status}>
            {config.selectedSkills.length > 0 ? (
              <ul className="space-y-2">
                {config.selectedSkills.map((skill) => (
                  <li key={`${skill.id}:${skill.revision}`} className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-foreground">
                    {skill.name} · revision {skill.revision}
                  </li>
                ))}
              </ul>
            ) : <Unavailable>Skill selection was not persisted for this Run.</Unavailable>}
            <p className="mt-3 text-xs text-muted">
              Audit: {config.selectionAudit.selected} selected · {config.selectionAudit.rejected} rejected · {config.selectionAudit.unavailable} unavailable
            </p>
          </EvidenceBlock>
          <EvidenceBlock title="Actually materialized" status={materializedSkills.status}>
            {materializedSkills.status === "available" ? (
              materializedSkills.items.length > 0 ? (
                <ul className="space-y-2">
                  {materializedSkills.items.map((skill) => (
                    <li key={`${skill.id}:${skill.revision ?? "unknown"}`} className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-foreground">
                      {humanize(skill.id)} · revision {skill.revision ?? "unavailable"}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">No Skill was materialized.</p>
            ) : <Unavailable>Materialized Skill evidence is unavailable for this Run.</Unavailable>}
            <p className="mt-3 text-xs text-muted">Materialized does not prove loaded or read.</p>
          </EvidenceBlock>
          <EvidenceBlock title="Loaded / read by Runtime" status={config.loadedSkills.status}>
            {config.loadedSkills.items.length > 0 ? (
              <ul className="space-y-2">
                {config.loadedSkills.items.map((skill, index) => (
                  <li key={`${skill.id}:${skill.revision ?? "unknown"}:${index}`} className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-foreground">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-semibold">
                        {skill.name ?? humanize(skill.id)} · {skill.semanticVersion ? `version ${skill.semanticVersion}` : `revision ${skill.revision ?? "unavailable"}`}
                      </span>
                      <span className={skill.evidenceStatus === "available" ? "text-xs font-semibold text-step-success" : "text-xs font-semibold text-step-warning"}>
                        {skill.evidenceStatus === "available" ? "Loaded for this Run" : "Evidence unavailable"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted">{skill.detail}</p>
                    <TechnicalDetails rows={[
                      ["Skill ID", skill.id],
                      ["Config revision", skill.revision === null ? "Unavailable" : String(skill.revision)],
                      ["Content SHA-256", skill.contentSha256 ?? "Unavailable"],
                      ["Package ref", skill.packageRef ?? "Unavailable"],
                      ["Owner scope", skill.ownerScope ?? "Unavailable"],
                      ["Owner user", skill.ownerUserId ?? "Unavailable"],
                      ["Owner workspace", skill.ownerWorkspaceId ?? "Unavailable"],
                      ["Load source", skill.loadSource ?? "Unavailable"],
                      ["Load stage", skill.loadStage ?? "Unavailable"],
                    ]} />
                  </li>
                ))}
              </ul>
            ) : config.loadedSkills.status === "available" ? (
              <p className="text-sm text-muted">No Skill load/read was recorded.</p>
            ) : <Unavailable>Load/read evidence is unavailable for this Run.</Unavailable>}
          </EvidenceBlock>
        </div>
        <div className="mt-4 rounded-xl border border-border p-4">
          <h4 className="text-sm font-semibold text-foreground">MCP evidence</h4>
          {config.mcp.serverToolMapping.status === "available" ? (
            <p className="mt-2 text-sm text-muted">
              {config.mcp.serverToolMapping.items.length > 0
                ? `${config.mcp.serverToolMapping.items.length} server-to-tool mappings were persisted.`
                : "No MCP server was enabled for this Run."}
            </p>
          ) : (
            <Unavailable>MCP server-to-tool mapping unavailable. Current manifest was not substituted.</Unavailable>
          )}
          <TechnicalDetails rows={[
            ["Model profile", config.modelProfileId ?? "Unavailable"],
            ["Resource revisions", recordLabel(config.resourceRevisions)],
            ["Enabled MCP servers", listOrNone(config.mcp.enabledServerIds)],
            ...config.mcp.serverToolMapping.items.map((item): [string, string] => [`MCP ${item.serverId}`, listOrNone(item.toolNames)]),
          ]} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <TracePanel title="Context plan" available={run.context.status === "available"}>
          {run.context.steps.length > 0 ? run.context.steps.map((step) => (
            <article key={step.stepNumber} className="rounded-lg border border-border p-4">
              <h5 className="text-sm font-semibold text-foreground">Step {step.stepNumber}</h5>
              <p className="mt-2 text-sm text-muted">
                {plural(step.selectedGroupCount, "selected group")} · {plural(step.omittedGroupCount, "omitted group")} · {plural(step.truncationDecisionCount, "truncation decision")}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <Fact label="Prompt tokens" value={nullableNumber(step.promptTokens)} />
                <Fact label="Input budget" value={nullableNumber(step.inputBudget)} />
                <Fact label="Context window" value={nullableNumber(step.contextWindow)} />
                <Fact label="Remaining" value={nullableNumber(step.remainingTokens)} />
              </dl>
              <TechnicalDetails rows={[
                ["Package", step.packageId ?? "Unavailable"],
                ["Package revision", step.packageRevision === null ? "Unavailable" : String(step.packageRevision)],
                ["Plan", step.planId ?? "Unavailable"],
                ["Selected source types", listOrNone(step.selectedSourceTypes)],
                ["Omitted source types", listOrNone(step.omittedSourceTypes)],
                ["Capability source", step.capabilitySource ?? "Unavailable"],
                ["High-water mark", step.highWaterMark ?? "Unavailable"],
              ]} />
            </article>
          )) : <Unavailable>Context composition was not persisted for this Run.</Unavailable>}
        </TracePanel>

        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold text-foreground">Model requests</h4>
            <span className={run.modelRequests.status === "available"
              ? "text-xs font-semibold text-step-success"
              : "text-xs font-semibold text-step-warning"}
            >
              {sentenceCase(run.modelRequests.status)}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">{run.modelRequests.detail}</p>
          <p className="mt-2 text-xs leading-5 text-muted">
            This proves the application-level request prepared at the Provider boundary. Raw Prompt content is not retained by default and is never exposed here.
          </p>
          {run.modelRequests.items.length > 0 ? (
            <div className="mt-4 space-y-3">
              {run.modelRequests.items.map((request, index) => (
                <article key={`${request.snapshotId ?? "missing"}:${index}`} className="rounded-lg border border-border p-4">
                  <h5 className="text-sm font-semibold text-foreground">
                    Request {request.stepNumber ?? index + 1} · {sentenceCase(request.reconstructionStatus)}
                  </h5>
                  <p className="mt-2 text-sm text-muted">
                    {request.modelName ?? "Model unavailable"} · {request.toolNames.length > 0
                      ? `${plural(request.toolNames.length, "active Tool")}: ${request.toolNames.map(humanize).join(", ")}`
                      : "No active Tool was recorded"}
                  </p>
                  <TechnicalDetails rows={[
                    ["Snapshot", request.snapshotId ?? "Unavailable"],
                    ["Content SHA-256", request.contentSha256 ?? "Unavailable"],
                    ["Context package", request.contextPackageId ?? "Unavailable"],
                    ["Context revision", request.contextPackageRevision === null ? "Unavailable" : String(request.contextPackageRevision)],
                    ["Retry", request.retryCount === null ? "Unavailable" : String(request.retryCount)],
                    ["Payload retention", request.payloadAvailability === "retained" ? "Retained" : "Not retained"],
                  ]} />
                </article>
              ))}
            </div>
          ) : <Unavailable>No Provider-boundary request event was persisted for this historical Run.</Unavailable>}
        </section>

        <TracePanel title="Tool calls" available={run.tools.length > 0}>
          {run.tools.length > 0 ? (
            <div className="space-y-2">
              {run.tools.map((tool) => (
                <article key={tool.toolCallId} className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                  <div>
                    <h5 className="text-sm font-semibold text-foreground">{humanize(tool.name)}</h5>
                    <p className="mt-1 text-xs text-muted">Arguments and result are redacted.</p>
                  </div>
                  <ToolStatus status={tool.status} />
                </article>
              ))}
            </div>
          ) : <Unavailable>No Tool call event was persisted for this Run.</Unavailable>}
        </TracePanel>

        <TracePanel title="Token usage" available={run.tokens.status === "available"}>
          {run.tokens.status === "available" && run.tokens.input !== null
            && run.tokens.output !== null && run.tokens.total !== null ? (
            <>
              <dl className="grid grid-cols-3 gap-3">
                <Metric label="Input" value={formatNumber(run.tokens.input)} />
                <Metric label="Output" value={formatNumber(run.tokens.output)} />
                <Metric label="Total" value={formatNumber(run.tokens.total)} />
              </dl>
              <p className="mt-4 text-sm text-muted">
                {run.tokens.cache.status === "available"
                  ? `Cache telemetry: ${formatNumber(run.tokens.cache.hit ?? 0)} hit · ${formatNumber(run.tokens.cache.miss ?? 0)} miss.`
                  : "Cache telemetry unavailable for this Run."}
              </p>
            </>
          ) : <Unavailable>Token usage evidence is unavailable for this Run.</Unavailable>}
        </TracePanel>

        <TracePanel title="Artifact & Finding lineage" available={run.lineage.artifacts.length + run.lineage.energyIqArtifacts.length > 0}>
          <p className="text-sm text-muted">
            {plural(run.lineage.artifacts.length, "generic artifact")} · {plural(run.lineage.energyIqArtifacts.length, "EnergyX artifact")} · {plural(run.lineage.energyIqArtifacts.reduce((count, artifact) => count + artifact.findingIds.length, 0), "Finding")}
          </p>
          <TechnicalDetails rows={[
            ...run.lineage.artifacts.map((artifact): [string, string] => [artifact.name, `${artifact.id} (${artifact.type})`]),
            ...run.lineage.energyIqArtifacts.map((artifact): [string, string] => [humanize(artifact.kind), `${artifact.id}; target ${artifact.targetId ?? "Unavailable"}; Findings ${listOrNone(artifact.findingIds)}`]),
          ]} />
        </TracePanel>
      </div>
    </section>
  );
}

function TracePanel({ title, available, children }: { title: string; available: boolean; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold text-foreground">{title}</h4>
        <span className={available ? "text-xs font-semibold text-step-success" : "text-xs font-semibold text-step-warning"}>
          {available ? "Available" : "Unavailable"}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EvidenceBlock({ title, status, children }: { title: string; status: "available" | "unavailable"; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <span className={status === "available" ? "text-xs font-semibold text-step-success" : "text-xs font-semibold text-step-warning"}>{sentenceCase(status)}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function TechnicalDetails({ rows }: { rows: Array<[string, string]> }) {
  return (
    <details className="mt-4 border-t border-border pt-3" data-ai-operations-technical>
      <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Technical IDs</summary>
      <dl className="mt-3 space-y-2">
        {rows.length > 0 ? rows.map(([label, value], index) => (
          <div key={`${label}:${index}`} className="grid gap-1 text-xs sm:grid-cols-[150px_minmax(0,1fr)]">
            <dt className="font-medium text-muted">{label}</dt>
            <dd className="break-all font-mono text-foreground">{value}</dd>
          </div>
        )) : <p className="text-xs text-muted">No technical lineage ID was persisted.</p>}
      </dl>
    </details>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium text-muted">{label}</dt><dd className="mt-1 truncate font-semibold text-foreground">{value}</dd></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-surface-subtle px-3 py-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-lg font-semibold text-foreground">{value}</dd></div>;
}

function StatusBadge({ status }: { status: EnergyProjectAiRunSummaryDto["status"] }) {
  const positive = status === "completed";
  const negative = status === "failed" || status === "canceled";
  return <span className={["rounded-full px-2.5 py-1 text-xs font-semibold", positive ? "bg-step-success/10 text-step-success" : negative ? "bg-step-error/10 text-step-error" : "bg-step-warning/10 text-step-warning"].join(" ")}>{sentenceCase(status)}</span>;
}

function TraceBadge({ availability }: { availability: EnergyProjectAiRunSummaryDto["traceAvailability"] }) {
  return <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-muted">{availability === "available" ? "Available trace" : availability === "partial" ? "Partial trace" : availability === "detail-required" ? "Open trace to load evidence" : "Trace unavailable"}</span>;
}

function ToolStatus({ status }: { status: EnergyProjectAiRunDetailDto["tools"][number]["status"] }) {
  const good = status === "succeeded";
  const bad = status === "failed" || status === "rejected";
  return <span className={["rounded-full px-2.5 py-1 text-xs font-semibold", good ? "bg-step-success/10 text-step-success" : bad ? "bg-step-error/10 text-step-error" : "bg-step-warning/10 text-step-warning"].join(" ")}>{sentenceCase(status)}</span>;
}

function Unavailable({ children }: { children: ReactNode }) {
  return <p className="mt-2 rounded-lg bg-step-warning/5 px-3 py-2 text-sm leading-6 text-muted">{children}</p>;
}

function recordLabel(value: Record<string, number>): string {
  const rows = Object.entries(value);
  return rows.length > 0 ? rows.map(([id, revision]) => `${id}@${revision}`).join(", ") : "Unavailable";
}

function nullableNumber(value: number | null): string {
  return value === null ? "Unavailable" : formatNumber(value);
}

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None";
}

function plural(value: number, label: string): string {
  return `${formatNumber(value)} ${label}${value === 1 ? "" : "s"}`;
}

function latencyLabel(value: number | null): string {
  return value === null ? "Latency unavailable" : `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)} s`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-SG").format(value);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
}

function sentenceCase(value: string): string {
  const normalized = value.replace(/-/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function humanize(value: string): string {
  return value.replace(/[._:@/-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error && reason.message.trim() ? reason.message : "AI Operations are unavailable.";
}

function runIdentity(run: Pick<EnergyProjectAiRunSummaryDto, "actorId" | "runId">): string {
  return `${run.actorId}\u0000${run.runId}`;
}
