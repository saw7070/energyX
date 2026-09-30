"use client";

import React, { useEffect, useState } from "react";

import {
  configApi,
  type EnergyInsightMethodProposalDto,
  type EnergyProjectAiExplainabilityDto,
} from "../../../lib/config-api";

export type PreschoolAdditionalMethodProposalAdminClient = {
  listProposals(projectId: string): Promise<EnergyInsightMethodProposalDto[]>;
  getExplainability?(projectId: string): Promise<EnergyProjectAiExplainabilityDto | undefined>;
  transitionProposal(input: {
    projectId: string;
    proposalId: string;
    action: "submit" | "approve" | "publish";
    expectedRevision: number;
  }): Promise<EnergyInsightMethodProposalDto>;
};

const configApiProposalClient: PreschoolAdditionalMethodProposalAdminClient = {
  listProposals: (projectId) => configApi.listEnergyInsightMethodProposals(projectId)
    .then(({ proposals }) => proposals),
  transitionProposal: ({ projectId, proposalId, action, expectedRevision }) =>
    configApi.transitionEnergyInsightMethodProposal(projectId, proposalId, action, expectedRevision),
  getExplainability: (projectId) => configApi.getEnergyProjectOverviewAdminState(projectId)
    .then((state) => state.explainability),
};

export function PreschoolAdditionalMethodProposalAdmin({
  projectId,
  client = configApiProposalClient,
}: {
  projectId: string;
  client?: PreschoolAdditionalMethodProposalAdminClient;
}) {
  const [proposals, setProposals] = useState<EnergyInsightMethodProposalDto[]>([]);
  const [explainability, setExplainability] = useState<EnergyProjectAiExplainabilityDto | undefined>();
  const [state, setState] = useState<"loading" | "ready" | "updated" | "error">("loading");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState("loading");
    void Promise.all([
      client.listProposals(projectId),
      client.getExplainability?.(projectId) ?? Promise.resolve(undefined),
    ]).then(([loaded, catalog]) => {
      if (!active) return;
      setProposals(loaded);
      setExplainability(catalog);
      setState("ready");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [client, projectId]);

  const transition = async (
    proposal: EnergyInsightMethodProposalDto,
    action: "submit" | "approve" | "publish",
  ) => {
    setUpdatingId(proposal.id);
    setState("ready");
    try {
      const updated = await client.transitionProposal({
        projectId,
        proposalId: proposal.id,
        action,
        expectedRevision: proposal.revision,
      });
      setProposals((current) => current.map((item) => item.id === updated.id ? updated : item));
      setState("updated");
    } catch {
      setState("error");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section aria-labelledby="additional-method-proposals-heading" className="space-y-4">
      <div>
        <h2 id="additional-method-proposals-heading" className="text-lg font-semibold text-foreground">
          Additional Insight Method proposals
        </h2>
        <p className="mt-1 text-sm text-muted">
          Human review is required. Feedback and vote totals never approve or publish a Method automatically.
        </p>
      </div>
      {state === "loading" ? <p role="status" className="text-sm text-muted">Loading Method proposals…</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-step-error">Proposal could not be updated. Refresh before retrying.</p> : null}
      {state === "updated" ? <p role="status" className="text-sm text-step-success">Proposal updated</p> : null}
      {explainability?.status === "available" ? (
        <section aria-labelledby="available-methods-heading" className="rounded-lg border border-border bg-surface-subtle p-4">
          <h3 id="available-methods-heading" className="font-semibold text-foreground">Available Methods & SOP</h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            Published entries are declared available for this Workspace. A saved Artifact trace is the source of truth for actual use.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {explainability.declared.methods.map((method) => (
              <li key={`${method.resourceId}:${method.resourceRevision}`} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                <p className="font-semibold">{methodName(method.skillId)}</p>
                <p className="mt-1 text-xs text-muted">
                  Published · r{method.resourceRevision} · {method.scope === "builtin" ? "Built-in visibility" : "Workspace visibility"}
                </p>
              </li>
            ))}
          </ul>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold text-muted">Technical IDs</summary>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {explainability.declared.methods.map((method) => (
                <li key={method.resourceId}>{method.resourceId}@{method.resourceRevision}</li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
      {state !== "loading" && proposals.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-subtle p-4 text-sm text-muted">No Method proposals are awaiting review.</p>
      ) : null}
      <div className="space-y-3">
        {proposals.map((proposal) => {
          const action = proposal.status === "provisional"
            ? "submit" as const
            : proposal.status === "in-review"
              ? "approve" as const
              : proposal.status === "approved"
                ? "publish" as const
                : null;
          return (
            <article key={proposal.id} className="rounded-lg border border-border bg-surface p-4" data-method-proposal={proposal.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-[75ch]">
                  <h3 className="font-semibold text-foreground">{proposal.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{proposal.guidance}</p>
                  <p className="mt-2 text-xs text-muted">Status: {proposal.status} · Revision {proposal.revision}</p>
                </div>
                {action ? (
                  <button
                    type="button"
                    disabled={updatingId !== null}
                    onClick={() => void transition(proposal, action)}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {action === "submit" ? "Submit for review" : action === "approve" ? "Approve" : "Publish"}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const methodName = (skillId: string): string => skillId === "energyiq-open-discovery"
  ? "Open discovery"
  : skillId.replace(/^workspace-insight-method:/u, "Workspace Method ");
