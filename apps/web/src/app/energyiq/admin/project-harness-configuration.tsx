"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  configApi,
  type EnergyProjectHarnessConfigurationDto,
} from "../../../lib/config-api";

export type ProjectHarnessConfigurationClient = Pick<
  typeof configApi,
  "getEnergyProjectHarnessConfiguration"
>;

export function ProjectHarnessConfiguration({
  projectId,
  client = configApi,
}: {
  projectId: string;
  client?: ProjectHarnessConfigurationClient;
}) {
  const [state, setState] = useState<EnergyProjectHarnessConfigurationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void client.getEnergyProjectHarnessConfiguration(projectId)
      .then((next) => {
        if (active) setState(next);
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

  if (loading && !state) {
    return (
      <section className="mx-auto min-h-40 max-w-6xl rounded-xl border border-border bg-surface p-6" role="status">
        <h2 className="text-lg font-semibold text-foreground">Harness Configuration</h2>
        <p className="mt-2 text-sm text-muted">Loading the current server-owned configuration…</p>
      </section>
    );
  }

  if (!state) {
    return (
      <section className="mx-auto max-w-6xl rounded-xl border border-step-error/25 bg-surface p-6" role="status">
        <h2 className="text-lg font-semibold text-foreground">Harness Configuration</h2>
        <p className="mt-2 text-sm text-step-error">{error ?? "Harness configuration is unavailable."}</p>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="harness-configuration-heading">
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Current configuration</p>
            <h2 id="harness-configuration-heading" className="mt-2 text-xl font-semibold text-foreground">Harness Configuration</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              {state.project.name} · what each Harness may use now, resolved by the server for this Project.
            </p>
          </div>
          <StateBadge available={state.status === "available"} label={state.status === "available" ? "Available" : "Partially unavailable"} />
        </div>
        <div className="border-t border-border bg-surface-subtle px-6 py-4">
          <p className="text-sm leading-6 text-muted">
            This is current configuration, not historical Run evidence. Resources selected, materialized, loaded/read, or called in one Run belong in AI Operations; this page does not infer them.
          </p>
        </div>
      </section>

      {state.unavailable.length > 0 ? (
        <section className="rounded-xl border border-step-warning/30 bg-step-warning/5 p-5" aria-labelledby="harness-unavailable-heading">
          <h3 id="harness-unavailable-heading" className="text-base font-semibold text-foreground">Local availability needs attention</h3>
          <div className="mt-3 space-y-2">
            {state.unavailable.map((item) => (
              <p key={item.id} className="text-sm leading-6 text-muted">{item.detail}</p>
            ))}
          </div>
        </section>
      ) : null}

      <ResourceSection
        eyebrow="1 of 5"
        title="Harness overview"
        description="A Harness is the governed assembly boundary. Candidate resources and fixed Stage declarations remain distinct from one Run's trace."
      >
        <ManagedOverviewSummary summary={state.managedOverview} />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {state.harnesses.map((harness) => (
            <article key={harness.id} className="rounded-xl border border-border bg-surface-subtle p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-foreground">{harness.label}</h4>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    {resolutionLabel(harness.resolution)}
                  </p>
                </div>
                <StateBadge available={harness.status === "available"} label={sentenceCase(harness.status)} />
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">{harness.detail}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                <CountFact label="Models" count={harness.modelIds.length} />
                <CountFact label="Skills" count={harness.skillIds.length} />
                <CountFact label="Methods" count={harness.methodResourceIds.length} />
                <CountFact label="Tools" count={harness.toolIds.length} />
                <CountFact label="MCP" count={harness.mcpServerIds.length} />
              </div>
              <p className="mt-3 text-xs font-medium text-muted">Declared for this Harness</p>
              <TechnicalDetails rows={harnessTechnicalRows(harness)} />
            </article>
          ))}
        </div>
      </ResourceSection>

      <ResourceSection
        eyebrow="2 of 5"
        title="Models & Routing"
        description="Planning capacity is explicit about whether it came from the profile, a verified model default, or a conservative fallback. It is not a live Provider guarantee."
      >
        {state.resources.models.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {state.resources.models.map((model) => (
              <article key={`${model.source}:${model.id}`} className="rounded-xl border border-border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-foreground">{model.name}</h4>
                    <p className="mt-1 text-sm text-muted">{model.source === "server-system-binding" ? "Server system binding" : "Current Admin resource"}</p>
                  </div>
                <StateBadge
                  available={model.enabled && model.status === "connected"}
                  label={model.enabled ? sentenceCase(model.status) : "Disabled"}
                />
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Fact label="Context window" value={`${formatNumber(model.planningContext.contextWindow)} tokens`} />
                  <Fact label="Input budget" value={`${formatNumber(model.planningContext.inputBudget)} tokens`} />
                  <Fact label="Output reserve" value={`${formatNumber(model.planningContext.outputReserve)} tokens`} />
                  <Fact label="Capacity source" value={capabilitySourceLabel(model.planningContext.capabilitySource)} />
                </dl>
                <TechnicalDetails rows={[
                  ["Model resource", model.id],
                  ["Revision", String(model.revision)],
                  ["Provider adapter", model.provider ?? "Unavailable"],
                  ["Model name", model.modelName ?? "Unavailable"],
                  ["Safety margin", `${model.planningContext.safetyMargin} tokens`],
                ]} />
              </article>
            ))}
          </div>
        ) : <EmptyState>No configured model resource is locally available for this Project.</EmptyState>}
      </ResourceSection>

      <ResourceSection
        eyebrow="3 of 5"
        title="Skills & Methods"
        description="Configured Skills are candidates for eligible Harnesses. Published Methods are governed instructions; neither list proves selection or attribution in a Run."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <ResourceList title="Skills" empty="No current Skills are visible to this Admin in the Project Workspace.">
            {state.resources.skills.map((skill) => (
              <article key={skill.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{skill.name}</h4>
                    <p className="mt-1 text-sm leading-6 text-muted">{skill.description}</p>
                  </div>
                  <StateBadge
                    available={skill.enabled && skill.availability === "configured"}
                    label={!skill.enabled ? "Disabled" : skill.availability === "configured" ? "Configured" : "Unavailable"}
                  />
                </div>
                <p className="mt-3 text-xs text-muted">
                  {sentenceCase(skill.physicalOwner)} owner · {sentenceCase(skill.declaredScope)} declared scope · {skill.scopeStatus === "verified" ? "Scope verified" : "Scope unverified"}
                </p>
                <TechnicalDetails rows={[
                  ["Skill", skill.id],
                  ["Version", skill.version],
                  ["Revision", String(skill.revision)],
                  ["Allowed Tools", listOrNone(skill.allowedToolIds)],
                  ["Denied Tools", listOrNone(skill.deniedToolIds)],
                  ["Content SHA", skill.contentSha256 ?? "Unavailable"],
                ]} />
              </article>
            ))}
          </ResourceList>
          <ResourceList title="Published Methods" empty="No published Method is declared for this Project's current Harnesses.">
            {state.resources.methods.map((method) => (
              <article key={method.resourceId} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{humanize(method.skillId)}</h4>
                    <p className="mt-1 text-sm text-muted">{method.role === "core-method" ? "Core analysis method" : "Expert direction"} · {sentenceCase(method.scope)} scope</p>
                  </div>
                  <StateBadge available label="Published" />
                </div>
                <TechnicalDetails rows={[
                  ["Method resource", method.resourceId],
                  ["Resource revision", String(method.resourceRevision)],
                  ["Semantic version", method.semanticVersion],
                  ["Content SHA", method.contentSha256],
                ]} />
              </article>
            ))}
          </ResourceList>
        </div>
      </ResourceSection>

      <ResourceSection
        eyebrow="4 of 5"
        title="Tools & MCP"
        description="Registered is not called, and declared is not succeeded. Successful Tool evidence is only shown from an exact Run or Finding audit."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <ResourceList title="Tool registry" empty="No Tools are registered or declared for the current Harnesses.">
            {state.resources.tools.map((tool) => (
              <article key={`${tool.source}:${tool.id}`} className="flex items-start justify-between gap-3 rounded-lg border border-border p-4">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{humanize(tool.id)}</h4>
                  <p className="mt-1 text-xs text-muted">{tool.source === "energyiq-server-owned" ? "EnergyX server-owned" : "DataFoundry built-in"}</p>
                </div>
                <StateBadge available label={tool.availability === "registered" ? "Registered" : "Declared for Stage"} />
              </article>
            ))}
          </ResourceList>
          <ResourceList title="MCP servers" empty="No MCP server is configured for this Project and Admin owner. EnergyX Stage Harnesses may still use server-owned Tools.">
            {state.resources.mcpServers.map((server) => (
              <article key={server.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{server.name}</h4>
                    <p className="mt-1 text-xs text-muted">User-owned configuration · revision {server.revision}</p>
                  </div>
                  <StateBadge available={server.enabled} label={server.enabled ? "Configured" : "Disabled"} />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">
                  {server.toolManifest.source === "persisted-last-test" ? "Persisted test snapshot" : "Not tested"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  This is saved status as of {formatTimestamp(server.statusAsOf)}, not a live connection check.
                </p>
                <TechnicalDetails rows={[
                  ["MCP server", server.id],
                  ["Persisted status", server.status],
                  ["Manifest Tools", listOrNone(server.toolManifest.toolNames)],
                ]} />
              </article>
            ))}
          </ResourceList>
        </div>
      </ResourceSection>

      <ResourceSection
        eyebrow="5 of 5"
        title="Context & Instructions"
        description="The system prompt is layered, not one editable string. This view exposes safe summaries; dynamic tenant context and the exact materialized prompt require persisted Run-scoped evidence and are otherwise unavailable."
      >
        <div className="space-y-4">
          {state.harnesses.map((harness) => (
            <article key={harness.id} className="rounded-xl border border-border p-5">
              <h4 className="font-semibold text-foreground">{harness.label}</h4>
              <div className="mt-4 grid gap-5 lg:grid-cols-2">
                <div>
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-muted">Run-planned context composition</h5>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {harness.context.sources.map((source) => <Tag key={source}>{humanize(source)}</Tag>)}
                  </div>
                </div>
                <div>
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-muted">Instruction layers</h5>
                  <div className="mt-3 space-y-2">
                    {harness.instructions.map((instruction, index) => (
                      <div key={`${instruction.kind}:${instruction.label}:${index}`} className="rounded-lg bg-surface-subtle px-3 py-2">
                        <p className="text-sm font-medium text-foreground">{instruction.label}</p>
                        <p className="mt-1 text-xs text-muted">{instructionStatusLabel(instruction.revisionStatus)} · Summary only</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </ResourceSection>
    </div>
  );
}

function ResourceSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-6" aria-labelledby={`harness-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
      <h3 id={`harness-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`} className="mt-2 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ResourceList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <section>
      <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <div className="mt-3 space-y-3">
        {items.length > 0 ? children : <EmptyState>{empty}</EmptyState>}
      </div>
    </section>
  );
}

function ManagedOverviewSummary({
  summary,
}: {
  summary: EnergyProjectHarnessConfigurationDto["managedOverview"];
}) {
  if (!summary) {
    return <EmptyState>Managed Overview identity is unavailable from this server revision.</EmptyState>;
  }
  const windowLabels = new Map(summary.reportTimePolicy.windows.map((window) => [window.id, window.label]));
  return (
    <article className="rounded-xl border border-border bg-surface-subtle p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-foreground">Managed Overview</h4>
          <p className="mt-1 text-sm text-muted">
            Published definition, Report time policy, and Section window bindings resolved for this Project.
          </p>
        </div>
        <StateBadge available={summary.status === "available"} label={sentenceCase(summary.status)} />
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Overview definition" value={summary.definition.status === "available" ? "Published definition" : "Unavailable"} />
        <Fact label="Report time policy" value={summary.reportTimePolicy.status === "available" ? "Published policy" : "Unavailable"} />
        <Fact label="Named windows" value={String(summary.reportTimePolicy.windows.length)} />
        <Fact label="Sections" value={String(summary.sections.length)} />
      </dl>
      {summary.reportTimePolicy.windows.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Named report windows">
          {summary.reportTimePolicy.windows.map((window) => <Tag key={window.id}>{window.label}</Tag>)}
        </div>
      ) : null}
      {summary.sections.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {summary.sections.map((section) => (
            <div key={section.id} className="rounded-lg bg-surface px-3 py-2">
              <p className="text-sm font-medium text-foreground">{section.title}</p>
              <p className="mt-1 text-xs text-muted">
                Primary window · {windowLabels.get(section.primaryWindowId) ?? "Unavailable"}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <TechnicalDetails rows={[
        ["Source", summary.source],
        ["Renderer", summary.rendererKey ?? "Unavailable"],
        ["Template revision", summary.definition.templateRevisionId ?? "Unavailable"],
        ["Definition contract", summary.definition.contractRevision ?? "Unavailable"],
        ["Definition fingerprint", summary.definition.fingerprint ?? "Unavailable"],
        ["Time policy revision", summary.reportTimePolicy.revisionId ?? "Unavailable"],
      ]} />
    </article>
  );
}

function TechnicalDetails({ rows }: { rows: Array<[string, string]> }) {
  return (
    <details className="mt-4 border-t border-border pt-3" data-harness-technical>
      <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        Technical IDs
      </summary>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 text-xs sm:grid-cols-[140px_minmax(0,1fr)]">
            <dt className="font-medium text-muted">{label}</dt>
            <dd className="break-all font-mono text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function harnessTechnicalRows(
  harness: EnergyProjectHarnessConfigurationDto["harnesses"][number],
): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Harness", harness.id],
    ["Runtime stages", listOrNone(harness.runtimeStageIds ?? [])],
    ["Models", listOrNone(harness.modelIds)],
    ["Skills", listOrNone(harness.skillIds)],
    ["Methods", listOrNone(harness.methodResourceIds)],
    ["Tools", listOrNone(harness.toolIds)],
    ["MCP", listOrNone(harness.mcpServerIds)],
  ];
  if (harness.contract) {
    rows.push(
      ["Contract source", "Code-owned current contract"],
      ["Artifact identity", harness.contract.artifactIdentityRevision],
      ["Workflow", harness.contract.workflowRevision],
      ["Prompts", listOrNone(harness.contract.promptRevisions)],
      ["Validator", harness.contract.validatorRevision],
      ["Output contract", harness.contract.outputContractRevision],
    );
  }
  return rows;
}

function CountFact({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <p className="font-semibold text-foreground">{count}</p>
      <p className="mt-0.5 text-muted">{label}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function StateBadge({ available, label }: { available: boolean; label: string }) {
  return (
    <span className={[
      "inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold",
      available ? "bg-step-success/10 text-step-success" : "bg-step-warning/10 text-step-warning",
    ].join(" ")}>
      {label}
    </span>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-surface-subtle px-3 py-1.5 text-xs font-medium text-muted">{children}</span>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm leading-6 text-muted">{children}</p>;
}

function capabilitySourceLabel(source: EnergyProjectHarnessConfigurationDto["resources"]["models"][number]["planningContext"]["capabilitySource"]): string {
  if (source === "verified-model-default") return "Verified model default";
  if (source === "explicit-profile") return "Explicit profile";
  return "Conservative fallback";
}

function resolutionLabel(resolution: EnergyProjectHarnessConfigurationDto["harnesses"][number]["resolution"]): string {
  return resolution === "run-dependent" ? "Resolved per run" : "Fixed stage contract";
}

function instructionStatusLabel(status: EnergyProjectHarnessConfigurationDto["harnesses"][number]["instructions"][number]["revisionStatus"]): string {
  if (status === "resource-pinned") return "Resource revision pinned";
  if (status === "run-pinned") return "Pinned when the Run materializes";
  return "Not separately versioned";
}

function sentenceCase(value: string): string {
  const normalized = value.replace(/-/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function humanize(value: string): string {
  return sentenceCase(value.replace(/[._:@/]+/g, " "));
}

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None declared";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-SG").format(value);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error && reason.message.trim()
    ? reason.message
    : "Harness configuration is unavailable.";
}
