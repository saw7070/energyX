"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  configApi,
  type EnergyProjectAnalysisSnapshotDto,
  type EnergyProjectOverviewAiReadModelDto,
  type EnergyProjectOverviewAiUnitStatusDto,
} from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import { SafeAiMarkdown } from "./safe-ai-markdown";

const CORE_SECTIONS = [
  ["trend-and-demand", "Trend and demand"],
  ["time-behaviour", "Time behaviour"],
  ["circuit-concentration", "Circuit concentration"],
  ["decision-priorities", "Decision priorities"],
] as const;

const SECTIONS = [
  ...CORE_SECTIONS,
  ["school-holiday-comparison", "School Holiday Comparison"] as const,
] as const;

type OverviewAiReadPin = {
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
};

const defaultRestore = (projectId: string, scopeId: string, pin: OverviewAiReadPin) =>
  configApi.getEnergyProjectOverviewAiReadModel(projectId, scopeId, pin);

export function NgeeAnnProjectAiSlots({
  snapshot,
  savedModel,
  restore = defaultRestore,
  onRestoredModel,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  savedModel?: EnergyProjectOverviewAiReadModelDto;
  restore?: (
    projectId: string,
    scopeId: string,
    pin: OverviewAiReadPin,
  ) => Promise<EnergyProjectOverviewAiReadModelDto>;
  onRestoredModel?: (model: EnergyProjectOverviewAiReadModelDto) => void;
}) {
  const identityKey = `${snapshot.context.projectId}:${snapshot.context.scopeId}:${snapshot.dataSnapshot.id}:${snapshot.projectRelease.id}`;
  const sections = snapshot.sectionManifest?.enabledSectionIds.includes("school-holiday-comparison")
    ? SECTIONS
    : CORE_SECTIONS;
  const notifiedModelRef = useRef<EnergyProjectOverviewAiReadModelDto | null>(null);
  const [state, setState] = useState<{
    identityKey: string;
    model?: EnergyProjectOverviewAiReadModelDto;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (savedModel) return;
    let active = true;
    void restore(snapshot.context.projectId, snapshot.context.scopeId, overviewAiReadPin(snapshot))
      .then((model) => {
        if (!active) return;
        if (!matchesSnapshot(model, snapshot)) {
          setState({ identityKey, error: "The saved AI result does not match this Snapshot." });
          return;
        }
        setState({ identityKey, model });
      })
      .catch(() => {
        if (active) setState({ identityKey, error: "Saved AI analysis is temporarily unavailable." });
      });
    return () => { active = false; };
  }, [identityKey, restore, savedModel, snapshot]);

  const savedMatches = savedModel ? matchesSnapshot(savedModel, snapshot) : false;
  const model = savedModel
    ? (savedMatches ? savedModel : undefined)
    : state?.identityKey === identityKey ? state.model : undefined;
  const error = savedModel && !savedMatches
    ? "The saved AI result does not match this Snapshot."
    : state?.identityKey === identityKey ? state.error : undefined;
  const readyCount = useMemo(() => model
    ? sections.filter(([sectionId]) => terminal(model.sections[sectionId])).length
    : 0, [model, sections]);

  useEffect(() => {
    if (model && model !== notifiedModelRef.current && matchesSnapshot(model, snapshot)) {
      notifiedModelRef.current = model;
      onRestoredModel?.(model);
    }
  }, [identityKey, model, onRestoredModel, snapshot]);

  return (
    <section aria-labelledby="ngee-ann-project-ai" className="border-b border-border bg-surface px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="ngee-ann-project-ai" className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              AI interpretation
            </h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">
              AI-generated
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            Key Findings first, followed by Snapshot-bound Section interpretations.
          </p>
        </div>
        <span className="rounded-md bg-surface-subtle px-2.5 py-1.5 text-xs font-medium text-muted">
          {model ? `${readyCount} of ${sections.length} Sections ready` : "Restoring saved analysis…"}
        </span>
      </div>

      {!model ? (
        <div className="mt-5 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status" aria-live="polite">
          <p className="text-xs font-semibold text-foreground">{error ?? "Restoring saved AI analysis…"}</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            The deterministic Overview is ready. Opening this page does not start a Provider run.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <KeyFindings unit={model.keyFindings} />
          <div className="grid gap-4 xl:grid-cols-2" aria-label="Ngee Ann Section interpretations">
            {sections.map(([sectionId, label]) => (
              <SectionInterpretation key={sectionId} label={label} unit={model.sections[sectionId] ?? { status: "missing" }} />
            ))}
          </div>
          <AdditionalInsights unit={model.additionalInsights} />
        </div>
      )}
    </section>
  );
}

function overviewAiReadPin(snapshot: EnergyProjectAnalysisSnapshotDto): OverviewAiReadPin {
  return {
    from: localDate(snapshot.context.from, snapshot.context.timezone),
    to: localDate(
      new Date(Date.parse(snapshot.context.to) - 1).toISOString(),
      snapshot.context.timezone,
    ),
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
  };
}

function localDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function KeyFindings({ unit }: { unit: EnergyProjectOverviewAiUnitStatusDto }) {
  if (unit.status !== "available") return <UnitStatus title="Key Findings" unit={unit} />;
  const result = unit.result;
  const summary = record(result.summary);
  const summaryText = string(summary?.text);
  const findings = Array.isArray(result.findings) ? result.findings.filter(isRecord) : [];
  return (
    <section aria-labelledby="ngee-ann-key-findings" className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-center gap-2">
        <EnergyIcon name="spark" className="h-4 w-4 text-primary" />
        <h4 id="ngee-ann-key-findings" className="text-sm font-semibold text-foreground">Key Findings</h4>
      </div>
      {summaryText ? <SafeAiMarkdown className="mt-3 text-base leading-7 text-foreground">{summaryText}</SafeAiMarkdown> : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {findings.map((finding, index) => (
          <article key={string(finding.id) ?? `finding:${index}`} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">{epistemicLabel(finding.epistemicStatus)}</p>
            <h5 className="mt-1 text-sm font-semibold leading-6 text-foreground">{string(finding.title)}</h5>
            {string(finding.text) ? <SafeAiMarkdown className="mt-2 text-sm leading-6 text-muted">{finding.text as string}</SafeAiMarkdown> : null}
            <EvidenceRefs value={finding.evidenceRefs} />
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionInterpretation({ label, unit }: { label: string; unit: EnergyProjectOverviewAiUnitStatusDto }) {
  if (unit.status !== "available") return <UnitStatus title={label} unit={unit} />;
  const result = unit.result;
  const summary = record(result.summary);
  const summaryText = string(summary?.text);
  const insights = Array.isArray(result.insights) ? result.insights.filter(isRecord) : [];
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-primary">Section interpretation</p>
      <h4 className="mt-1 text-base font-semibold text-foreground">{label}</h4>
      {summaryText ? <SafeAiMarkdown className="mt-3 text-sm leading-6 text-foreground">{summaryText}</SafeAiMarkdown> : null}
      {insights.length > 0 ? <div className="mt-4 space-y-3 border-t border-border pt-4">
        {insights.map((insight, index) => <article key={string(insight.id) ?? `insight:${index}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-sm font-semibold text-foreground">{string(insight.title)}</h5>
            <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[10px] font-semibold text-muted">
              {epistemicLabel(insight.epistemicStatus)}
            </span>
          </div>
          {string(insight.text) ? <SafeAiMarkdown className="mt-1 text-sm leading-6 text-muted">{insight.text as string}</SafeAiMarkdown> : null}
          {string(insight.deepDiveQuestion) ? <p className="mt-2 text-xs font-medium text-primary">Explore: {insight.deepDiveQuestion as string}</p> : null}
          <EvidenceRefs value={insight.evidenceRefs} />
        </article>)}
      </div> : null}
    </section>
  );
}

function AdditionalInsights({ unit }: { unit: EnergyProjectOverviewAiUnitStatusDto }) {
  if (unit.status !== "available") return <UnitStatus title="Additional AI Insights" unit={unit} />;
  const findings = Array.isArray(unit.result.findings) ? unit.result.findings.filter(isRecord) : [];
  if (findings.length === 0) return <UnitStatus title="Additional AI Insights" unit={unit} />;

  return <section aria-labelledby="ngee-ann-additional-insights" className="border-t border-border pt-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-3xl">
        <h4 id="ngee-ann-additional-insights" className="text-base font-semibold text-foreground">
          Additional AI Insights
        </h4>
        <p className="mt-1 text-sm leading-6 text-muted">
          New analytical angles that passed the local Evidence and novelty checks. Treat inferred ideas as leads to verify, not confirmed causes.
        </p>
      </div>
      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
        Exploratory
      </span>
    </div>
    <div className={findings.length > 1 ? "mt-4 grid gap-4 xl:grid-cols-2" : "mt-4 grid gap-4"}>
      {findings.map((finding, index) => {
        const title = string(finding.title);
        const text = string(finding.text);
        const deepDiveQuestion = string(finding.deepDiveQuestion);
        return <article key={string(finding.id) ?? `additional:${index}`} className="min-w-0 rounded-xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h5 className="max-w-3xl text-base font-semibold leading-6 text-foreground">{title}</h5>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-primary">
              {epistemicLabel(finding.epistemicStatus)}
            </span>
          </div>
          {text ? <SafeAiMarkdown className="mt-3 max-w-[75ch] text-sm leading-6 text-foreground">{text}</SafeAiMarkdown> : null}
          {deepDiveQuestion ? <p className="mt-4 border-t border-primary/15 pt-3 text-sm leading-6 text-muted">
            <span className="font-semibold text-foreground">Explore further:</span> {deepDiveQuestion}
          </p> : null}
          <EvidenceRefs value={finding.evidenceRefs} />
        </article>;
      })}
    </div>
  </section>;
}

function UnitStatus({ title, unit }: { title: string; unit: EnergyProjectOverviewAiUnitStatusDto }) {
  const detail = unit.status === "missing"
    ? "Not generated for this Snapshot yet."
    : unit.status === "queued" || unit.status === "running"
      ? "Generation is in progress. Refresh to restore the saved result."
      : unit.status === "empty"
        ? "The analysis completed and found no additional conclusion worth publishing."
        : unit.status === "failed" || unit.status === "unavailable"
          ? unit.reason
          : "Available.";
  return <section className="rounded-xl border border-border bg-surface-subtle p-4" role="status">
    <p className="text-sm font-semibold text-foreground">{title}</p>
    <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
  </section>;
}

function EvidenceRefs({ value }: { value: unknown }) {
  const refs = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return refs.length > 0 ? <details className="mt-3 text-xs text-muted">
    <summary className="cursor-pointer font-medium">Evidence · {refs.length}</summary>
    <ul className="mt-2 space-y-1 break-all font-mono text-[10px] text-muted-light">
      {refs.map((ref) => <li key={ref}>{ref}</li>)}
    </ul>
  </details> : null;
}

function matchesSnapshot(model: EnergyProjectOverviewAiReadModelDto, snapshot: EnergyProjectAnalysisSnapshotDto): boolean {
  return model.contract === "energyiq-project-overview-ai-read-model@1"
    && model.rendererKey === "ngee-ann-overview"
    && model.binding.projectId === snapshot.context.projectId
    && model.binding.scopeId === snapshot.context.scopeId
    && model.binding.dataSnapshotId === snapshot.dataSnapshot.id
    && model.binding.projectReleaseId === snapshot.projectRelease.id;
}

function terminal(unit: EnergyProjectOverviewAiUnitStatusDto | undefined): boolean {
  return Boolean(unit && (unit.status === "available" || unit.status === "empty" || unit.status === "failed" || unit.status === "unavailable"));
}

function epistemicLabel(value: unknown): string {
  return value === "observed" ? "Observed" : value === "inferred" ? "Inferred" : value === "speculative" ? "Possible" : "AI angle";
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
