"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

import {
  configApi,
  type EnergyProjectAnalysisSnapshotDto,
  type EnergyProjectOverviewAiReadModelDto,
  type EnergyProjectOverviewAiUnitStatusDto,
} from "../../../lib/config-api";
import { SafeAiMarkdown } from "./safe-ai-markdown";

type OverviewAiReadPin = {
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
};

const defaultRestore = (projectId: string, scopeId: string, pin: OverviewAiReadPin) =>
  configApi.getEnergyProjectOverviewAiReadModel(projectId, scopeId, pin);

type TuyaOfficeAiContextValue = {
  model?: EnergyProjectOverviewAiReadModelDto;
  error?: string;
  restoring: boolean;
  aiAnalystHref?: string;
  snapshot: EnergyProjectAnalysisSnapshotDto;
};

const TuyaOfficeAiContext = createContext<TuyaOfficeAiContextValue | null>(null);

export function TuyaOfficeProjectAiProvider({
  snapshot,
  savedModel,
  aiAnalystHref,
  enabled = true,
  restore = defaultRestore,
  children,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  savedModel?: EnergyProjectOverviewAiReadModelDto;
  aiAnalystHref?: string;
  enabled?: boolean;
  restore?: (
    projectId: string,
    scopeId: string,
    pin: OverviewAiReadPin,
  ) => Promise<EnergyProjectOverviewAiReadModelDto>;
  children: React.ReactNode;
}) {
  const identityKey = `${snapshot.context.projectId}:${snapshot.context.scopeId}:${snapshot.dataSnapshot.id}:${snapshot.projectRelease.id}`;
  const [state, setState] = useState<{
    identityKey: string;
    model?: EnergyProjectOverviewAiReadModelDto;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!enabled || savedModel) return;
    let active = true;
    void restore(snapshot.context.projectId, snapshot.context.scopeId, overviewAiReadPin(snapshot))
      .then((model) => {
        if (!active) return;
        setState(matchesSnapshot(model, snapshot)
          ? { identityKey, model }
          : { identityKey, error: "Saved AI analysis does not match this Snapshot and Release." });
      })
      .catch(() => {
        if (active) setState({ identityKey, error: "Saved AI analysis is temporarily unavailable." });
      });
    return () => { active = false; };
  }, [enabled, identityKey, restore, savedModel, snapshot]);

  const model = savedModel
    ? (matchesSnapshot(savedModel, snapshot) ? savedModel : undefined)
    : state?.identityKey === identityKey ? state.model : undefined;
  const error = savedModel && !model
    ? "Saved AI analysis does not match this Snapshot and Release."
    : state?.identityKey === identityKey ? state.error : undefined;
  return (
    <TuyaOfficeAiContext.Provider value={{
      ...(model ? { model } : {}),
      ...(error ? { error } : {}),
      restoring: enabled && !model && !error,
      ...(aiAnalystHref ? { aiAnalystHref } : {}),
      snapshot,
    }}>
      {children}
    </TuyaOfficeAiContext.Provider>
  );
}

export function TuyaOfficeProjectAiRegion({
  regionId,
  showRestoreStatus = false,
}: {
  regionId: string;
  showRestoreStatus?: boolean;
}) {
  const state = useContext(TuyaOfficeAiContext);
  if (!state) return null;
  if (!state.model) {
    return showRestoreStatus && (state.restoring || state.error) ? (
      <div className="mt-4 rounded-xl border border-[#cbd8d0] bg-[#f0f4ef] px-5 py-4" data-governed-ai-status={state.error ? "unavailable" : "restoring"}>
        <p className="text-sm font-semibold text-[#28483c]">Governed AI interpretation</p>
        <p className="mt-1 text-sm leading-6 text-[#607068]" role="status">
          {state.error ?? "Reading the exact saved Artifact…"}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#718078]">Opening the page never starts a Provider run.</p>
      </div>
    ) : null;
  }
  const units = tuyaOfficeAiUnitsForRegion(state.model, regionId);
  if (units.length === 0) return null;
  return (
    <div className="mt-6 space-y-4" data-governed-ai-region={regionId}>
      {units.map(({ key, label, targetId, unit, prominent }) => (
        <TuyaOfficeAiSection key={key} label={label} targetId={targetId} unit={unit} prominent={prominent} aiAnalystHref={state.aiAnalystHref} snapshot={state.snapshot} />
      ))}
    </div>
  );
}

export const tuyaOfficeAiUnitsForRegion = (
  model: EnergyProjectOverviewAiReadModelDto,
  regionId: string,
) => [
    ...(model.surface?.keyFindings?.regionId === regionId
      ? [{ key: model.surface.keyFindings.slotId, label: model.surface.keyFindings.label, targetId: "executive-synthesis", unit: model.keyFindings, prominent: true, order: model.surface.keyFindings.order }]
      : []),
    ...(model.surface?.sections ?? []).flatMap((section) => section.regionId === regionId ? [{
      key: section.slotId ?? section.id,
      label: section.label,
      targetId: section.id,
      unit: model.sections[section.id] ?? { status: "missing" as const },
      prominent: false,
      order: section.order ?? Number.MAX_SAFE_INTEGER,
    }] : []),
    ...(model.surface?.additionalInsights?.regionId === regionId
      ? [{ key: model.surface.additionalInsights.slotId, label: model.surface.additionalInsights.label, targetId: "additional-insights", unit: model.additionalInsights, prominent: false, order: model.surface.additionalInsights.order }]
      : []),
  ].sort((left, right) => left.order - right.order);

function TuyaOfficeAiSection({
  label,
  targetId,
  unit,
  prominent = false,
  aiAnalystHref,
  snapshot,
}: {
  label: string;
  targetId: string;
  unit: EnergyProjectOverviewAiUnitStatusDto;
  prominent?: boolean;
  aiAnalystHref?: string;
  snapshot: EnergyProjectAnalysisSnapshotDto;
}) {
  const presentation = tuyaOfficeAiUnitPresentation(unit);
  return (
    <article className={`rounded-lg border border-[#d8e2dc] bg-white p-4 ${prominent ? "sm:p-5" : ""}`} data-ai-unit-status={unit.status}>
      <h3 className="text-sm font-semibold text-[#20352d]">{label}</h3>
      {presentation.summary ? <SafeAiMarkdown className="mt-3 text-sm leading-6 text-[#52645c]">{presentation.summary}</SafeAiMarkdown> : null}
      {presentation.summaryWindowIds.length > 0 ? <p className="mt-2 text-[11px] text-[#718078]">Report window: {presentation.summaryWindowIds.join(", ")}</p> : null}
      <EvidenceRefs refs={presentation.summaryEvidenceRefs} />
      {presentation.limitation ? (
        <p className="mt-3 rounded-md bg-[#f6f1e6] px-3 py-2 text-xs leading-5 text-[#725d2b]">
          <span className="font-semibold">Limitation:</span> {presentation.limitation}
        </p>
      ) : null}
      {presentation.findings.length > 0 ? (
        <div className="mt-3 space-y-2">
          {presentation.findings.map((finding) => {
            const findingHref = aiAnalystHref && unit.status === "available"
              ? buildTuyaOfficeFindingHref(aiAnalystHref, {
                artifactId: unit.artifactId,
                targetId,
                finding,
                snapshot,
              })
              : null;
            return <details id={aiFindingAnchorId(finding.id)} key={finding.id} className="scroll-mt-24 rounded-md border border-[#e0e7e2] bg-[#fbfcfb] px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold leading-5 text-[#28483c]">
                {finding.title}
                {finding.epistemicStatus ? <span className="ml-2 font-medium text-[#718078]">· {finding.epistemicStatus}</span> : null}
                <span className="ml-2 font-medium text-[#718078]">· {finding.evidenceRefs.length > 0 ? `${finding.evidenceRefs.length} evidence` : "evidence unavailable"}</span>
              </summary>
              {finding.text ? <SafeAiMarkdown className="mt-3 text-sm leading-6 text-[#52645c]">{finding.text}</SafeAiMarkdown> : null}
              {finding.deepDiveQuestion ? (
                <p className="mt-3 text-xs leading-5 text-[#386c5a]"><span className="font-semibold">Verify next:</span> {finding.deepDiveQuestion}</p>
              ) : null}
              {finding.windowIds.length > 0 ? <p className="mt-3 text-[11px] text-[#718078]">Report window: {finding.windowIds.join(", ")}</p> : null}
              {finding.sourceSectionIds.length > 0 ? <p className="mt-2 text-xs leading-5 text-[#607068]"><span className="font-semibold">Source Sections:</span> {finding.sourceSectionIds.join(", ")}</p> : null}
              {finding.sourceInsightIds.length > 0 ? <p className="mt-1 break-all text-xs leading-5 text-[#607068]"><span className="font-semibold">Source Insights:</span> {finding.sourceInsightIds.map((sourceInsightId, index) => <React.Fragment key={sourceInsightId}>{index > 0 ? ", " : null}<a className="underline decoration-[#8db5a6] underline-offset-2" href={`#${aiFindingAnchorId(sourceInsightId)}`}>{sourceInsightId}</a></React.Fragment>)}</p> : null}
              {finding.relationship ? (
                <div className="mt-3 rounded-md bg-[#f1f5f2] px-3 py-2 text-xs leading-5 text-[#52645c]">
                  <p><span className="font-semibold">Relationship:</span> {finding.relationship.novelConclusion}</p>
                  <p className="mt-1 break-all">Related claims: {finding.relationship.relatedPresentedClaimIds.join(", ") || "none"}</p>
                  <p className="mt-1">Relationship assertion: {finding.relationship.relationshipAssertion ? "yes — inference controls applied" : "no — contextual comparison only"}</p>
                </div>
              ) : null}
              {finding.origin ? <p className="mt-3 text-xs leading-5 text-[#607068]"><span className="font-semibold">Origin:</span> {finding.origin}</p> : null}
              {finding.alert ? <div className="mt-3 rounded-md bg-[#fff3df] px-3 py-2 text-xs leading-5 text-[#754f19]"><p><span className="font-semibold">Alert:</span> {finding.alert.severity} · {finding.alert.certainty}</p><EvidenceRefs refs={finding.alert.evidenceRefs} /></div> : null}
              <EvidenceRefs refs={finding.evidenceRefs} />
              {findingHref ? <a href={findingHref} className="mt-3 inline-flex text-xs font-semibold text-[#27624f] underline decoration-[#8db5a6] underline-offset-4">Investigate with the advisor</a> : null}
            </details>
          })}
        </div>
      ) : null}
      {!presentation.summary && presentation.findings.length === 0 ? <p className="mt-3 text-xs leading-5 text-[#68766f]">{presentation.fallback}</p> : null}
    </article>
  );
}

type TuyaOfficeAiFindingPresentation = {
  id: string;
  title: string;
  text?: string;
  epistemicStatus?: string;
  deepDiveQuestion?: string;
  evidenceRefs: string[];
  windowIds: string[];
  sourceSectionIds: string[];
  sourceInsightIds: string[];
  relationship?: {
    relatedPresentedClaimIds: string[];
    novelConclusion: string;
    relationshipAssertion: boolean;
  };
  origin?: string;
  alert?: { severity: string; certainty: string; evidenceRefs: string[] };
};

export const buildTuyaOfficeFindingHref = (
  base: string,
  input: {
    artifactId: string;
    targetId: string;
    finding: TuyaOfficeAiFindingPresentation;
    snapshot: EnergyProjectAnalysisSnapshotDto;
  },
): string | null => {
  const maxHandoffReferenceCount = 8;
  const maxHandoffParameterLength = 8_000;
  const maxHandoffIdLength = 200;
  const reportTime = input.snapshot.reportTimeContext;
  const executableQuestion = boundedTuyaAnalystText(input.finding.deepDiveQuestion, 800);
  if (input.snapshot.context.projectId !== "tuya-office"
    || input.snapshot.context.resource !== "electricity"
    || !executableQuestion
    || input.finding.evidenceRefs.length === 0
    || input.finding.evidenceRefs.length > maxHandoffReferenceCount
    || input.finding.windowIds.length === 0
    || input.finding.windowIds.length > maxHandoffReferenceCount
    || !reportTime
    || reportTime.windows.length > maxHandoffReferenceCount
    || !tuyaHandoffIdsAreExact([
      input.artifactId,
      input.targetId,
      input.finding.id,
      input.snapshot.context.projectId,
      input.snapshot.context.scopeId,
      input.snapshot.context.resource,
      input.snapshot.context.from,
      input.snapshot.context.to,
      input.snapshot.dataSnapshot.id,
      input.snapshot.projectRelease.id,
      reportTime.contractRevision,
      reportTime.policyId,
      reportTime.policyRevision,
      reportTime.timezone,
      reportTime.acceptedDataEndExclusive,
      reportTime.dataThroughLocalDate,
      reportTime.binding.projectId,
      reportTime.binding.scopeId,
      reportTime.binding.resource,
      reportTime.binding.dataSnapshotId,
      reportTime.binding.projectReleaseId,
      ...input.finding.evidenceRefs,
      ...input.finding.windowIds,
      ...input.finding.sourceSectionIds,
      ...input.finding.sourceInsightIds,
      ...reportTime.windows.flatMap((window) => [window.windowId, window.from, window.toExclusive]),
    ], maxHandoffIdLength)
    || input.finding.sourceSectionIds.length > maxHandoffReferenceCount
    || input.finding.sourceInsightIds.length > maxHandoffReferenceCount
    || reportTime.windows.some((window) => !boundedTuyaAnalystText(window.label, 800))
    || reportTime.binding.projectId !== input.snapshot.context.projectId
    || reportTime.binding.scopeId !== input.snapshot.context.scopeId
    || reportTime.binding.resource !== input.snapshot.context.resource
    || reportTime.binding.dataSnapshotId !== input.snapshot.dataSnapshot.id
    || reportTime.binding.projectReleaseId !== input.snapshot.projectRelease.id
    || !input.finding.windowIds.every((windowId) => reportTime.windows.some((window) => window.windowId === windowId))) {
    return null;
  }
  const [path, query = ""] = base.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("projectId", input.snapshot.context.projectId);
  params.set("scopeId", input.snapshot.context.scopeId);
  params.set("resource", input.snapshot.context.resource);
  params.set("period", "Custom");
  params.set("from", input.snapshot.context.from);
  params.set("to", input.snapshot.context.to);
  params.set("dataSnapshotId", input.snapshot.dataSnapshot.id);
  params.set("projectReleaseId", input.snapshot.projectRelease.id);
  const findingJson = JSON.stringify({
    kind: "tuya-overview-finding",
    findingId: input.finding.id,
    targetId: input.targetId,
    artifactId: input.artifactId,
    title: input.finding.title,
    what: input.finding.text ?? input.finding.title,
    howToVerify: executableQuestion,
    sourceSectionIds: input.finding.sourceSectionIds,
    sourceInsightIds: input.finding.sourceInsightIds,
  });
  const evidenceJson = JSON.stringify({
    snapshotId: input.snapshot.dataSnapshot.id,
    projectReleaseId: input.snapshot.projectRelease.id,
    scopeId: input.snapshot.context.scopeId,
    resource: input.snapshot.context.resource,
    evidenceRefs: input.finding.evidenceRefs,
    windowIds: input.finding.windowIds,
    period: { from: input.snapshot.context.from, to: input.snapshot.context.to },
    reportTime: {
      contractRevision: reportTime.contractRevision,
      binding: reportTime.binding,
      timezone: reportTime.timezone,
      acceptedDataEndExclusive: reportTime.acceptedDataEndExclusive,
      dataThroughLocalDate: reportTime.dataThroughLocalDate,
      policyId: reportTime.policyId,
      policyRevision: reportTime.policyRevision,
      windows: reportTime.windows.map((window) => ({
        windowId: window.windowId,
        label: window.label,
        phase: window.phase,
        from: window.from,
        toExclusive: window.toExclusive,
        completeDayCount: window.completeDayCount,
      })),
    },
    note: "Use only the cited Evidence within the pinned Snapshot, Release and report window.",
  });
  if (findingJson.length > maxHandoffParameterLength || evidenceJson.length > maxHandoffParameterLength) {
    return null;
  }
  params.set("finding", findingJson);
  params.set("evidence", evidenceJson);
  return `${path}?${params.toString()}`;
};

const boundedTuyaAnalystText = (value: string | undefined, maxLength: number): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]+/gu, " ").replace(/\s+/gu, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
};

const tuyaHandoffIdsAreExact = (values: readonly string[], maxLength: number): boolean =>
  values.every((value) => boundedTuyaAnalystText(value, maxLength) === value);

export const tuyaOfficeAiUnitPresentation = (
  unit: EnergyProjectOverviewAiUnitStatusDto,
): { summary?: string; summaryEvidenceRefs: string[]; summaryWindowIds: string[]; limitation?: string; findings: TuyaOfficeAiFindingPresentation[]; fallback: string } => {
  if (unit.status !== "available") {
    const fallback = unit.status === "empty"
      ? "The governed run found no publishable interpretation for this Section."
      : unit.status === "failed" || unit.status === "unavailable"
        ? unit.reason
        : unit.status === "queued" || unit.status === "running"
          ? "Analysis is being generated from the pinned Section Pack."
          : "No saved analysis has been generated for this exact Snapshot.";
    return { summaryEvidenceRefs: [], summaryWindowIds: [], findings: [], fallback };
  }
  const result = unit.result;
  const summaryValue = isRecord(result.summary) ? result.summary.text : undefined;
  const summary = typeof summaryValue === "string" && summaryValue.trim() ? summaryValue : undefined;
  const summaryEvidenceRefs = isRecord(result.summary) ? stringArray(result.summary.evidenceRefs) : [];
  const summaryWindowIds = isRecord(result.summary) ? [
    ...(typeof result.summary.windowId === "string" ? [result.summary.windowId] : []),
    ...stringArray(result.summary.windowIds),
  ].filter((value, offset, values) => value.trim() && values.indexOf(value) === offset) : [];
  const limitation = typeof result.limitation === "string" && result.limitation.trim()
    ? result.limitation
    : undefined;
  const candidates = Array.isArray(result.insights)
    ? result.insights
    : Array.isArray(result.findings) ? result.findings : [];
  const findings = candidates.flatMap((candidate, index): TuyaOfficeAiFindingPresentation[] => {
    if (!isRecord(candidate) || typeof candidate.title !== "string" || !candidate.title.trim()) return [];
    const evidenceRefs = stringArray(candidate.evidenceRefs);
    const windowIds = [
      ...(typeof candidate.windowId === "string" ? [candidate.windowId] : []),
      ...stringArray(candidate.windowIds),
    ].filter((value, offset, values) => value.trim() && values.indexOf(value) === offset);
    const relationship = isRecord(candidate.relationship)
      && typeof candidate.relationship.novelConclusion === "string"
      && typeof candidate.relationship.relationshipAssertion === "boolean"
      ? {
          relatedPresentedClaimIds: stringArray(candidate.relationship.relatedPresentedClaimIds),
          novelConclusion: candidate.relationship.novelConclusion,
          relationshipAssertion: candidate.relationship.relationshipAssertion,
        }
      : undefined;
    const origin = isRecord(candidate.origin) && typeof candidate.origin.kind === "string"
      ? [
          candidate.origin.kind,
          ...stringArray(candidate.origin.directionMethodResourceIds),
          ...(typeof candidate.origin.novelContribution === "string" ? [candidate.origin.novelContribution] : []),
        ].join(" · ")
      : undefined;
    const alert = isRecord(candidate.alert)
      && typeof candidate.alert.severity === "string"
      && typeof candidate.alert.certainty === "string"
      ? {
          severity: candidate.alert.severity,
          certainty: candidate.alert.certainty,
          evidenceRefs: stringArray(candidate.alert.evidenceRefs),
        }
      : undefined;
    return [{
      id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `finding:${index}`,
      title: candidate.title,
      ...(typeof candidate.text === "string" && candidate.text.trim() ? { text: candidate.text } : {}),
      ...(typeof candidate.epistemicStatus === "string" ? { epistemicStatus: candidate.epistemicStatus } : {}),
      ...(typeof candidate.deepDiveQuestion === "string" && candidate.deepDiveQuestion.trim()
        ? { deepDiveQuestion: candidate.deepDiveQuestion }
        : {}),
      evidenceRefs,
      windowIds,
      sourceSectionIds: stringArray(candidate.sectionIds),
      sourceInsightIds: stringArray(candidate.sourceInsightIds),
      ...(relationship ? { relationship } : {}),
      ...(origin ? { origin } : {}),
      ...(alert ? { alert } : {}),
    }];
  });
  return {
    ...(summary ? { summary } : {}),
    summaryEvidenceRefs,
    summaryWindowIds,
    ...(limitation ? { limitation } : {}),
    findings,
    fallback: "The stored Artifact does not contain a publishable Section interpretation.",
  };
};

function EvidenceRefs({ refs }: { refs: string[] }) {
  return refs.length > 0 ? (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-[#607068]">Evidence</p>
      <ul className="mt-1 space-y-1 break-all font-mono text-[10px] text-[#7b8881]">
        {refs.map((ref) => <li key={ref}>{ref}</li>)}
      </ul>
    </div>
  ) : null;
}

const matchesSnapshot = (
  model: EnergyProjectOverviewAiReadModelDto,
  snapshot: EnergyProjectAnalysisSnapshotDto,
): boolean => model.rendererKey === "tuya-office-overview"
  && model.surface !== undefined
  && model.surface.overviewDefinitionRevision.startsWith(`${snapshot.projectRelease.id}:`)
  && model.binding.projectId === snapshot.context.projectId
  && model.binding.scopeId === snapshot.context.scopeId
  && model.binding.dataSnapshotId === snapshot.dataSnapshot.id
  && model.binding.projectReleaseId === snapshot.projectRelease.id;

const overviewAiReadPin = (snapshot: EnergyProjectAnalysisSnapshotDto): OverviewAiReadPin => ({
  from: localDate(snapshot.context.from, snapshot.context.timezone),
  to: localDate(new Date(Date.parse(snapshot.context.to) - 1).toISOString(), snapshot.context.timezone),
  dataSnapshotId: snapshot.dataSnapshot.id,
  projectReleaseId: snapshot.projectRelease.id,
});

const localDate = (value: string, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  : [];

const aiFindingAnchorId = (value: string): string =>
  `tuya-ai-finding-${value.replace(/[^a-zA-Z0-9_-]+/gu, "-")}`;
