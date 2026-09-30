"use client";

import { useEffect, useState } from "react";

import {
  configApi,
  type EnergyProjectOverviewAdminReadinessStatusDto,
  type EnergyProjectOverviewAdminStateDto,
  type EnergyProjectAiExplainabilityDto,
  type EnergyProjectAiMethodTraceDto,
  type EnergyAdditionalInsightCommentDto,
  type EnergyAdditionalInsightFeedbackDto,
} from "../../../lib/config-api";

export type ProjectOverviewAiReadinessClient = Pick<
  typeof configApi,
  "getEnergyProjectOverviewAdminState" | "generateMissingEnergyProjectOverviewAnalysis"
> & Partial<Pick<
  typeof configApi,
  | "getEnergyAdditionalInsightFeedback"
  | "putEnergyAdditionalInsightFeedback"
  | "listEnergyAdditionalInsightComments"
  | "appendEnergyAdditionalInsightComment"
  | "createEnergyInsightMethodProposal"
>>;

export function ProjectOverviewAiReadiness({
  projectId,
  client = configApi,
  variant = "full",
  onOpenFull,
}: {
  projectId: string;
  client?: ProjectOverviewAiReadinessClient;
  variant?: "summary" | "full";
  onOpenFull?: () => void;
}) {
  const [state, setState] = useState<EnergyProjectOverviewAdminStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void client.getEnergyProjectOverviewAdminState(projectId)
      .then((next) => {
        if (active) setState(next);
      })
      .catch((reason) => {
        if (active) setError(messageFrom(reason, "Failed to load Overview and AI readiness"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, projectId]);

  const generateMissing = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      setState(await client.generateMissingEnergyProjectOverviewAnalysis(projectId));
    } catch (reason) {
      setError(messageFrom(reason, "Failed to generate missing analysis"));
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !state) {
    return (
      <section className="min-h-36 rounded-xl border border-border bg-surface p-5" role="status" aria-live="polite">
        <h3 className="text-base font-semibold">AI Analysis readiness</h3>
        <p className="mt-3 text-sm text-muted">Restoring saved analysis status…</p>
      </section>
    );
  }

  if (!state) {
    return (
      <section className="rounded-xl border border-step-error/25 bg-surface p-5" role="status">
        <h3 className="text-base font-semibold">AI Analysis readiness</h3>
        <p className="mt-2 text-sm leading-6 text-step-error">{error ?? "Readiness is unavailable."}</p>
      </section>
    );
  }

  const hasGenerateAction = state.allowedActions.includes("generate-missing")
    && state.recommendedNextAction?.action === "generate-missing";

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby={`ai-readiness-${variant}`}>
      <div className="flex flex-wrap items-start justify-between gap-5 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`ai-readiness-${variant}`} className="text-base font-semibold">AI Analysis readiness</h3>
            {state.analysis.supported
              ? <ReadinessBadge status={state.analysis.status} />
              : <span className="inline-flex w-fit rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-muted">Not connected</span>}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{state.analysis.detail}</p>
          {state.analysis.supported ? (
            <p className="mt-2 text-sm font-semibold text-foreground">
              {state.analysis.readyCount} of {state.analysis.totalCount} ready
              {state.analysis.lastGeneratedAt ? <span className="font-normal text-muted"> · Last generated {formatTimestamp(state.analysis.lastGeneratedAt)}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenFull && variant === "summary" ? (
            <button type="button" onClick={onOpenFull} className={secondaryButton}>View AI Analysis</button>
          ) : null}
          {hasGenerateAction ? (
            <button
              type="button"
              disabled={generating}
              onClick={() => void generateMissing()}
              className={primaryButton}
            >
              {generating
                ? state.recommendedNextAction?.label === "Retry failed analysis"
                  ? "Retrying failed analysis…"
                  : "Generating missing analysis…"
                : state.recommendedNextAction?.label}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mx-5 mb-5 rounded-lg border border-step-error/25 bg-step-error/5 px-4 py-3 text-sm text-step-error" role="status">
          {error}
        </p>
      ) : null}

      {variant === "summary" ? (
        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          <ReadinessFact label="Customer Overview" value={STATUS_COPY[state.customerOverview.status]} />
          <ReadinessFact
            label="Saved AI analysis"
            value={state.analysis.supported ? `${state.analysis.readyCount}/${state.analysis.totalCount} ready` : "Not connected"}
          />
          <ReadinessFact
            label="Next action"
            value={state.recommendedNextAction?.label ?? readinessFallbackAction(state)}
          />
        </div>
      ) : state.analysis.supported ? (
        <div className="border-t border-border">
          <div className="divide-y divide-border" role="list" aria-label="AI analysis readiness items">
            {state.analysis.items.map((item) => (
              <div key={item.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(180px,0.8fr)_140px_minmax(0,1.6fr)] sm:items-center" role="listitem">
                <p className="text-sm font-semibold">{item.label}</p>
                <ReadinessBadge status={item.status} />
                <p className="text-sm leading-6 text-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-t border-border px-5 py-4 text-sm leading-6 text-muted">
          No Layer 1–3 status is shown because this Project has not adopted that analysis contract.
        </div>
      )}

      {variant === "full" && state.explainability ? (
        <AiExplainabilityPanel
          projectId={projectId}
          explainability={state.explainability}
          client={client}
        />
      ) : null}

      {variant === "full" && state.currentIdentity ? (
        <details className="border-t border-border px-5 py-4">
          <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-foreground">Technical details</summary>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <TechnicalDetail label="Data Snapshot" value={state.currentIdentity.dataSnapshotId} />
            <TechnicalDetail label="Project Release" value={state.currentIdentity.projectReleaseId} />
            <TechnicalDetail label="Analysis period" value={`${formatTimestamp(state.currentIdentity.analysisPeriod.from)} – ${formatTimestamp(state.currentIdentity.analysisPeriod.to)}`} />
            <TechnicalDetail label="Model profile revision" value={`r${state.currentIdentity.modelProfileRevision}`} />
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function AiExplainabilityPanel({
  projectId,
  explainability,
  client,
}: {
  projectId: string;
  explainability: EnergyProjectAiExplainabilityDto;
  client: ProjectOverviewAiReadinessClient;
}) {
  if (explainability.status === "unavailable") {
    return (
      <div className="border-t border-border px-5 py-5">
        <h4 className="text-sm font-semibold">AI trace unavailable</h4>
        <p className="mt-2 text-sm leading-6 text-muted">{explainability.detail}</p>
      </div>
    );
  }
  const artifact = explainability.currentArtifact;
  return (
    <div className="border-t border-border px-5 py-5">
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="ai-capabilities-available">
          <h4 id="ai-capabilities-available" className="text-sm font-semibold">Available for this Project</h4>
          <p className="mt-1 text-sm leading-6 text-muted">
            Declared capabilities are eligible for a run. They are not evidence that a capability was used.
          </p>
          {explainability.declared.status !== "available" ? (
            <p className="mt-2 rounded-md border border-step-warning/25 bg-step-warning/5 px-3 py-2 text-sm leading-6 text-step-warning">
              {explainability.declared.detail}
            </p>
          ) : null}
          <div className="mt-4 space-y-3">
            <CapabilityGroup
              label="Skills"
              values={explainability.declared.skills.map((skill) => `${skillLabel(skill.id)} · ${skill.revision}`)}
            />
            <CapabilityGroup
              label="Published Methods & SOP"
              values={explainability.declared.methods.map((method) => (
                `${skillLabel(method.skillId)} · r${method.resourceRevision} · ${scopeLabel(method.scope)}`
              ))}
            />
            <CapabilityGroup
              label="Tools"
              values={explainability.declared.tools.map((tool) => tool.id)}
            />
          </div>
          {explainability.governance.status === "unavailable" ? (
            <p className="mt-4 rounded-md border border-step-warning/25 bg-step-warning/5 px-3 py-2 text-sm leading-6 text-step-warning">
              {explainability.governance.detail}
            </p>
          ) : explainability.governance.proposals.length > 0 ? (
            <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-3">
              <p className="text-xs font-semibold text-muted">Under governance</p>
              <ul className="mt-2 space-y-1 text-sm">
                {explainability.governance.proposals.map((proposal) => (
                  <li key={proposal.id}>{proposal.title} · {lifecycleLabel(proposal.lifecycle)} · r{proposal.revision}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="ai-capabilities-used">
          <div className="flex flex-wrap items-center gap-2">
            <h4 id="ai-capabilities-used" className="text-sm font-semibold">Used for this Artifact</h4>
            {artifact ? (
              <span className="rounded-full bg-surface-subtle px-2 py-1 text-xs font-semibold text-muted">
                Read-only
              </span>
            ) : null}
          </div>
          {!artifact ? (
            <p className="mt-2 text-sm leading-6 text-muted">No saved Additional Insight trace is available.</p>
          ) : artifact.status === "unavailable" ? (
            <p className="mt-2 text-sm leading-6 text-step-warning">{artifact.detail}</p>
          ) : (
            <div className="mt-4 space-y-4">
              <CapabilityGroup
                label="Actually loaded Methods"
                values={(artifact.loadedMethods ?? []).map(methodHumanLabel)}
              />
              {(artifact.findings ?? []).map((finding) => (
                <article key={finding.id} className="rounded-lg border border-border bg-surface-subtle p-4">
                  <h5 className="font-semibold">{finding.title}</h5>
                  {finding.status === "unavailable" ? (
                    <p className="mt-2 text-sm leading-6 text-step-warning">{finding.detail}</p>
                  ) : (
                    <>
                      <dl className="mt-3 space-y-3 text-sm">
                        <HumanDetail label="Evidence signal" value={finding.evidenceSignal ?? "Unavailable"} />
                        <HumanDetail label="AI angle" value={finding.aiAngle ?? "Unavailable"} />
                        <HumanDetail label="Origin" value={originLabel(finding.origin)} />
                        {finding.novelContribution ? (
                          <HumanDetail label="Novel contribution" value={finding.novelContribution} />
                        ) : null}
                      </dl>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <CapabilityGroup
                          label="Finding-attributed Methods"
                          values={(finding.attributedMethods ?? []).map(methodHumanLabel)}
                        />
                        <CapabilityGroup
                          label="Successful Tool calls"
                          values={(finding.successfulTools ?? []).map((tool) => `${tool.toolName} · Succeeded`)}
                        />
                      </div>
                      <FindingGovernanceControls
                        projectId={projectId}
                        artifactId={artifact.artifactId}
                        findingId={finding.id}
                        client={client}
                      />
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {artifact?.status === "available" && artifact.technical ? (
        <details data-ai-trace-technical className="mt-5 rounded-lg border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-foreground">Technical IDs</summary>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <TechnicalDetail label="Artifact" value={artifact.artifactId} />
            <TechnicalDetail label="Run" value={artifact.technical.runId} />
            <TechnicalDetail label="Output contract" value={artifact.technical.outputContractRevision} />
            <TechnicalDetail label="Method set" value={`${artifact.technical.methodSetId}@${artifact.technical.methodSetRevision}`} />
            <TechnicalDetail label="Method fingerprint" value={artifact.technical.methodSetFingerprint} />
            <TechnicalDetail label="Capability revision" value={artifact.technical.capabilityRevision} />
            {(artifact.loadedMethods ?? []).map((method) => (
              <TechnicalDetail
                key={`${method.resourceId}:${method.resourceRevision}`}
                label={`${methodHumanLabel(method)} identity`}
                value={`${method.resourceId}@${method.resourceRevision} · ${method.technical.contentSha256}`}
              />
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function FindingGovernanceControls({
  projectId,
  artifactId,
  findingId,
  client,
}: {
  projectId: string;
  artifactId: string;
  findingId: string;
  client: ProjectOverviewAiReadinessClient;
}) {
  const [feedback, setFeedback] = useState<EnergyAdditionalInsightFeedbackDto | null>(null);
  const [comments, setComments] = useState<EnergyAdditionalInsightCommentDto[]>([]);
  const [comment, setComment] = useState("");
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalGuidance, setProposalGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const supportsGovernance = Boolean(
    client.getEnergyAdditionalInsightFeedback
    && client.putEnergyAdditionalInsightFeedback
    && client.listEnergyAdditionalInsightComments
    && client.appendEnergyAdditionalInsightComment
    && client.createEnergyInsightMethodProposal,
  );

  useEffect(() => {
    if (!client.getEnergyAdditionalInsightFeedback || !client.listEnergyAdditionalInsightComments) return;
    let active = true;
    void Promise.all([
      client.getEnergyAdditionalInsightFeedback(projectId, artifactId, findingId),
      client.listEnergyAdditionalInsightComments(projectId, artifactId, findingId),
    ]).then(([nextFeedback, result]) => {
      if (!active) return;
      setFeedback(nextFeedback);
      setComments(result.comments);
    }).catch(() => {
      if (active) setMessage("Finding governance is temporarily unavailable.");
    });
    return () => { active = false; };
  }, [artifactId, client, findingId, projectId]);

  if (!supportsGovernance) return null;

  const rate = async (rating: "useful" | "not-useful") => {
    if (!client.putEnergyAdditionalInsightFeedback || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setFeedback(await client.putEnergyAdditionalInsightFeedback(
        projectId,
        artifactId,
        findingId,
        { rating, expectedRevision: feedback?.revision ?? 0 },
      ));
      setMessage(rating === "useful" ? "Marked Useful" : "Marked Not useful");
    } catch {
      setMessage("Feedback could not be saved. Refresh before retrying.");
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    const text = comment.trim();
    if (!client.appendEnergyAdditionalInsightComment || !text || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await client.appendEnergyAdditionalInsightComment(
        projectId,
        artifactId,
        findingId,
        { idempotencyKey: actionKey("comment", artifactId, findingId), text },
      );
      setComments((current) => current.some(({ id }) => id === saved.id) ? current : [...current, saved]);
      setComment("");
      setMessage("Comment added to the immutable Finding audit");
    } catch {
      setMessage("Comment could not be added. Refresh before retrying.");
    } finally {
      setBusy(false);
    }
  };

  const createProposal = async () => {
    const title = proposalTitle.trim();
    const guidance = proposalGuidance.trim();
    if (!client.createEnergyInsightMethodProposal || !title || !guidance || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await client.createEnergyInsightMethodProposal(projectId, artifactId, findingId, {
        idempotencyKey: actionKey("proposal", artifactId, findingId),
        title,
        guidance,
      });
      setProposalOpen(false);
      setProposalTitle("");
      setProposalGuidance("");
      setMessage("Proposal created as provisional; review and publication remain separate actions");
    } catch {
      setMessage("Proposal could not be created. Refresh before retrying.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-xs font-semibold text-muted">Admin review</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          aria-pressed={feedback?.rating === "useful"}
          onClick={() => void rate("useful")}
          className={governanceButton}
        >Useful</button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={feedback?.rating === "not-useful"}
          onClick={() => void rate("not-useful")}
          className={governanceButton}
        >Not useful</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setProposalOpen((open) => !open)}
          className={governanceButton}
        >Propose Method revision</button>
      </div>

      {comments.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label="Finding comments">
          {comments.map((item) => (
            <li key={item.id} className="rounded-md bg-surface px-3 py-2 text-sm leading-6">
              {item.text}
              <span className="ml-2 text-xs text-muted">{item.actorId} · {formatTimestamp(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs font-semibold text-muted">
          Append-only comment
          <textarea
            aria-label="Admin comment"
            value={comment}
            maxLength={2_000}
            onChange={(event) => setComment(event.target.value)}
            className="mt-1 min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal text-foreground"
          />
        </label>
        <button type="button" disabled={busy || !comment.trim()} onClick={() => void addComment()} className={governanceButton}>
          Add comment
        </button>
      </div>

      {proposalOpen ? (
        <div className="mt-3 grid gap-2 rounded-md border border-border bg-surface p-3">
          <p className="text-xs leading-5 text-muted">This creates a provisional Proposal. It cannot edit, approve, or publish the saved Artifact or a Method revision.</p>
          <input
            aria-label="Proposal title"
            value={proposalTitle}
            maxLength={160}
            onChange={(event) => setProposalTitle(event.target.value)}
            placeholder="Proposal title"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
          <textarea
            aria-label="Proposal guidance"
            value={proposalGuidance}
            maxLength={1_600}
            onChange={(event) => setProposalGuidance(event.target.value)}
            placeholder="Method or SOP guidance to review"
            className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !proposalTitle.trim() || !proposalGuidance.trim()}
            onClick={() => void createProposal()}
            className={governanceButton}
          >Create proposal</button>
        </div>
      ) : null}
      {message ? <p className="mt-2 text-xs leading-5 text-muted" role="status">{message}</p> : null}
    </div>
  );
}

function CapabilityGroup({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted">{label}</p>
      {values.length > 0 ? (
        <ul className="mt-1 space-y-1 text-sm leading-6">
          {values.map((value) => <li key={value}>{value}</li>)}
        </ul>
      ) : <p className="mt-1 text-sm text-muted">None</p>}
    </div>
  );
}

function HumanDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1 leading-6 text-foreground">{value}</dd>
    </div>
  );
}

function ReadinessBadge({ status }: { status: EnergyProjectOverviewAdminReadinessStatusDto }) {
  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_COPY[status]}
    </span>
  );
}

function ReadinessFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-subtle px-5 py-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function TechnicalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

const skillLabel = (skillId: string): string => skillId === "energyiq-open-discovery"
  ? "Open discovery"
  : skillId.replace(/^workspace-insight-method:/u, "Workspace Method ");

const scopeLabel = (scope: "builtin" | "user" | "workspace"): string => scope === "builtin"
  ? "Built-in"
  : scope === "workspace"
    ? "Workspace"
    : "Private";

const methodHumanLabel = (method: EnergyProjectAiMethodTraceDto): string =>
  `${skillLabel(method.skillId)} · ${method.semanticVersion} · ${scopeLabel(method.scope)}`;

const lifecycleLabel = (
  lifecycle: EnergyProjectAiExplainabilityDto["governance"]["proposals"][number]["lifecycle"],
): string => lifecycle === "in-review"
  ? "In review"
  : lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1);

const originLabel = (
  origin: "ai-discovery" | "expert-sop" | "hybrid" | undefined,
): string => origin === "ai-discovery"
  ? "AI discovery"
  : origin === "expert-sop"
    ? "Expert SOP"
    : origin === "hybrid"
      ? "Hybrid"
      : "Unavailable";

const STATUS_COPY: Record<EnergyProjectOverviewAdminReadinessStatusDto, string> = {
  ready: "Ready",
  generating: "Generating",
  "not-generated": "Not generated",
  "needs-attention": "Needs attention",
  "no-new-insight": "No new insight",
  "out-of-date": "Out of date",
};

const STATUS_STYLE: Record<EnergyProjectOverviewAdminReadinessStatusDto, string> = {
  ready: "bg-step-success/10 text-step-success",
  generating: "bg-primary-light/10 text-primary",
  "not-generated": "bg-surface-subtle text-muted",
  "needs-attention": "bg-step-warning/10 text-step-warning",
  "no-new-insight": "bg-surface-subtle text-muted",
  "out-of-date": "bg-step-error/10 text-step-error",
};

const primaryButton = "rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20";
const governanceButton = "rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60";

const actionKey = (kind: "comment" | "proposal", artifactId: string, findingId: string): string => {
  const nonce = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-${kind}:${artifactId}:${findingId}:${nonce}`;
};

const formatTimestamp = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  }).format(new Date(parsed));
};

const messageFrom = (reason: unknown, fallback: string): string =>
  reason instanceof Error && reason.message ? reason.message : fallback;

const readinessFallbackAction = (state: EnergyProjectOverviewAdminStateDto): string => {
  if (!state.analysis.supported) return "Connect this Project when ready";
  if (state.analysis.status === "ready" || state.analysis.status === "no-new-insight") return "No action needed";
  if (state.analysis.status === "generating") return "Wait for saved analysis";
  return "Review readiness details";
};
