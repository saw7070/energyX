"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  configApi,
  type EnergyComponentRevisionDto,
  type EnergyProjectSetupDocumentDto,
  type EnergyTemplateChangeContextDto,
  type EnergyTemplateChangeDiffItemDto,
  type EnergyTemplateChangePreviewDto,
  type EnergyTemplateChangeProposalDto,
} from "../../../lib/config-api";
import { TemplateDraftPreview } from "./template-draft-preview";
import {
  buildTemplatePreviewPlan,
  type EnergyPreviewRange,
} from "./template-draft-preview-model";

export function TemplateChangeProposalPanel({
  projectId,
  setupDocument,
  componentCatalog,
  selectedMetricRevisionIds,
  selectedRuleRevisionIds,
  businessCalendarVersion,
  previewRange,
}: {
  projectId: string;
  setupDocument: EnergyProjectSetupDocumentDto;
  componentCatalog: EnergyComponentRevisionDto[];
  selectedMetricRevisionIds: ReadonlySet<string>;
  selectedRuleRevisionIds: ReadonlySet<string>;
  businessCalendarVersion: string;
  previewRange: EnergyPreviewRange | null;
}) {
  const [context, setContext] = useState<EnergyTemplateChangeContextDto | null>(null);
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<EnergyTemplateChangePreviewDto | null>(null);
  const [busy, setBusy] = useState<"loading" | "generating" | "previewing" | "rejecting" | "publishing" | "presentation" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await configApi.getEnergyTemplateChangeContext(projectId);
    setContext(next);
    return next;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setBusy("loading");
    setError(null);
    void configApi.getEnergyTemplateChangeContext(projectId)
      .then((next) => {
        if (!cancelled) setContext(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const previewPlan = useMemo(() => {
    const selectedPreview = preview;
    if (!selectedPreview) return null;
    const template = selectedPreview.proposal.document.templates.find((item) => item.template_id === "project")
      ?? selectedPreview.proposal.document.templates[0];
    if (!template) return null;
    return buildTemplatePreviewPlan({
      template,
      document: setupDocument,
      catalog: selectedPreview.catalog.length > 0 ? selectedPreview.catalog : componentCatalog,
      selectedMetricRevisionIds,
      selectedRuleRevisionIds,
      businessCalendarVersion,
    });
  }, [
    businessCalendarVersion,
    componentCatalog,
    preview,
    selectedMetricRevisionIds,
    selectedRuleRevisionIds,
    setupDocument,
  ]);

  const generate = async () => {
    const request = instruction.trim();
    if (!request || busy) return;
    setBusy("generating");
    setError(null);
    setNotice(null);
    try {
      const generated = await configApi.proposeEnergyTemplateChange(projectId, {
        instruction: request,
        ...(context?.fixedIdentity.scopeId ? { scopeId: context.fixedIdentity.scopeId } : {}),
      });
      const nextPreview = await configApi.previewEnergyTemplateChange(projectId, generated.proposal.id);
      setPreview(nextPreview);
      await reload();
      setNotice("Proposal created. Nothing has been published.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const openPreview = async (proposal: EnergyTemplateChangeProposalDto) => {
    if (busy) return;
    setBusy("previewing");
    setError(null);
    try {
      setPreview(await configApi.previewEnergyTemplateChange(projectId, proposal.id));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!preview || preview.proposal.status !== "pending_review" || busy) return;
    setBusy("rejecting");
    setError(null);
    try {
      await configApi.rejectEnergyTemplateChange(projectId, preview.proposal.id);
      setPreview(null);
      await reload();
      setNotice("Proposal rejected. The published Template Revision was not changed.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (!preview || preview.proposal.status !== "pending_review" || busy) return;
    if (!window.confirm("Publish this reviewed proposal as a new immutable Template Revision?")) return;
    setBusy("publishing");
    setError(null);
    try {
      const result = await configApi.publishEnergyTemplateChange(projectId, preview.proposal.id);
      setPreview(null);
      await reload();
      setNotice(`Published ${result.revision.revision_id}. The base revision remains available.`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const publishPresentation = async (mode: "structured" | "html") => {
    if (busy || context?.overviewDefinition.aiSlotPresentationMode === mode) return;
    const label = mode === "html" ? "HTML AI Slots" : "structured AI Slots";
    if (!window.confirm(`Publish a new immutable Release using ${label}?`)) return;
    setBusy("presentation");
    setError(null);
    try {
      const result = await configApi.publishEnergyAiSlotPresentation(projectId, mode);
      setContext((previous) => previous ? {
        ...previous,
        fixedIdentity: {
          ...previous.fixedIdentity,
          projectReleaseId: result.revision.revision_id,
        },
        revision: result.revision,
        overviewDefinition: result.overviewDefinition,
      } : previous);
      setNotice(mode === "html"
        ? `Published ${result.revision.revision_id} with ${label}. HTML artifacts still require explicit administrator generation before they become visible.`
        : `Published ${result.revision.revision_id} with ${label}.`);
      try {
        await reload();
      } catch (reason) {
        setError(`Release was published, but the latest Admin state could not be refreshed: ${errorMessage(reason)}`);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-5 rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold">AI template change proposal</h4>
              <span className="rounded-full bg-step-warning/10 px-2 py-0.5 text-[9px] font-semibold text-step-warning">ADMIN REVIEW</span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Describe what the Overview should help users understand. AI proposes a complete Section and capability definition; the server validates, previews and diffs it before you decide whether to publish.
            </p>
          </div>
          {context ? (
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-right">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted-light">Reviewed base</p>
              <p className="mt-1 font-mono text-[10px] text-foreground">{context.fixedIdentity.projectReleaseId}</p>
            </div>
          ) : null}
        </div>

        <label className="mt-5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
          Describe the outcome
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="For example: Put the most important management actions first, then show the evidence and monthly outlook that support them."
            rows={4}
            maxLength={2_000}
            className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-3 text-sm font-normal leading-6 text-foreground outline-none focus:border-foreground/30"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] leading-5 text-muted">
            AI cannot write page code or publish directly. The preview uses the selected Snapshot and the same compiler as publishing.
          </p>
          <button
            type="button"
            disabled={!instruction.trim() || Boolean(busy)}
            onClick={() => void generate()}
            className="rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "generating" ? "AI is proposing..." : "Generate proposal"}
          </button>
        </div>
        {context?.rendererBoundary.customerRenderer === "preschool-overview" ? (
          <div className="mt-4 rounded-lg border border-border bg-background p-3">
            <p className="text-xs font-semibold">Published AI Slot presentation</p>
            <p className="mt-1 text-[11px] leading-5 text-muted">
              This deterministic Admin action publishes a reviewed immutable Release. It does not ask AI to edit the Overview Definition.
            </p>
            <div className="mt-3 flex gap-2" role="group" aria-label="Published AI Slot presentation">
              {(["html", "structured"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={Boolean(busy) || context.overviewDefinition.aiSlotPresentationMode === mode}
                  onClick={() => void publishPresentation(mode)}
                  className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:cursor-default disabled:bg-surface-subtle disabled:text-muted"
                >
                  {mode === "html" ? "Use accepted HTML Slots" : "Roll back to structured Slots"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {error ? <p role="alert" className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p> : null}
        {notice ? <p role="status" className="mt-3 rounded-lg bg-step-success/10 px-3 py-2 text-xs text-step-success">{notice}</p> : null}
      </div>

      {preview ? (
        <div className="grid min-w-0 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
          <div className="border-b border-border p-5 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={statusBadge(preview.proposal.status)}>{statusLabel(preview.proposal.status)}</span>
              <span className="text-[10px] text-muted-light">{preview.proposal.diff.length} reviewed changes</span>
            </div>
            <h5 className="mt-4 text-lg font-semibold leading-7">{preview.proposal.proposal.title}</h5>
            <p className="mt-2 text-sm leading-6 text-muted">{preview.proposal.proposal.rationale}</p>

            <ol className="mt-5 space-y-3">
              {preview.proposal.diff.map((item, index) => (
                <li key={templateChangeDiffKey(item, index)} className="flex gap-3 rounded-lg bg-background p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">{index + 1}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-5 text-foreground">{templateChangeDiffSummary(item)}</p>
                    <p className="mt-1 text-[10px] text-muted-light">{templateChangeDiffContext(item)}</p>
                  </div>
                </li>
              ))}
            </ol>

            <dl className="mt-5 space-y-2 border-t border-border pt-4 text-[10px]">
              <PinRow label="Snapshot" value={preview.fixedIdentity.dataSnapshotId} />
              <PinRow label="Base release" value={preview.fixedIdentity.projectReleaseId} />
              <PinRow label="Scope" value={preview.fixedIdentity.scopeId} />
            </dl>

            {preview.proposal.status === "pending_review" ? (
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(busy)} onClick={() => void reject()} className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">
                  {busy === "rejecting" ? "Rejecting..." : "Reject"}
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void publish()} className="rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:opacity-40">
                  {busy === "publishing" ? "Publishing..." : "Review and publish"}
                </button>
              </div>
            ) : null}
          </div>
          <div className="min-w-0">
            {previewPlan ? (
              <TemplateDraftPreview
                key={preview.proposal.id}
                projectId={projectId}
                plan={previewPlan}
                previewRange={previewRange}
                dirty={false}
                fixedIdentity={preview.fixedIdentity}
              />
            ) : (
              <p className="p-5 text-sm text-muted">This proposal does not contain a previewable template.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold">Proposal history</p>
            {busy === "loading" ? <span className="text-[10px] text-muted">Loading...</span> : null}
          </div>
          {context?.proposals.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {context.proposals.slice(0, 6).map((proposal) => (
                <button
                  key={proposal.id}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void openPreview(proposal)}
                  className="rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-foreground/25 disabled:opacity-50"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-medium">{proposal.proposal.title}</span>
                    <span className={statusBadge(proposal.status)}>{statusLabel(proposal.status)}</span>
                  </span>
                  <span className="mt-2 block text-[10px] leading-4 text-muted">{proposal.diff.length} changes · base {proposal.base_revision_id}</span>
                </button>
              ))}
            </div>
          ) : busy !== "loading" ? (
            <p className="mt-2 text-[11px] leading-5 text-muted">No proposal has been created. The published Template Revision is unchanged.</p>
          ) : null}
          {context?.rendererBoundary.message ? (
            <p className="mt-4 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-[10px] leading-5 text-muted">
              {context.rendererBoundary.message}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PinRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-light">{label}</dt>
      <dd className="truncate font-mono text-foreground" title={value}>{value}</dd>
    </div>
  );
}

function statusLabel(status: EnergyTemplateChangeProposalDto["status"]): string {
  if (status === "pending_review") return "Needs review";
  if (status === "published") return "Published";
  return "Rejected";
}

function statusBadge(status: EnergyTemplateChangeProposalDto["status"]): string {
  const color = status === "published"
    ? "bg-step-success/10 text-step-success"
    : status === "rejected"
      ? "bg-surface-subtle text-muted"
      : "bg-step-warning/10 text-step-warning";
  return `shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${color}`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Template change request failed.";
}

function templateChangeDiffKey(item: EnergyTemplateChangeDiffItemDto, index: number): string {
  if ("placement_id" in item) return `${item.kind}:${item.placement_id}:${index}`;
  if ("blockKey" in item) return `${item.kind}:${item.sectionKey}:${item.blockKey}:${index}`;
  if ("sectionKey" in item) return `${item.kind}:${item.sectionKey}:${index}`;
  return `${item.kind}:${index}`;
}

function templateChangeDiffSummary(item: EnergyTemplateChangeDiffItemDto): string {
  if ("summary" in item) return item.summary;
  if (item.kind === "ai_slot_presentation_mode_updated") return "Change the published AI Slot presentation.";
  if (item.kind === "section_added") return `Add the ${item.sectionKey} section.`;
  if (item.kind === "section_removed") return `Remove the ${item.sectionKey} section.`;
  if (item.kind === "section_order_changed") return "Change the Section reading order.";
  if (item.kind === "section_updated") return `Update the ${item.sectionKey} section.`;
  if (item.kind === "block_added") return `Add ${item.blockKey} to ${item.sectionKey}.`;
  if (item.kind === "block_removed") return `Remove ${item.blockKey} from ${item.sectionKey}.`;
  if (item.kind === "block_order_changed") return `Change the Block order in ${item.sectionKey}.`;
  if (item.kind === "block_updated") return `Update ${item.blockKey} in ${item.sectionKey}.`;
  return "Update the Overview definition.";
}

function templateChangeDiffContext(item: EnergyTemplateChangeDiffItemDto): string {
  if ("placement_id" in item) return `${item.template_id} · ${item.placement_id}`;
  if ("changedFields" in item) return `Changed: ${item.changedFields.join(", ")}`;
  if (item.kind === "ai_slot_presentation_mode_updated") return `${item.before} becomes ${item.after}`;
  if ("before" in item) return `${item.before.join(" → ")} becomes ${item.after.join(" → ")}`;
  return `Position ${item.index + 1}`;
}
