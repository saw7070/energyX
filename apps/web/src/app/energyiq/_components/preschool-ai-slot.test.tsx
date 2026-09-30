/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreschoolOverviewAiReadModelDto } from "../../../lib/config-api";
import { buildEnergyAiHandoffInitialDraftPrompt } from "./energy-analysis-workbench";
import { PreschoolAiSlot } from "./preschool-ai-slot";
import type { PreschoolAiAcceptedArtifact } from "./preschool-ai-artifact";
import type { PreschoolAiLegacyRunResult, PreschoolAiProgress, PreschoolAiRunResult } from "./preschool-ai-run";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

describe("PreschoolAiSlot", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not start a new AI Run when a saved result is reopened", async () => {
    const snapshot = preschoolGoldenSnapshot();
    const startRun = vi.fn().mockResolvedValue(availableResult());
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        mode="saved"
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No completed AI result was attached");
    expect(container.textContent).toContain("never starts a new AI run");
  });

  it("restores current Layer 1-2 artifacts even when Layer 3 discovery inputs are unavailable", async () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.preschoolAppliances = {
      status: "unavailable",
      reason: {
        code: "PRESCHOOL_APPLIANCE_ALIAS_CONTRACT_UNSUPPORTED",
        message: "The published Circuit aliases do not match the accepted Preschool Appliance contract.",
      },
      evidence: {
        projectReleaseId: snapshot.projectRelease.id,
        dataSnapshotId: snapshot.dataSnapshot.id,
        hierarchyRevisionId: snapshot.context.hierarchyRevisionId,
        meterMappingRevisionId: snapshot.context.meterMappingRevisionId,
        sourceKind: "circuit",
      },
    };
    const startRun = vi.fn(() => new Promise<PreschoolAiRunResult>(() => undefined));

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={snapshot} sectionId="page-synthesis" startRun={startRun} />,
    ));

    expect(startRun).toHaveBeenCalledOnce();
    expect(startRun.mock.calls[0]?.[0]).toMatchObject({
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
    });
    expect(container.textContent).toContain("deterministic Overview is ready");
  });

  it("restores a frozen AI result without starting a new Run", async () => {
    const snapshot = preschoolGoldenSnapshot();
    const startRun = vi.fn();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        mode="saved"
        savedResult={availableResult()}
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.querySelector("[data-saved-ai-result='true']")?.textContent).toContain("run-1");
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.querySelector("[data-ai-presentation='true']")?.textContent).toContain("Centre G");
    expectDecisionSummaryBeforeVisual(container);
  });

  it.each([
    { shape: "missing findings", findings: undefined },
    { shape: "non-array findings", findings: "not-an-array" },
    { shape: "a null finding", findings: [null] },
    { shape: "an invalid finding object", findings: [{}] },
  ])("fails closed for a saved non-sectioned result with $shape", async ({ findings }) => {
    const startRun = vi.fn();
    const malformedResult: Record<string, unknown> = {
      status: "available",
      providerProfileId: "legacy-model-profile",
      runId: "malformed-legacy-run",
      packId: "preschool-analysis-pack",
      packRevision: "v1",
    };
    if (findings !== undefined) malformedResult.findings = findings;

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        mode="saved"
        savedResult={malformedResult as unknown as Extract<PreschoolAiRunResult, { status: "available" }>}
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Invalid saved AI result");
    expect(container.querySelector("article")).toBeNull();
  });

  it("renders accepted outcomes and labels an unverified explanation before passing it to Ask the advisor", async () => {
    const startRun = vi.fn();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        mode="saved"
        savedResult={acceptedResult()}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo"
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Expected if acted on");
    expect(container.textContent).toContain("If ignored");
    expect(container.textContent).toContain("Possible explanation · needs verification");
    expect(container.textContent).toContain("Equipment schedules may differ from the published Calendar.");
    const askUrl = new URL(container.querySelector<HTMLAnchorElement>("article a")!.href);
    expect(JSON.parse(askUrl.searchParams.get("finding") ?? "null")).toMatchObject({
      possibleExplanation: "Equipment schedules may differ from the published Calendar.",
      expectedIfAct: "The review should isolate the avoidable condition.",
      ifIgnored: "The unexplained closed-hour load may continue.",
    });
    const handoff = buildEnergyAiHandoffInitialDraftPrompt(askUrl.searchParams);
    expect(handoff).toContain("Unverified possible explanation: Equipment schedules may differ from the published Calendar.");
    expect(handoff).toContain("Expected if acted on: The review should isolate the avoidable condition.");
  });

  it("keeps the deterministic Overview ready while analysis progresses", async () => {
    let finish!: (result: PreschoolAiRunResult) => void;
    let report!: (progress: PreschoolAiProgress) => void;
    const startRun = vi.fn((_input, onProgress) => new Promise<PreschoolAiRunResult>((resolve) => {
      finish = resolve;
      report = onProgress ?? (() => undefined);
    }));
    await renderSlot(startRun);

    expect(container.textContent).toContain("Loading saved AI summary…");
    expect(container.textContent).toContain("deterministic Overview is ready");
    await act(async () => report("querying"));
    expect(container.textContent).toContain("Preparing AI summary…");
    await act(async () => report("validating"));
    expect(container.textContent).toContain("Validating the investigation…");
    await act(async () => report("drafting"));
    expect(container.textContent).toContain("Drafting findings…");
    await act(async () => finish(availableResult()));
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.textContent).toContain("Recommended next check");
    expect(container.textContent).toContain("Expected if acted on");
    expect(container.textContent).toContain("If ignored");
    expect(container.textContent).toContain("How to verify");
    expect(container.textContent).toContain("Limitations");
    expect(container.querySelectorAll("[data-ai-primary-takeaway='true']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-ai-primary-action='true']")).toHaveLength(2);
    expect(container.querySelector("[data-ai-secondary-details='true']")?.hasAttribute("open")).toBe(false);
  });

  it("shows an honest no-additional-finding state instead of filler", async () => {
    await renderSlot(vi.fn().mockResolvedValue({ ...availableResult(), findings: [] }));
    await act(async () => undefined);

    expect(container.textContent).toContain("No additional Evidence-backed candidates");
    expect(container.querySelectorAll("article")).toHaveLength(0);
  });

  it("keeps provider failure optional and the verified Overview unchanged", async () => {
    const onResult = vi.fn();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        startRun={vi.fn().mockResolvedValue({ status: "unavailable", reason: "provider unavailable" })}
        onResult={onResult}
      />,
    ));
    await act(async () => undefined);

    expect(onResult).toHaveBeenCalledWith({ status: "unavailable", reason: "provider unavailable" });
    expect(container.textContent).toContain("AI analysis unavailable");
    expect(container.textContent).toContain("verified Overview remains available and unchanged");
  });

  it("does not expose Retry for an ordinary live provider failure", async () => {
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        startRun={vi.fn().mockResolvedValue({ status: "unavailable", reason: "provider unavailable", retryable: true })}
      />,
    ));
    await act(async () => undefined);
    const retryButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Retry AI analysis"));
    expect(retryButton).toBeUndefined();
    expect(container.textContent).toContain("verified Overview remains available and unchanged");
  });

  it("does not expose Retry for an unavailable live v4 Section", async () => {
    const result = v4ReadModelResult();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="planning-outlook"
        liveResult={result}
        startRun={vi.fn(() => new Promise<PreschoolAiRunResult>(() => undefined))}
      />,
    ));
    const retryButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Retry AI analysis"));
    expect(retryButton).toBeUndefined();
    expect(container.textContent).toContain("This Section interpretation is unavailable");
  });

  it("does not expose Retry for unavailable live v4 Key Findings", async () => {
    const result = v4ReadModelResult();
    result.executive = { status: "unavailable", artifactId: "key-findings-v4", reason: "SYNTHESIS_FAILED" };
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        liveResult={result}
        startRun={vi.fn(() => new Promise<PreschoolAiRunResult>(() => undefined))}
      />,
    ));

    const retryButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Retry AI analysis"));
    expect(retryButton).toBeUndefined();
    expect(container.textContent).toContain("Executive Summary is unavailable");
  });

  it("opens compact Evidence and carries one Finding into Ask the advisor", async () => {
    await renderSlot(vi.fn().mockResolvedValue(availableResult()));
    await act(async () => undefined);
    const firstCard = container.querySelector("article")!;
    const evidenceButton = [...firstCard.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("View evidence"))!;
    await act(async () => evidenceButton.click());

    expect(document.body.textContent).toContain("preschool-analysis-pack@v1");
    expect(document.body.textContent).toContain("preschool-26b85b9c0b95e090");
    expect(document.body.textContent).toContain("audit-sql-1");
    expect(document.body.textContent).toContain("scope_summary_v1");
    expect(document.body.textContent).toContain("Rows 1");
    expect(document.body.textContent).toContain("12 ms");
    expect(document.body.textContent).toContain("preschool-centre-7");
    const askLink = firstCard.querySelector<HTMLAnchorElement>("a")!;
    expect(askLink.textContent).toContain("Ask the advisor");
    const askUrl = new URL(askLink.href);
    expect(Object.fromEntries(askUrl.searchParams)).toMatchObject({
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
      dataCutoff: "2026-05-31",
      dataSnapshotId: "preschool-26b85b9c0b95e090",
    });
    expect(buildEnergyAiHandoffInitialDraftPrompt(askUrl.searchParams)).toContain(
      "Centre G deserves investigation",
    );
    expect(buildEnergyAiHandoffInitialDraftPrompt(askUrl.searchParams)).toContain(
      "preschool-26b85b9c0b95e090",
    );
    expect(buildEnergyAiHandoffInitialDraftPrompt(askUrl.searchParams)).toContain(
      "Data cutoff reference: 2026-05-31",
    );
    expect(askUrl.searchParams.has("findingId")).toBe(false);
    expect(askUrl.searchParams.has("evidenceSnapshotId")).toBe(false);
  });

  it("keeps three Findings in a full-width scannable decision flow", async () => {
    const result = availableResult();
    result.findings.push(finding("preschool-ai-finding-3", "independent", false));
    await renderSlot(vi.fn().mockResolvedValue(result));
    await act(async () => undefined);

    const grid = container.querySelector('[aria-label="Preschool AI energy analyst findings"]')!;
    expect(grid.className).toContain("space-y-4");
    expect(grid.className).not.toContain("grid-cols");
    expect(container.querySelectorAll("article")).toHaveLength(3);
    expect(container.querySelectorAll("[data-ai-primary-takeaway='true']")).toHaveLength(3);
  });

  it("renders only the accepted Finding assigned to the current Overview section", async () => {
    const result = availableResult();
    result.findings[1] = finding("preschool-ai-finding-2", "independent", false, "centre-benchmark", ["efficiency"]);
    await renderSlot(vi.fn().mockResolvedValue(result), "centre-benchmark");
    await act(async () => undefined);

    expect(container.textContent).toContain("AI interpretation");
    expect(container.querySelector("[data-ai-section='centre-benchmark']")).not.toBeNull();
    expect(container.textContent).toContain("Standby is a separate angle");
    expect(container.textContent).not.toContain("Centre G deserves investigation");
    expect(container.querySelectorAll("article")).toHaveLength(1);
  });

  it("restores independent Section statuses without starting Provider or hiding successful siblings", async () => {
    const startRun = vi.fn();
    const result = sectionedResult();
    await act(async () => {
      root.render(<>
        <PreschoolAiSlot
          snapshot={preschoolGoldenSnapshot()}
          sectionId="page-synthesis"
          mode="saved"
          savedResult={result}
          startRun={startRun}
        />
        <PreschoolAiSlot
          snapshot={preschoolGoldenSnapshot()}
          sectionId="centre-benchmark"
          mode="saved"
          savedResult={result}
          startRun={startRun}
        />
        <PreschoolAiSlot
          snapshot={preschoolGoldenSnapshot()}
          sectionId="standby-wastage"
          mode="saved"
          savedResult={result}
          startRun={startRun}
        />
      </>);
    });

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Benchmark evidence supports a focused review.");
    expect(container.textContent).toContain("AI takeaway");
    expect(container.querySelector("[data-ai-point-role='finding']")?.textContent).toContain("Supporting signal");
    expect(container.querySelector("[data-ai-point-role='next-check']")?.textContent).toContain("Next action");
    expect(container.textContent).toContain("Executive Summary is unavailable");
    expect(container.textContent).toContain("This Section interpretation is unavailable");
    expect(container.querySelector("[data-ai-section='centre-benchmark']")).not.toBeNull();
    expect(container.querySelector("[data-ai-section='standby-wastage']")).not.toBeNull();
  });

  it("renders saved v4 Key Findings from only the available Evidence-contributing Sections", async () => {
    const startRun = vi.fn();
    const result = v4ReadModelResult();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    expect(pageSlot).not.toBeNull();
    expect(pageSlot!.textContent).toContain("Key Findings");
    expect(pageSlot!.textContent).toContain("Reviewed 4 of 4 Sections");
    expect(pageSlot!.textContent).toContain("Findings cite 2 source Sections");
    expect(pageSlot!.textContent).not.toContain("Based on 4 of 4 Sections");
    expect(pageSlot!.querySelector('[aria-label="Key findings summary"]')).not.toBeNull();
    expect(pageSlot!.querySelector('[data-key-findings-grid="true"]')).not.toBeNull();
    expect(readableText(pageSlot)).toContain("Recurring time-pattern signals appear in both closed and opening hours.");
    expect(pageSlot!.textContent).toContain("Two time-pattern signals merit review");
    expect(readableText(pageSlot)).toContain(
      "Closed-hour energy and unusual opening-hour peaks are separately evidenced.",
    );

    const summary = findSafeMarkdownByText(pageSlot!, "Recurring time-pattern signals");
    expectSafeV4Markdown(summary, { strong: "time-pattern signals", emphasis: "Review them together" });
    const findingCard = findInsightCard(pageSlot!, "Two time-pattern signals merit review");
    const findingText = findSafeMarkdownByText(findingCard, "separately evidenced");
    expectSafeV4Markdown(findingText, { strong: "energy", emphasis: "peaks" });
    const findingDetail = findDisclosure(findingCard, /^Read full finding$/i);
    expect(findingDetail.open).toBe(false);
    expect(findingDetail.querySelector("details")).toBeNull();
    expect(findingDetail.textContent).toContain("standby:portfolio");
    expect(findingDetail.textContent).toContain("operating:spikes");
    expect(findingDetail.textContent).toContain("standby-wastage");
    expect(findingDetail.textContent).toContain("operating-behaviour");
    expect(findingDetail.textContent).not.toContain("section-standby-v4");
    expect(findingDetail.textContent).not.toContain("section-operating-v4");
    expect(findingDetail.textContent).not.toContain("section-benchmark-v4");

    const sourceArtifacts = findDisclosure(pageSlot!, /^Source Artifacts$/i);
    expect(sourceArtifacts.textContent).toContain("section-standby-v4");
    expect(sourceArtifacts.textContent).toContain("section-operating-v4");
    expect(sourceArtifacts.textContent).not.toContain("section-benchmark-v4");
    const summaryEvidence = findDisclosure(pageSlot!, /^Summary Evidence$/i);
    expect(summaryEvidence.textContent).toContain("standby:portfolio");
    expect(summaryEvidence.textContent).toContain("operating:spikes");
    expect(summaryEvidence.textContent).not.toContain("section-standby-v4");
  });

  it("shows Key Finding conclusions before complete accepted detail without starting a Run", async () => {
    const startRun = vi.fn();
    const result = v4ReadModelResult();

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={startRun}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo"
      />,
    ));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]')!;
    const findingCard = findInsightCard(pageSlot, "Two time-pattern signals merit review");
    const disclosure = findDisclosure(findingCard, /^Read full finding$/i);

    expect(startRun).not.toHaveBeenCalled();
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector("details")).toBeNull();

    await act(async () => {
      disclosure.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(disclosure.open).toBe(true);
    expect(readableText(disclosure)).toContain(
      "Closed-hour energy and unusual opening-hour peaks are separately evidenced.",
    );
    expect(readableText(disclosure)).toContain("standby-wastage");
    expect(readableText(disclosure)).toContain("standby:portfolio");
    expect(readableText(disclosure)).toContain("For the next evidence check, open a related Section insight.");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("uses the full reading width for one Key Finding and suppresses an exact duplicate Summary headline", async () => {
    const result = v4ReadModelResult();
    const executive = result.executive;
    if (executive.status !== "available" || !("findings" in executive.result)) throw new Error("v4 fixture missing");
    executive.result.summary.text = `${executive.result.findings[0]!.title}.`;

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]')!;
    const grid = pageSlot.querySelector<HTMLElement>('[data-key-findings-grid="true"]')!;
    expect(grid.className).not.toContain("lg:grid-cols-2");
    expect(pageSlot.querySelector('[aria-label="Key findings summary"]')).toBeNull();
    expect(pageSlot.querySelectorAll("article")).toHaveLength(1);
    expect([...pageSlot.querySelectorAll("h4")]
      .filter((heading) => heading.textContent === executive.result.findings[0]!.title)).toHaveLength(1);
  });

  it("suppresses a Summary that duplicates one Finding when other distinct Findings remain", async () => {
    const result = v4ReadModelResult();
    const executive = result.executive;
    if (executive.status !== "available" || !("findings" in executive.result)) throw new Error("v4 fixture missing");
    executive.result.summary.text = `Possible: ${executive.result.findings[0]!.title}.`;
    executive.result.findings[0]!.title = `Possible: ${executive.result.findings[0]!.title}`;
    executive.result.findings.push({
      ...executive.result.findings[0]!,
      id: "key-finding-cross-section-2",
      title: "A distinct second cross-section pattern",
      text: "A separately supported relationship remains visible after the duplicate Summary is removed.",
    });

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]')!;
    expect(pageSlot.querySelector('[aria-label="Key findings summary"]')).toBeNull();
    expect(pageSlot.querySelectorAll("article")).toHaveLength(2);
    expect(pageSlot.textContent).toContain("A distinct second cross-section pattern");
  });

  it("keeps a responsive two-column grid when Key Findings contains multiple distinct cards", async () => {
    const result = v4ReadModelResult();
    const executive = result.executive;
    if (executive.status !== "available" || !("findings" in executive.result)) throw new Error("v4 fixture missing");
    executive.result.findings.push({
      ...executive.result.findings[0]!,
      id: "key-finding-cross-section-2",
      title: "A second cross-section pattern remains distinct",
      text: "The same two Sections support a separately worded comparison for this layout fixture.",
    });

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    const grid = container.querySelector<HTMLElement>('[data-key-findings-grid="true"]')!;
    expect(grid.className).toContain("lg:grid-cols-2");
    expect(grid.querySelectorAll("article")).toHaveLength(2);
  });

  it("keeps terminal Section coverage separate from Evidence-contributing source artifacts for saved v4 empty Key Findings", async () => {
    const result = v4ReadModelResult();
    const executive = result.executive;
    if (executive.status !== "available" || !("findings" in executive.result)) throw new Error("v4 fixture missing");
    result.executive = {
      status: "empty",
      artifactId: executive.artifactId,
      result: {
        artifactKind: "executive-synthesis",
        status: "empty",
        providerProfileId: executive.result.providerProfileId,
        runId: executive.result.runId,
        binding: executive.result.binding,
        sourceSectionArtifactIds: executive.result.sourceSectionArtifactIds,
        findings: [],
      },
    };

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    expect(pageSlot?.textContent).toContain("Reviewed 4 of 4 sections");
    expect(pageSlot?.textContent).not.toContain("Findings cite");
  });

  it("renders a saved v4 Section summary and scoped Insight cards with a structured Explore handoff", async () => {
    const startRun = vi.fn();
    const result = v4ReadModelResult();
    const snapshot = preschoolGoldenSnapshot();
    snapshot.reportTimeContext = {
      contractRevision: "energyiq-report-time-context@1",
      binding: {
        workspaceId: snapshot.context.workspaceId,
        projectId: snapshot.context.projectId,
        scopeId: snapshot.context.scopeId,
        resource: snapshot.context.resource,
        dataSnapshotId: snapshot.dataSnapshot.id,
        projectReleaseId: snapshot.projectRelease.id,
      },
      timezone: snapshot.context.timezone,
      asOf: "2026-06-01T01:00:00.000Z",
      acceptedDataEndExclusive: "2026-05-31T16:00:00.000Z",
      dataThroughLocalDate: "2026-05-31",
      lastRefreshedAt: "2026-06-01T00:30:00.000Z",
      policyId: "preschool-report-time",
      policyRevision: "v1",
      windows: [{
        windowId: "current-overview",
        role: "overview",
        label: "Latest 28 complete days",
        strategy: { kind: "rolling_complete_days", days: 28 },
        phase: "complete",
        from: "2026-05-03T16:00:00.000Z",
        toExclusive: "2026-05-31T16:00:00.000Z",
        completeDayCount: 28,
        segments: [{ from: "2026-05-03T16:00:00.000Z", toExclusive: "2026-05-31T16:00:00.000Z" }],
        comparisonCompatibilityKey: "preschool-report-time:v1:Asia/Singapore:rolling-28",
      }],
    };
    const standby = result.sections["standby-wastage"];
    if (standby.status !== "available") throw new Error("v4 fixture missing");
    standby.result.summary.text = standby.result.summary.text.padEnd(416, " useful context");
    expect(standby.result.summary.text).toHaveLength(416);
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        sectionId="standby-wastage"
        mode="saved"
        savedResult={result}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&dataCutoff=2026-05-31&dataSnapshotId=preschool-26b85b9c0b95e090"
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    const sectionSlot = container.querySelector<HTMLElement>('[data-ai-section="standby-wastage"]');
    expect(sectionSlot).not.toBeNull();
    expect(readableText(sectionSlot)).toContain("Closed-hour energy recurs in the cited portfolio evidence.");
    for (const forbiddenLabel of ["AI takeaway", "Priority", "Supporting signal", "Why it matters", "Next action"]) {
      expect(sectionSlot!.textContent).not.toContain(forbiddenLabel);
    }

    const sectionSummary = findSafeMarkdownByText(sectionSlot!, "cited portfolio evidence");
    expectSafeV4Markdown(sectionSummary, { strong: "energy", emphasis: "Review the pattern" });
    expect(sectionSummary.classList.contains("w-full")).toBe(true);
    expect(sectionSummary.classList.contains("max-w-[75ch]")).toBe(false);
    expect(sectionSlot!.querySelector('[aria-label="Section summary"]')?.textContent).toContain("Summary");
    expect(sectionSlot!.querySelector('[aria-label="Section insights"]')?.textContent).toContain("Insights");

    const observedCard = findInsightCard(sectionSlot!, "Persistent closed-hour base load");
    const observedText = findSafeMarkdownByText(observedCard, "peer-baseline Evidence");
    expectSafeV4Markdown(observedText, { strong: "peer-baseline Evidence", emphasis: "Observed in the pinned Snapshot" });

    const speculativeCard = findInsightCard(sectionSlot!, "Schedule mismatch may contribute");
    expect(speculativeCard.textContent).toMatch(/Possible|Idea to test/);
    const speculativeText = findSafeMarkdownByText(speculativeCard, "recurring load boundaries");
    expectSafeV4Markdown(speculativeText, { strong: "closing times", emphasis: "Verify the operating state" });
    const insightDetail = findDisclosure(speculativeCard, /^Read full insight$/i);
    expect(insightDetail.open).toBe(false);
    expect(insightDetail.querySelector("details")).toBeNull();
    expect(insightDetail.textContent).toContain("standby:closing-boundary");

    const exploreLink = [...speculativeCard.querySelectorAll<HTMLAnchorElement>("a")]
      .find((link) => link.textContent?.includes("Explore with the advisor"));
    expect(exploreLink).toBeDefined();
    const exploreUrl = new URL(exploreLink!.href);
    const findingPayload = JSON.parse(exploreUrl.searchParams.get("finding") ?? "null") as Record<string, unknown>;
    expect(findingPayload).toMatchObject({
      kind: "section-insight",
      insightId: "standby-schedule-mismatch",
      sectionId: "standby-wastage",
      artifactId: "section-standby-v4",
      runId: "run-standby-v4",
      deepDiveQuestion: "Which Centres show recurring closed-hour load near the published closing boundary?",
    });
    const evidencePayload = JSON.parse(exploreUrl.searchParams.get("evidence") ?? "null") as Record<string, unknown>;
    expect(evidencePayload).toMatchObject({
      snapshotId: "preschool-26b85b9c0b95e090",
      projectReleaseId: "legacy-profile:preschool-demo:2",
      period: {
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-05-31T16:00:00.000Z",
      },
      evidenceRefs: ["standby:closing-boundary"],
      reportTime: {
        policyId: "preschool-report-time",
        policyRevision: "v1",
        dataThroughLocalDate: "2026-05-31",
        windows: [{
          windowId: "current-overview",
          from: "2026-05-03T16:00:00.000Z",
          toExclusive: "2026-05-31T16:00:00.000Z",
          phase: "complete",
          completeDayCount: 28,
        }],
      },
    });
    for (const forbiddenProvenance of ["dataCutoff", "deterministicEvidenceIds", "toolCallIds", "auditLogIds"]) {
      expect(evidencePayload).not.toHaveProperty(forbiddenProvenance);
    }
    const handoff = buildEnergyAiHandoffInitialDraftPrompt(exploreUrl.searchParams);
    expect(handoff).not.toBeNull();
    expect(handoff).toContain("Which Centres show recurring closed-hour load near the published closing boundary?");
    expect(handoff).toContain("Artifact: section-standby-v4");
    expect(handoff).toContain("Run: run-standby-v4");
    expect(handoff).toContain("Section: standby-wastage");
    expect(handoff).toContain("Insight: standby-schedule-mismatch");
    expect(handoff).toContain("Snapshot reference: preschool-26b85b9c0b95e090");
    expect(handoff).toContain("Project Release reference: legacy-profile:preschool-demo:2");
    expect(handoff).toContain("Report Time policy: preschool-report-time · v1 · Asia/Singapore");
    expect(handoff).toContain("Report window current-overview (Latest 28 complete days)");
    expect(handoff).toContain("Cited Evidence refs: standby:closing-boundary");
    expect(handoff).toContain("re-resolve the cited Evidence refs");
    for (const forbiddenProvenance of ["Data cutoff", "Deterministic Evidence IDs", "Tool call IDs", "Audit log IDs"]) {
      expect(handoff).not.toContain(forbiddenProvenance);
    }
  });

  it("uses the full reading width when a Section publishes only one Insight", async () => {
    const result = v4ReadModelResult();
    const standby = result.sections["standby-wastage"];
    if (standby.status !== "available") throw new Error("v4 fixture missing");
    standby.result.insights = standby.result.insights.slice(0, 1);

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="standby-wastage"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    const grid = container.querySelector<HTMLElement>('[aria-label="Section AI insights"]')!;
    expect(grid.className).not.toContain("lg:grid-cols-2");
    expect(grid.querySelectorAll("article")).toHaveLength(1);
  });

  it("shows the Insight conclusion before its complete accepted copy without starting a Run", async () => {
    const startRun = vi.fn();
    const result = v4ReadModelResult();

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="standby-wastage"
        mode="saved"
        savedResult={result}
        startRun={startRun}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo"
      />,
    ));

    const sectionSlot = container.querySelector<HTMLElement>('[data-ai-section="standby-wastage"]')!;
    const insightCard = findInsightCard(sectionSlot, "Schedule mismatch may contribute");
    const disclosure = findDisclosure(insightCard, /^Read full insight$/i);

    expect(startRun).not.toHaveBeenCalled();
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector("details")).toBeNull();

    await act(async () => {
      disclosure.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(disclosure.open).toBe(true);
    expect(readableText(disclosure)).toContain(
      "Published closing times and recurring load boundaries may differ.",
    );
    expect(readableText(disclosure)).toContain(
      "Which Centres show recurring closed-hour load near the published closing boundary?",
    );
    expect(readableText(disclosure)).toContain("does not establish equipment state");
    expect(readableText(disclosure)).toContain("standby:closing-boundary");
    expect(readableText(disclosure)).toContain("Verify the operating state");
    const exploreLink = [...disclosure.querySelectorAll<HTMLAnchorElement>("a")]
      .find((link) => link.textContent?.includes("Explore with the advisor"));
    expect(exploreLink).toBeDefined();
    const exploreUrl = new URL(exploreLink!.href);
    expect(JSON.parse(exploreUrl.searchParams.get("finding") ?? "null")).toMatchObject({
      kind: "section-insight",
      insightId: "standby-schedule-mismatch",
      sectionId: "standby-wastage",
    });
    expect(JSON.parse(exploreUrl.searchParams.get("evidence") ?? "null")).toMatchObject({
      snapshotId: "preschool-26b85b9c0b95e090",
      projectReleaseId: "legacy-profile:preschool-demo:2",
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("isolates saved v4 available-without-insights, empty and unavailable Section states", async () => {
    const startRun = vi.fn();
    const result = v4ReadModelResult();
    const emptySection = result.sections["centre-benchmark"];
    if (emptySection.status !== "empty" || !("insights" in emptySection.result)) throw new Error("v4 fixture missing");
    emptySection.result.limitation = "Only **published Evidence** was checked.  \n_Review more context_ before acting.";
    await act(async () => root.render(<>
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="centre-benchmark"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="operating-behaviour"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="planning-outlook"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />
    </>));

    expect(startRun).not.toHaveBeenCalled();
    const emptySlot = container.querySelector<HTMLElement>('[data-ai-section="centre-benchmark"]');
    const availableSlot = container.querySelector<HTMLElement>('[data-ai-section="operating-behaviour"]');
    const unavailableSlot = container.querySelector<HTMLElement>('[data-ai-section="planning-outlook"]');
    expect(emptySlot).not.toBeNull();
    expect(availableSlot).not.toBeNull();
    expect(unavailableSlot).not.toBeNull();

    expect(emptySlot!.textContent).toContain("No additional AI interpretation");
    expect(readableText(emptySlot)).toContain("Only published Evidence was checked.");
    const emptyLimitation = findSafeMarkdownByText(emptySlot!, "Review more context");
    expect(emptyLimitation.querySelector("strong")?.textContent).toBe("published Evidence");
    expect(emptyLimitation.querySelector("em")?.textContent).toBe("Review more context");
    expect(emptySlot!.querySelectorAll("article")).toHaveLength(0);
    expect(emptySlot!.textContent).not.toContain("Unusual opening-hour peaks recur");

    expect(readableText(availableSlot)).toContain("Unusual opening-hour peaks recur in the cited operating evidence.");
    expect(availableSlot!.querySelectorAll("article")).toHaveLength(0);
    expect(availableSlot!.textContent).not.toContain("No additional AI interpretation");
    expect(availableSlot!.textContent).not.toContain("unavailable");
    const availableSummary = findSafeMarkdownByText(availableSlot!, "cited operating evidence");
    expectSafeV4Markdown(availableSummary, { strong: "opening-hour peaks", emphasis: "Review recurrence" });

    expect(unavailableSlot!.textContent).toContain("This Section interpretation is unavailable");
    expect(unavailableSlot!.querySelectorAll("article")).toHaveLength(0);
    expect(unavailableSlot!.textContent).not.toContain("Unusual opening-hour peaks recur");
  });

  it("explains a planning honest-empty as a completed review instead of a generic no-value result", async () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.preschoolPlanningLifecycle = {
      status: "unavailable",
      reason: {
        code: "CURRENT_ACTUAL_UNAVAILABLE",
        message: "No complete current Actual day is available for the pinned monthly period.",
      },
    };
    const result = v4ReadModelResult();
    const benchmark = result.sections["centre-benchmark"];
    if (benchmark.status !== "empty" || !("insights" in benchmark.result)) throw new Error("v4 fixture missing");
    result.sections["planning-outlook"] = {
      status: "empty",
      artifactId: "section-planning-v4",
      result: {
        ...benchmark.result,
        runId: "run-planning-v4",
        sectionId: "planning-outlook",
      },
    };

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        sectionId="planning-outlook"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    const planningSlot = container.querySelector<HTMLElement>('[data-ai-section="planning-outlook"]')!;
    expect(planningSlot.textContent).toContain("AI review complete");
    expect(planningSlot.textContent).toContain("No complete current Actual day is available");
    expect(planningSlot.textContent).not.toContain("did not support a useful additional conclusion");
  });

  it("rejects mismatched outer and inner saved statuses locally without hiding a valid sibling", async () => {
    const executiveMismatch = cloneV4ReadModelResult();
    if (executiveMismatch.executive.status !== "available") throw new Error("v4 fixture missing");
    Object.assign(executiveMismatch.executive.result, { status: "empty", findings: [], summary: undefined });

    const sectionMismatch = cloneV4ReadModelResult();
    const standby = sectionMismatch.sections["standby-wastage"];
    if (standby.status !== "available") throw new Error("v4 fixture missing");
    Object.assign(standby, { status: "empty" });

    await act(async () => root.render(<>
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={executiveMismatch} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="standby-wastage" mode="saved" savedResult={sectionMismatch} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="operating-behaviour" mode="saved" savedResult={sectionMismatch} startRun={vi.fn()} />
    </>));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    const standbySlot = container.querySelector<HTMLElement>('[data-ai-section="standby-wastage"]');
    const operatingSlot = container.querySelector<HTMLElement>('[data-ai-section="operating-behaviour"]');
    expect(pageSlot?.textContent).toContain("Invalid saved AI result");
    expect(pageSlot?.textContent).not.toContain("Two time-pattern signals merit review");
    expect(standbySlot?.textContent).toContain("Invalid saved AI result");
    expect(standbySlot?.textContent).not.toContain("No additional AI interpretation");
    expect(readableText(operatingSlot)).toContain("Unusual opening-hour peaks recur");
  });

  it("isolates one terminal Section identity mismatch while preserving a valid sibling and Key Findings", async () => {
    const result = cloneV4ReadModelResult();
    const benchmark = result.sections["centre-benchmark"];
    if (benchmark.status !== "empty") throw new Error("v4 fixture missing");
    Object.assign(benchmark.result, { sectionId: "standby-wastage" });

    await act(async () => root.render(<>
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="centre-benchmark" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="operating-behaviour" mode="saved" savedResult={result} startRun={vi.fn()} />
    </>));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    const benchmarkSlot = container.querySelector<HTMLElement>('[data-ai-section="centre-benchmark"]');
    const operatingSlot = container.querySelector<HTMLElement>('[data-ai-section="operating-behaviour"]');
    expect(benchmarkSlot?.textContent).toContain("Invalid saved AI result");
    expect(benchmarkSlot?.textContent).not.toContain("No additional AI interpretation");
    expect(readableText(operatingSlot)).toContain("Unusual opening-hour peaks recur");
    expect(pageSlot?.textContent).toContain("Two time-pattern signals merit review");
    expect(pageSlot?.textContent).not.toContain("Invalid saved AI read model");
  });

  it("isolates an Executive identity mismatch without hiding valid v4 Sections", async () => {
    const result = cloneV4ReadModelResult();
    const executive = result.executive;
    if (executive.status !== "available") throw new Error("v4 fixture missing");
    Object.assign(executive.result, { binding: { ...executive.result.binding, modelProfileRevision: 2 } });

    await act(async () => root.render(<>
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="standby-wastage" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="operating-behaviour" mode="saved" savedResult={result} startRun={vi.fn()} />
    </>));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    expect(pageSlot?.textContent).toContain("Invalid saved AI result");
    expect(pageSlot?.textContent).not.toContain("Two time-pattern signals merit review");
    expect(container.querySelector<HTMLElement>('[data-ai-section="standby-wastage"]')?.textContent).toContain("Persistent closed-hour base load");
    expect(readableText(container.querySelector<HTMLElement>('[data-ai-section="operating-behaviour"]')))
      .toContain("Unusual opening-hour peaks recur");
  });

  it("isolates a live v3 Executive without hiding valid v4 Sections or publishing the mixed result", async () => {
    const result = cloneV4ReadModelResult();
    result.executive = {
      status: "available",
      artifactId: "executive-v3-live",
      result: {
        artifactKind: "executive-synthesis",
        status: "available",
        providerProfileId: result.binding.modelProfileId,
        runId: "run-executive-v3-live",
        binding: result.binding,
        sourceSectionArtifactIds: ["section-standby-v4"],
        keyFindings: [{
          id: "legacy-live-finding",
          takeaway: "Legacy Executive content must not render live.",
          sectionIds: ["standby-wastage"],
          evidenceRefs: ["standby:portfolio"],
        }],
      },
    };
    const onCompletedResult = vi.fn();

    await act(async () => root.render(<>
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        liveResult={result}
        startRun={vi.fn(() => new Promise<PreschoolAiRunResult>(() => undefined))}
        onCompletedResult={onCompletedResult}
      />
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="operating-behaviour"
        liveResult={result}
        startRun={vi.fn(() => new Promise<PreschoolAiRunResult>(() => undefined))}
      />
    </>));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    expect(pageSlot?.textContent).toContain("Invalid AI result");
    expect(pageSlot?.textContent).not.toContain("Legacy Executive content must not render live");
    expect(readableText(container.querySelector<HTMLElement>('[data-ai-section="operating-behaviour"]')))
      .toContain("Unusual opening-hour peaks recur");
    expect(onCompletedResult).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "wrong artifact kind",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available") Object.assign(unit.result, { artifactKind: "not-a-section" });
      },
    },
    {
      name: "malformed summary Evidence refs",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available") Object.assign(unit.result, { summary: { text: "unsafe summary", evidenceRefs: "not-an-array" } });
      },
    },
    {
      name: "Section summary over its technical safety ceiling",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available") Object.assign(unit.result.summary, { text: "S".repeat(4_097) });
      },
    },
    {
      name: "malformed Insight epistemic status",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available" && "insights" in unit.result) Object.assign(unit.result.insights[0]!, { epistemicStatus: "certain" });
      },
    },
    {
      name: "Insight label over its technical safety ceiling",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available" && "insights" in unit.result) Object.assign(unit.result.insights[0]!, { label: "L".repeat(513) });
      },
    },
    {
      name: "Section limitation over its technical safety ceiling",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available") Object.assign(unit.result, { limitation: "L".repeat(4_097) });
      },
    },
    {
      name: "malformed Key Finding Evidence refs",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available" && "findings" in unit.result) Object.assign(unit.result.findings[0]!, { evidenceRefs: "not-an-array" });
      },
    },
    {
      name: "Key Finding text over its technical safety ceiling",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available" && "findings" in unit.result) Object.assign(unit.result.findings[0]!, { text: "F".repeat(8_193) });
      },
    },
  ])("renders $name as a local invalid saved result", async ({ sectionId, mutate }) => {
    const result = cloneV4ReadModelResult();
    mutate(result);

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId={sectionId} mode="saved" savedResult={result} startRun={vi.fn()} />,
    ));

    const slot = container.querySelector<HTMLElement>(`[data-ai-section="${sectionId}"]`);
    expect(slot?.textContent).toContain("Invalid saved AI result");
    expect(slot?.querySelector("article")).toBeNull();
  });

  it("keeps useful accepted copy beyond old editorial limits readable", async () => {
    const result = cloneV4ReadModelResult();
    const section = result.sections["standby-wastage"];
    if (section.status !== "available" || !("insights" in section.result)) throw new Error("v4 Section fixture missing");
    const executive = result.executive;
    if (executive.status !== "available" || !("findings" in executive.result)) throw new Error("v4 Executive fixture missing");
    const sectionSummary = "S".repeat(481);
    const sectionTitle = "T".repeat(97);
    const sectionLabel = "L".repeat(49);
    const sectionInsight = "I".repeat(481);
    const limitation = "L".repeat(321);
    const executiveSummary = "E".repeat(601);
    const findingTitle = "K".repeat(97);
    const findingText = "F".repeat(421);
    section.result.summary.text = sectionSummary;
    section.result.insights[0]!.title = sectionTitle;
    section.result.insights[0]!.label = sectionLabel;
    section.result.insights[0]!.text = sectionInsight;
    section.result.limitation = limitation;
    executive.result.summary.text = executiveSummary;
    executive.result.findings[0]!.title = findingTitle;
    executive.result.findings[0]!.text = findingText;

    await act(async () => root.render(<>
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="standby-wastage" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />
    </>));

    expect(readableText(container)).toContain(sectionSummary);
    expect(readableText(container)).toContain(sectionTitle);
    expect(readableText(container)).toContain(sectionLabel);
    expect(readableText(container)).toContain(sectionInsight);
    expect(readableText(container)).toContain(limitation);
    expect(readableText(container)).toContain(executiveSummary);
    expect(readableText(container)).toContain(findingTitle);
    expect(readableText(container)).toContain(findingText);
    expect(readableText(container)).not.toContain("Invalid saved AI result");
  });

  it.each([
    {
      name: "a null binding",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result, { binding: null }),
    },
    {
      name: "missing sections",
      mutate: (result: PreschoolOverviewAiReadModelDto) => { Reflect.deleteProperty(result, "sections"); },
    },
    {
      name: "null sections",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result, { sections: null }),
    },
    {
      name: "missing executive",
      mutate: (result: PreschoolOverviewAiReadModelDto) => { Reflect.deleteProperty(result, "executive"); },
    },
    {
      name: "null executive",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result, { executive: null }),
    },
    {
      name: "a missing required Section key",
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        Reflect.deleteProperty(result.sections, "planning-outlook");
      },
    },
  ])("rejects a saved read model with $name without starting AI or hiding sibling content", async ({ mutate }) => {
    const result = cloneV4ReadModelResult();
    const startRun = vi.fn();
    mutate(result);

    await act(async () => root.render(<>
      <p data-deterministic-sibling="true">Verified Overview sibling remains visible.</p>
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />
    </>));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.querySelector('[data-deterministic-sibling="true"]')?.textContent).toBe("Verified Overview sibling remains visible.");
    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    expect(pageSlot?.textContent).toContain("Invalid saved AI read model");
    expect(pageSlot?.querySelector("article")).toBeNull();
  });

  it.each([
    {
      name: "a swapped Section result identity",
      sectionId: "standby-wastage" as const,
      expectedDetail: "Invalid saved AI result",
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status !== "available") throw new Error("v4 fixture missing");
        Object.assign(unit.result, { sectionId: "operating-behaviour" });
      },
    },
    {
      name: "a Section binding that differs from the outer binding",
      sectionId: "standby-wastage" as const,
      expectedDetail: "Invalid saved AI result",
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status !== "available") throw new Error("v4 fixture missing");
        Object.assign(unit.result, { binding: { ...unit.result.binding, scopeId: "other-scope" } });
      },
    },
    {
      name: "a provider profile that differs from the bound model",
      sectionId: "standby-wastage" as const,
      expectedDetail: "Invalid saved AI result",
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status !== "available") throw new Error("v4 fixture missing");
        Object.assign(unit.result, { providerProfileId: "other-provider-profile" });
      },
    },
    {
      name: "a Section model profile that differs from the outer binding",
      sectionId: "standby-wastage" as const,
      expectedDetail: "Invalid saved AI result",
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status !== "available") throw new Error("v4 fixture missing");
        Object.assign(unit.result, {
          providerProfileId: "other-model-profile",
          binding: { ...unit.result.binding, modelProfileId: "other-model-profile" },
        });
      },
    },
    {
      name: "a Section model revision that differs from the outer binding",
      sectionId: "standby-wastage" as const,
      expectedDetail: "Invalid saved AI result",
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status !== "available") throw new Error("v4 fixture missing");
        Object.assign(unit.result, { binding: { ...unit.result.binding, modelProfileRevision: 2 } });
      },
    },
    {
      name: "an outer workspace mismatch",
      sectionId: "page-synthesis" as const,
      expectedDetail: "Invalid saved AI read model",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result.binding, { workspaceId: "other-workspace" }),
    },
    {
      name: "an outer project mismatch",
      sectionId: "page-synthesis" as const,
      expectedDetail: "Invalid saved AI read model",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result.binding, { projectId: "other-project" }),
    },
    {
      name: "an outer scope mismatch",
      sectionId: "page-synthesis" as const,
      expectedDetail: "Invalid saved AI read model",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result.binding, { scopeId: "other-scope" }),
    },
    {
      name: "an outer Snapshot mismatch",
      sectionId: "page-synthesis" as const,
      expectedDetail: "Invalid saved AI read model",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result.binding, { dataSnapshotId: "other-snapshot" }),
    },
    {
      name: "an outer Project Release mismatch",
      sectionId: "page-synthesis" as const,
      expectedDetail: "Invalid saved AI read model",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result.binding, { projectReleaseId: "other-release" }),
    },
    {
      name: "an outer analysis period mismatch",
      sectionId: "page-synthesis" as const,
      expectedDetail: "Invalid saved AI read model",
      mutate: (result: PreschoolOverviewAiReadModelDto) => Object.assign(result.binding, {
        analysisPeriod: { ...result.binding.analysisPeriod, to: "2026-06-01T16:00:00.000Z" },
      }),
    },
  ])("rejects $name without rendering the mismatched v4 content", async ({ sectionId, expectedDetail, mutate }) => {
    const result = cloneV4ReadModelResult();
    const startRun = vi.fn();
    mutate(result);

    await act(async () => root.render(<>
      <p data-deterministic-sibling="true">Verified Overview sibling remains visible.</p>
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId={sectionId}
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />
    </>));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.querySelector('[data-deterministic-sibling="true"]')?.textContent).toContain("remains visible");
    const slot = container.querySelector<HTMLElement>(`[data-ai-section="${sectionId}"]`);
    expect(slot?.textContent).toContain(expectedDetail);
    expect(slot?.textContent).not.toContain("Two time-pattern signals merit review");
    expect(slot?.textContent).not.toContain("Persistent closed-hour base load");
  });

  it.each([
    {
      name: "an empty Section summary Evidence list",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available" && "insights" in unit.result) unit.result.summary.evidenceRefs = [];
      },
    },
    {
      name: "duplicate Section summary Evidence refs",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available" && "insights" in unit.result) unit.result.summary.evidenceRefs = ["standby:portfolio", "standby:portfolio"];
      },
    },
    {
      name: "an empty Insight Evidence list",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available" && "insights" in unit.result) unit.result.insights[0]!.evidenceRefs = [];
      },
    },
    {
      name: "duplicate Insight Evidence refs",
      sectionId: "standby-wastage" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.sections["standby-wastage"];
        if (unit.status === "available" && "insights" in unit.result) unit.result.insights[0]!.evidenceRefs = ["standby:recurrence", "standby:recurrence"];
      },
    },
    {
      name: "an empty Key Findings summary Evidence list",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available" && "findings" in unit.result) unit.result.summary.evidenceRefs = [];
      },
    },
    {
      name: "an empty Key Finding Evidence list",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available" && "findings" in unit.result) unit.result.findings[0]!.evidenceRefs = [];
      },
    },
    {
      name: "duplicate Key Finding Evidence refs",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available" && "findings" in unit.result) unit.result.findings[0]!.evidenceRefs = ["standby:portfolio", "standby:portfolio"];
      },
    },
    {
      name: "an empty Key Finding Section list",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available" && "findings" in unit.result) unit.result.findings[0]!.sectionIds = [];
      },
    },
    {
      name: "duplicate Key Finding Section IDs",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available" && "findings" in unit.result) unit.result.findings[0]!.sectionIds = ["standby-wastage", "standby-wastage"];
      },
    },
    {
      name: "duplicate source Section Artifact IDs",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available") unit.result.sourceSectionArtifactIds = ["section-standby-v4", "section-standby-v4"];
      },
    },
    {
      name: "more than four source Section Artifact IDs",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available") unit.result.sourceSectionArtifactIds = ["section-1", "section-2", "section-3", "section-4", "section-5"];
      },
    },
    {
      name: "a source Artifact from a non-available Section",
      sectionId: "page-synthesis" as const,
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const unit = result.executive;
        if (unit.status === "available") unit.result.sourceSectionArtifactIds = ["section-benchmark-v4"];
      },
    },
  ])("rejects v4 $name without rendering unsupported content", async ({ sectionId, mutate }) => {
    const result = cloneV4ReadModelResult();
    mutate(result);

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId={sectionId} mode="saved" savedResult={result} startRun={vi.fn()} />,
    ));

    const slot = container.querySelector<HTMLElement>(`[data-ai-section="${sectionId}"]`);
    expect(slot?.textContent).toMatch(/Invalid saved AI (?:read model|result)/u);
    expect(slot?.querySelector("article")).toBeNull();
    expect(slot?.textContent).not.toContain("Based on 5 of 4 sections");
  });

  it("rejects a Key Finding whose Section IDs are outside its contributing source Sections", async () => {
    const result = cloneV4ReadModelResult();
    const executive = result.executive;
    if (executive.status !== "available" || !("findings" in executive.result)) throw new Error("v4 fixture missing");
    executive.result.sourceSectionArtifactIds = ["section-standby-v4"];
    executive.result.findings[0]!.sectionIds = ["operating-behaviour"];

    await act(async () => root.render(<>
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="standby-wastage" mode="saved" savedResult={result} startRun={vi.fn()} />
    </>));

    expect(container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]')?.textContent).toContain("Invalid saved AI result");
    expect(container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]')?.textContent).not.toContain("Two time-pattern signals merit review");
    expect(container.querySelector<HTMLElement>('[data-ai-section="standby-wastage"]')?.textContent).toContain("Persistent closed-hour base load");
  });

  it("treats duplicate terminal Section Artifact IDs as ambiguous only for Executive lineage", async () => {
    const result = cloneV4ReadModelResult();
    const standby = result.sections["standby-wastage"];
    const operating = result.sections["operating-behaviour"];
    const executive = result.executive;
    if (standby.status !== "available" || operating.status !== "available" || executive.status !== "available") {
      throw new Error("v4 fixture missing");
    }
    operating.artifactId = standby.artifactId;
    executive.result.sourceSectionArtifactIds = [standby.artifactId];

    await act(async () => root.render(<>
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="standby-wastage" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="operating-behaviour" mode="saved" savedResult={result} startRun={vi.fn()} />
    </>));

    expect(container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]')?.textContent).toContain("Invalid saved AI result");
    expect(container.querySelector<HTMLElement>('[data-ai-section="standby-wastage"]')?.textContent).toContain("Persistent closed-hour base load");
    expect(readableText(container.querySelector<HTMLElement>('[data-ai-section="operating-behaviour"]')))
      .toContain("Unusual opening-hour peaks recur");
  });

  it.each(["queued", "running"] as const)(
    "does not treat an artifact ID injected into a %s Section as an Executive source",
    async (status) => {
      const result = cloneV4ReadModelResult();
      Object.assign(result.sections["centre-benchmark"], { status, artifactId: "section-benchmark-v4" });
      const executive = result.executive;
      if (executive.status !== "available") throw new Error("v4 fixture missing");
      executive.result.sourceSectionArtifactIds = ["section-benchmark-v4"];

      await act(async () => root.render(<>
        <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />
        <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="standby-wastage" mode="saved" savedResult={result} startRun={vi.fn()} />
      </>));

      expect(container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]')?.textContent).toContain("Invalid saved AI result");
      expect(container.querySelector<HTMLElement>('[data-ai-section="standby-wastage"]')?.textContent).toContain("Persistent closed-hour base load");
    },
  );

  it("allows Key Findings to cite unique deterministic Overview Evidence outside Section result Evidence", async () => {
    const result = cloneV4ReadModelResult();
    const executive = result.executive;
    if (executive.status !== "available" || !("findings" in executive.result)) throw new Error("v4 fixture missing");
    executive.result.summary.evidenceRefs = ["overview:deterministic-summary"];
    executive.result.findings[0]!.evidenceRefs = [
      "overview:deterministic-finding",
      "standby:portfolio",
      "operating:spikes",
    ];
    Object.assign(executive.result, {
      overviewEvidence: overviewEvidenceLineage(result.binding, [
        "overview:deterministic-summary",
        "overview:deterministic-finding",
      ]),
    });

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />,
    ));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    expect(pageSlot?.textContent).toContain("Two time-pattern signals merit review");
    expect(pageSlot?.textContent).toContain("overview:deterministic-summary");
    expect(pageSlot?.textContent).toContain("overview:deterministic-finding");
    expect(pageSlot?.textContent).not.toContain("Invalid saved AI result");
  });

  it.each([
    {
      name: "an Overview ref outside the selected catalog facts",
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const executive = result.executive;
        if (executive.status !== "available" || !("findings" in executive.result)) throw new Error("v4 fixture missing");
        executive.result.summary.evidenceRefs = ["overview:forged"];
        Object.assign(executive.result, {
          overviewEvidence: overviewEvidenceLineage(result.binding, ["overview:deterministic-summary"]),
        });
      },
    },
    {
      name: "Overview Evidence pinned to a different Snapshot",
      mutate: (result: PreschoolOverviewAiReadModelDto) => {
        const executive = result.executive;
        if (executive.status !== "available") throw new Error("v4 fixture missing");
        const lineage = overviewEvidenceLineage(result.binding, ["overview:deterministic-summary"]);
        lineage.pins.dataSnapshotId = "snapshot-other";
        Object.assign(executive.result, { overviewEvidence: lineage });
      },
    },
  ])("rejects $name only in page synthesis", async ({ mutate }) => {
    const result = cloneV4ReadModelResult();
    mutate(result);

    await act(async () => root.render(<>
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="standby-wastage" mode="saved" savedResult={result} startRun={vi.fn()} />
    </>));

    expect(container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]')?.textContent).toContain("Invalid saved AI result");
    expect(container.querySelector<HTMLElement>('[data-ai-section="standby-wastage"]')?.textContent).toContain("Persistent closed-hour base load");
  });

  it("counts only the four required Section keys for terminal coverage", async () => {
    const result = cloneV4ReadModelResult();
    result.executive = { status: "unavailable", artifactId: "key-findings-v4", reason: "SYNTHESIS_FAILED" };
    result.sections["planning-outlook"] = { status: "running" };
    const extraSections = result.sections as unknown as Record<string, unknown>;
    extraSections["unexpected-extra-section"] = cloneV4ReadModelResult().sections["centre-benchmark"];

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />,
    ));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    expect(pageSlot?.textContent).toContain("Reviewed 3 of 4 sections");
    expect(pageSlot?.textContent).not.toContain("Reviewed 4 of 4 sections");
  });

  it("caps historical saved v3 source coverage at four without rejecting the result", async () => {
    const result = sectionedResult();
    result.executive = {
      status: "available",
      artifactId: "executive-v3",
      result: {
        artifactKind: "executive-synthesis",
        status: "available",
        providerProfileId: result.binding.modelProfileId,
        runId: "run-executive-v3",
        binding: result.binding,
        sourceSectionArtifactIds: ["source-1", "source-2", "source-3", "source-4", "source-5"],
        keyFindings: [{
          id: "legacy-finding",
          takeaway: "Historical Saved Analysis remains readable.",
          sectionIds: ["centre-benchmark"],
          evidenceRefs: ["evidence:benchmark"],
        }],
      },
    };

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />,
    ));

    expect(container.textContent).toContain("Historical Saved Analysis remains readable.");
    expect(container.textContent).toContain("Based on 4 of 4 sections");
    expect(container.textContent).not.toContain("Based on 5 of 4 sections");
  });

  it("accepts an empty v4 Executive with zero source Section Artifact IDs", async () => {
    const result = cloneV4ReadModelResult();
    result.executive = {
      status: "empty",
      artifactId: "key-findings-v4",
      result: {
        artifactKind: "executive-synthesis",
        status: "empty",
        providerProfileId: result.binding.modelProfileId,
        runId: "run-key-findings-v4",
        binding: result.binding,
        sourceSectionArtifactIds: [],
        findings: [],
      },
    };

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" mode="saved" savedResult={result} startRun={vi.fn()} />,
    ));

    const pageSlot = container.querySelector<HTMLElement>('[data-ai-section="page-synthesis"]');
    expect(pageSlot?.textContent).toContain("Reviewed 4 of 4 sections");
    expect(pageSlot?.textContent).toContain("No additional Key Findings");
    expect(pageSlot?.textContent).not.toContain("Invalid saved AI");
  });

  it("rejects a legacy v3 read model from live Key Findings and Section content", async () => {
    const startRun = vi.fn((_input: unknown, onProgress?: (stage: PreschoolAiProgress) => void) => {
      onProgress?.("inspecting");
      return new Promise<PreschoolAiRunResult>(() => undefined);
    });
    const onCompletedResult = vi.fn();

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" startRun={startRun} />,
    ));
    expect(container.textContent).toContain("Key Findings");
    expect(container.textContent).not.toContain("AI Executive Summary");

    const legacyV3Result = sectionedResult();
    legacyV3Result.executive = {
      status: "available",
      artifactId: "executive-v3-live",
      result: {
        artifactKind: "executive-synthesis",
        status: "available",
        providerProfileId: legacyV3Result.binding.modelProfileId,
        runId: "run-executive-v3-live",
        binding: legacyV3Result.binding,
        sourceSectionArtifactIds: ["section-benchmark"],
        keyFindings: [{
          id: "legacy-live-finding",
          takeaway: "Legacy finding remains renderable without renaming the live slot.",
          sectionIds: ["centre-benchmark"],
          evidenceRefs: ["evidence:benchmark"],
        }],
      },
    };
    await act(async () => root.render(<>
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        liveResult={legacyV3Result}
        startRun={startRun}
        onCompletedResult={onCompletedResult}
      />
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="centre-benchmark"
        liveResult={legacyV3Result}
        startRun={startRun}
      />
    </>));
    expect(container.textContent).toContain("Key Findings");
    expect(container.textContent).not.toContain("AI Executive Summary");
    expect(container.querySelectorAll("[data-ai-section]")).toHaveLength(2);
    expect(container.textContent?.match(/Invalid AI result/g)).toHaveLength(2);
    expect(container.textContent).not.toContain("Legacy finding remains renderable");
    expect(container.textContent).not.toContain("Benchmark evidence supports a focused review");
    expect(onCompletedResult).not.toHaveBeenCalled();

    await act(async () => root.render(
      <PreschoolAiSlot snapshot={preschoolGoldenSnapshot()} sectionId="page-synthesis" liveResult={{ status: "unavailable", reason: "SECTION_FAILED" }} startRun={startRun} />,
    ));
    expect(container.textContent).toContain("Key Findings");
    expect(container.textContent).not.toContain("AI Executive Summary");
  });

  it("renders canonical separators in Executive Evidence and Saved Analysis provenance", async () => {
    const result = sectionedResult();
    result.executive = {
      status: "available",
      artifactId: "executive",
      result: {
        artifactKind: "executive-synthesis",
        status: "available",
        providerProfileId: result.binding.modelProfileId,
        runId: "run-executive",
        binding: result.binding,
        sourceSectionArtifactIds: ["section-benchmark"],
        keyFindings: [{
          id: "executive-finding",
          takeaway: "Benchmark evidence supports a focused review.",
          sectionIds: ["centre-benchmark"],
          evidenceRefs: ["evidence:benchmark"],
        }],
      },
    };
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    expect(container.textContent).toContain("centre-benchmark · evidence:benchmark");
    expect(container.textContent).toContain("AI Executive Summary");
    expect(container.textContent).toContain("Based on 1 of 4 sections");
    expect(container.textContent).toContain("Saved AI result · Run run-executive");
    expect(container.textContent).not.toContain("路");
  });

  it("renders only safe inline Markdown emphasis in AI narrative fields", async () => {
    const result = sectionedResult();
    const benchmark = result.sections["centre-benchmark"];
    if (benchmark.status !== "available" || !("keyPoints" in benchmark.result)) {
      throw new Error("legacy fixture missing");
    }
    benchmark.result.summary = "Review **Centre G** before assigning _a cause_.";
    benchmark.result.keyPoints[0]!.text = "Open [unsafe link](https://example.test) and ignore <strong>raw HTML</strong>.";
    result.executive = {
      status: "available",
      artifactId: "executive",
      result: {
        artifactKind: "executive-synthesis",
        status: "available",
        providerProfileId: result.binding.modelProfileId,
        runId: "run-executive-markdown",
        binding: result.binding,
        sourceSectionArtifactIds: ["section-benchmark"],
        keyFindings: [{
          id: "executive-finding",
          takeaway: "Start with **Centre G**, then _verify context_.",
          sectionIds: ["centre-benchmark"],
          evidenceRefs: ["evidence:benchmark"],
        }],
      },
    };

    await act(async () => root.render(<>
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="page-synthesis"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="centre-benchmark"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />
    </>));

    expect([...container.querySelectorAll("strong")].some((element) => element.textContent === "Centre G")).toBe(true);
    expect([...container.querySelectorAll("em")].some((element) => element.textContent === "verify context")).toBe(true);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("unsafe link");
    expect(container.textContent).toContain("raw HTML");
    expect([...container.querySelectorAll("strong")].some((element) => element.textContent === "raw HTML")).toBe(false);
  });

  it("renders the preserved autonomous result as Additional AI Insights after Section 5", async () => {
    const result = sectionedResult();
    result.autonomous = availableResult();

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    expect(container.textContent).toContain("Additional AI Insights");
    expect(container.textContent).toContain("Centre G deserves investigation");
    expect(container.querySelectorAll("article")).toHaveLength(2);
  });

  it("does not expose a legacy autonomous result from a current live read model when Additional is missing", async () => {
    const result = v4ReadModelResult();
    result.autonomous = availableResult();
    const startRun = vi.fn().mockResolvedValue(result);

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        liveResult={result}
        startRun={startRun}
      />,
    ));

    expect(startRun).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Additional AI Insights");
    expect(container.textContent).toContain("Additional insights unavailable");
    expect(container.textContent).not.toContain("Centre G deserves investigation");
  });

  it("renders the current saved Additional Artifact in publication order without starting work", async () => {
    const result = v4ReadModelResult();
    Object.assign(result, { additional: currentAdditionalUnit(result.binding) });
    const startRun = vi.fn();

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Additional AI Insights");
    expect(container.textContent).toContain("A counter-pattern appears");
    expect(container.querySelector('[data-additional-canvas="comparison"]')).not.toBeNull();
    expect(container.querySelector('[data-additional-canvas="metric"]')).not.toBeNull();
    expect(container.querySelector('[data-additional-canvas="trend"]')).not.toBeNull();
    expect(container.textContent).toContain("Inferred");
    expect(container.textContent).toContain("Attention · possible");
    expect(container.textContent).toContain("Evidence, Method and limitation");
    expect(container.textContent).toContain("energyiq-open-discovery@1.0.0");
    expect(container.querySelector("a")).toBeNull();
    expect([...container.querySelectorAll("strong")].some((node) => node.textContent === "Evidence signal:" )).toBe(true);
    expect([...container.querySelectorAll("strong")].some((node) => node.textContent === "AI angle:" )).toBe(true);
    expect([...container.querySelectorAll("strong")].some((node) => node.textContent === "standby share")).toBe(true);
    expect([...container.querySelectorAll("strong")].some((node) => node.textContent?.includes("raw HTML"))).toBe(false);
    expect(container.textContent).not.toContain("Legacy autonomous angle");
  });

  it("loads and changes only the signed-in actor's feedback for the exact current Finding", async () => {
    const result = v4ReadModelResult();
    Object.assign(result, { additional: currentAdditionalUnit(result.binding) });
    let resolveFeedback!: (value: unknown) => void;
    const loadFeedback = vi.fn(() => new Promise((resolve) => { resolveFeedback = resolve; }));
    const saveFeedback = vi.fn(async () => ({
      rating: "not-useful" as const,
      revision: 2,
      updatedAt: "2026-08-14T04:00:00.000Z",
    }));
    const startRun = vi.fn().mockResolvedValue(result);

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        liveResult={result}
        startRun={startRun}
        additionalFeedbackClient={{ loadFeedback, saveFeedback }}
      />,
    ));

    expect(container.textContent).toContain("Loading your feedback");
    expect(loadFeedback).toHaveBeenCalledWith({
      projectId: "preschool-demo",
      artifactId: "additional-current-v2",
      findingId: "additional:candidate-counter-pattern",
    });

    await act(async () => resolveFeedback({
      rating: "useful",
      revision: 1,
      updatedAt: "2026-08-14T03:00:00.000Z",
    }));
    const useful = [...container.querySelectorAll("button")].find((button) => button.textContent === "Useful");
    const notUseful = [...container.querySelectorAll("button")].find((button) => button.textContent === "Not useful");
    expect(useful?.getAttribute("aria-pressed")).toBe("true");
    expect(notUseful).toBeDefined();

    await act(async () => notUseful!.click());
    expect(saveFeedback).toHaveBeenCalledWith({
      projectId: "preschool-demo",
      artifactId: "additional-current-v2",
      findingId: "additional:candidate-counter-pattern",
      rating: "not-useful",
      expectedRevision: 1,
    });
    expect(container.textContent).toContain("Feedback saved");
    expect(notUseful?.getAttribute("aria-pressed")).toBe("true");
    expect(startRun).toHaveBeenCalledOnce();
  });

  it("lets a user turn a useful Finding into an editable provisional Method proposal", async () => {
    const result = v4ReadModelResult();
    Object.assign(result, { additional: currentAdditionalUnit(result.binding) });
    const createProposal = vi.fn().mockResolvedValue({
      id: "proposal-counter-pattern",
      status: "provisional" as const,
    });

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        liveResult={result}
        startRun={vi.fn().mockResolvedValue(result)}
        additionalFeedbackClient={{
          loadFeedback: vi.fn().mockResolvedValue({
            rating: "useful" as const,
            revision: 1,
            updatedAt: "2026-08-14T03:00:00.000Z",
          }),
          saveFeedback: vi.fn(),
        }}
        additionalMethodProposalClient={{ createProposal }}
      />,
    ));
    await act(async () => undefined);

    const propose = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Propose reusable method");
    expect(propose).toBeDefined();
    await act(async () => propose!.click());

    const title = container.querySelector<HTMLInputElement>('input[aria-label="Method name"]')!;
    const guidance = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reusable method guidance"]')!;
    expect(title.value).toBe("A counter-pattern appears");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        guidance,
        "Re-run the absolute-versus-normalised ranking comparison on each new Snapshot and publish only material divergence.",
      );
      guidance.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveProposal = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Save method proposal");
    await act(async () => saveProposal!.click());

    expect(createProposal).toHaveBeenCalledWith({
      projectId: "preschool-demo",
      artifactId: "additional-current-v2",
      findingId: "additional:candidate-counter-pattern",
      idempotencyKey: "finding-method:additional-current-v2:additional:candidate-counter-pattern",
      title: "A counter-pattern appears",
      guidance: "Re-run the absolute-versus-normalised ranking comparison on each new Snapshot and publish only material divergence.",
    });
    expect(container.textContent).toContain("Method proposal saved for review");
  });

  it("keeps the Finding visible and exposes a local feedback error", async () => {
    const result = v4ReadModelResult();
    Object.assign(result, { additional: currentAdditionalUnit(result.binding) });
    const client = {
      loadFeedback: vi.fn().mockResolvedValue(null),
      saveFeedback: vi.fn().mockRejectedValue(new Error("network unavailable")),
    };

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        liveResult={result}
        startRun={vi.fn().mockResolvedValue(result)}
        additionalFeedbackClient={client}
      />,
    ));
    await act(async () => undefined);
    const useful = [...container.querySelectorAll("button")].find((button) => button.textContent === "Useful");
    await act(async () => useful!.click());

    expect(container.textContent).toContain("A counter-pattern appears");
    expect(container.textContent).toContain("Feedback could not be saved");
  });

  it("isolates malformed Additional findings and Canvas while preserving valid siblings", async () => {
    const result = v4ReadModelResult();
    const additional = currentAdditionalUnit(result.binding);
    const artifact = additional.result;
    const malformedCanvas = structuredClone(artifact.findings[0]!);
    malformedCanvas.id = "additional:malformed-canvas";
    malformedCanvas.title = "Narrative survives malformed Canvas";
    malformedCanvas.canvas.acceptedBlockIds = ["canvas-block:forged"];
    const validSibling = structuredClone(artifact.findings[0]!);
    validSibling.id = "additional:valid-sibling";
    validSibling.title = "Valid sibling remains visible";
    artifact.findings = [malformedCanvas, { id: "malformed-insight" }, validSibling] as typeof artifact.findings;
    Object.assign(artifact.publication, { publishedCount: 3 });
    Object.assign(result, { additional });
    const startRun = vi.fn();

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Narrative survives malformed Canvas");
    expect(container.textContent).toContain("Visual unavailable");
    expect(container.textContent).toContain("Insight unavailable");
    expect(container.textContent).toContain("Valid sibling remains visible");
  });

  it("counts a contract-approved Canvas budget rejection and rejects an unknown rejection code locally", async () => {
    const result = v4ReadModelResult();
    const additional = currentAdditionalUnit(result.binding);
    const budgeted = structuredClone(additional.result.findings[0]!);
    budgeted.id = "additional:budgeted";
    budgeted.title = "Budgeted Canvas remains visible";
    budgeted.canvas.rejections = [{
      code: "PRESENTATION_BUDGET_EXCEEDED",
      subjectId: "canvas-block:suppressed-4",
    }];
    const unknown = structuredClone(additional.result.findings[0]!);
    unknown.id = "additional:unknown-rejection";
    unknown.title = "Unknown rejection keeps narrative only";
    unknown.canvas.rejections = [{
      code: "UNKNOWN_REJECTION",
      subjectId: "canvas-block:unknown",
    }];
    additional.result.findings = [budgeted, unknown] as typeof additional.result.findings;
    Object.assign(additional.result.publication, { publishedCount: 2 });
    Object.assign(result, { additional });

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    expect(container.textContent).toContain("1 unsafe or unsupported Canvas declaration was omitted.");
    const unknownCard = container.querySelector('[data-additional-insight="additional:unknown-rejection"]');
    expect(unknownCard?.textContent).toContain("Unknown rejection keeps narrative only");
    expect(unknownCard?.textContent).toContain("Visual unavailable");
    expect(unknownCard?.querySelector("[data-additional-canvas]")).toBeNull();
  });

  it("keeps an Insight narrative but rejects an unregistered Canvas visualization locally", async () => {
    const result = v4ReadModelResult();
    const additional = currentAdditionalUnit(result.binding);
    const finding = additional.result.findings[0]!;
    finding.title = "Narrative survives an unregistered renderer";
    finding.canvas.acceptedBlocks[0]!.visualization = "custom-chart" as "comparison";
    Object.assign(result, { additional });

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        mode="saved"
        savedResult={result}
        startRun={vi.fn()}
      />,
    ));

    expect(container.textContent).toContain("Narrative survives an unregistered renderer");
    expect(container.textContent).toContain("Visual unavailable");
    expect(container.querySelector("[data-additional-canvas]")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it.each([
    ["empty", "No material additional insight"],
    ["unavailable", "Additional insights unavailable"],
    ["queued", "Additional insights pending"],
    ["running", "Additional insights pending"],
  ] as const)("renders current Additional %s locally without starting work", async (status, expected) => {
    const result = v4ReadModelResult();
    const base = currentAdditionalUnit(result.binding);
    const additional = status === "empty"
      ? {
          ...base,
          status,
          result: {
            ...base.result,
            status,
            findings: [],
            publication: {
              ...base.result.publication,
              discoveredCount: 3,
              acceptedCount: 0,
              rejectedCount: 3,
              publishedCount: 0,
              sourceOrderCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
              acceptedCandidateIds: [],
              rejectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
              publishedCandidateIds: [],
            },
          },
        }
      : status === "unavailable"
        ? { status, artifactId: base.artifactId, reason: "ADDITIONAL_FAILED" }
        : { status };
    Object.assign(result, { additional });
    const startRun = vi.fn();

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain(expected);
    if (status === "empty") {
      expect(container.textContent).toContain("3 candidate angles were reviewed");
      expect(container.textContent).toContain("None met both the Evidence and novelty bar");
    }
  });

  it("preserves pointer-only Additional v1 narrative only for frozen Saved Analysis", async () => {
    const result = v4ReadModelResult();
    const additional = currentAdditionalUnit(result.binding);
    additional.result.contract.revision = "energyiq-additional-ai-insights-v1";
    additional.result.publication.policyRevision = "additional-insights-v1";
    additional.result.findings[0]!.canvas = {
      contractRevision: "energyiq-insight-canvas-v1",
      planId: "canvas-plan:historical",
      acceptedBlockIds: ["canvas-block:not-persisted"],
    } as typeof additional.result.findings[0]["canvas"];
    additional.result.evidenceLineage.facts = additional.result.evidenceLineage.facts.map(({ id, status, evidenceRefs }) => ({
      id,
      status,
      evidenceRefs,
    })) as typeof additional.result.evidenceLineage.facts;
    Object.assign(result, { additional });
    const startRun = vi.fn();

    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={preschoolGoldenSnapshot()}
        sectionId="overall-summary"
        mode="saved"
        savedResult={result}
        startRun={startRun}
      />,
    ));

    expect(startRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain("A counter-pattern appears");
    expect(container.textContent).toContain("Visual unavailable");
    expect(container.querySelector("[data-additional-canvas]")).toBeNull();
  });

  async function renderSlot(
    startRun: Parameters<typeof PreschoolAiSlot>[0]["startRun"],
    sectionId: Parameters<typeof PreschoolAiSlot>[0]["sectionId"] = "page-synthesis",
  ) {
    const snapshot = preschoolGoldenSnapshot();
    await act(async () => root.render(
      <PreschoolAiSlot
        snapshot={snapshot}
        sectionId={sectionId}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo&scopeId=project&resource=electricity&period=Custom&from=2026-05-01&to=2026-05-31&dataCutoff=2026-05-31&dataSnapshotId=preschool-26b85b9c0b95e090"
        startRun={startRun}
      />,
    ));
  }
});

function expectDecisionSummaryBeforeVisual(container: HTMLElement): void {
  const takeaway = container.querySelector("[data-ai-primary-takeaway='true']");
  const action = container.querySelector("[data-ai-primary-action='true']");
  const presentation = container.querySelector("[data-ai-presentation='true']");
  expect(takeaway).not.toBeNull();
  expect(action).not.toBeNull();
  expect(presentation).not.toBeNull();
  expect(takeaway!.compareDocumentPosition(action!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(action!.compareDocumentPosition(presentation!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

function readableText(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replaceAll("\u00a0", " ");
}

function findInsightCard(scope: HTMLElement, title: string): HTMLElement {
  const heading = [...scope.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")]
    .find((candidate) => candidate.textContent?.trim() === title);
  expect(heading).toBeDefined();
  const card = heading!.closest<HTMLElement>("article");
  expect(card).not.toBeNull();
  return card!;
}

function findSafeMarkdownByText(scope: HTMLElement, text: string): HTMLElement {
  const markdown = [...scope.querySelectorAll<HTMLElement>('[data-safe-ai-markdown="true"]')]
    .find((candidate) => readableText(candidate).includes(text));
  expect(markdown).toBeDefined();
  return markdown!;
}

function findDisclosure(scope: HTMLElement, label: RegExp): HTMLDetailsElement {
  const disclosure = [...scope.querySelectorAll<HTMLDetailsElement>("details")]
    .find((candidate) => label.test(candidate.querySelector("summary")?.textContent ?? ""));
  expect(disclosure).toBeDefined();
  return disclosure!;
}

function expectSafeV4Markdown(
  markdown: HTMLElement,
  expected: { strong: string; emphasis: string },
): void {
  const paragraph = markdown.querySelector("p");
  expect(paragraph).not.toBeNull();
  expect(markdown.querySelector("br")).not.toBeNull();
  expect([...markdown.querySelectorAll("strong")].some((element) => element.textContent === expected.strong)).toBe(true);
  expect([...markdown.querySelectorAll("em")].some((element) => element.textContent === expected.emphasis)).toBe(true);
  expect(markdown.querySelector("a")).toBeNull();
  expect(markdown.querySelector("ul, ol")).toBeNull();
  expect([...markdown.querySelectorAll("strong, em")].every((element) => element.textContent !== paragraph!.textContent)).toBe(true);
  expect([...markdown.querySelectorAll("strong, em")].some((element) => element.textContent?.includes("raw HTML"))).toBe(false);
}

type LegacyAvailableResult = Extract<PreschoolAiLegacyRunResult, { status: "available" }>;

function availableResult(): LegacyAvailableResult {
  return {
    status: "available",
    providerProfileId: "profile-1",
    runId: "run-1",
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    findings: [
      finding("preschool-ai-finding-1", "supports", true),
      finding("preschool-ai-finding-2", "independent", false),
    ],
  };
}

function acceptedResult(): PreschoolAiAcceptedArtifact {
  const binding = {
    projectId: "preschool-demo" as const,
    scopeId: "preschool-project",
    dataSnapshotId: "preschool-26b85b9c0b95e090",
    projectReleaseId: "legacy-profile:preschool-demo:2",
    dataCutoff: "2026-05-31T16:00:00.000Z",
    analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-31T16:00:00.000Z" },
    outputContractRevision: "v13" as const,
  };
  return {
    status: "available",
    providerProfileId: "profile-1",
    runId: "accepted-editor-run",
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    contract: { id: "preschool-ai-accepted-artifact", revision: "v13" },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: "preschool-two-stage-v2",
      methodSkill: { id: "energy-insight-investigation", revision: "1.0.0" },
      stages: {
        investigator: { runId: "accepted-investigator-run", promptRevision: "preschool-investigator-v15" },
        editor: { runId: "accepted-editor-run", promptRevision: "preschool-insight-editor-v7" },
      },
    },
    findings: [{
      id: "accepted-finding-1",
      binding,
      placementTargets: ["preschool.overall-key-findings"],
      epistemicLevel: "hypothesis",
      relationship: "independent",
      signalRefs: [],
      title: "Closed-hour load needs an operating check",
      takeaway: "The cited Snapshot shows a repeatable closed-hour pattern.",
      interpretation: "This matters because the load occurs outside the published Calendar.",
      possibleExplanation: "Equipment schedules may differ from the published Calendar.",
      action: "Check equipment schedules with the Centre operator.",
      expectedIfAct: "The review should isolate the avoidable condition.",
      ifIgnored: "The unexplained closed-hour load may continue.",
      verification: "Compare the same hours after the schedule check.",
      uncertainty: "The pinned Evidence does not prove equipment state.",
      evidence: {
        snapshotId: binding.dataSnapshotId,
        period: binding.analysisPeriod,
        deterministic: [{
          id: "operating:closed-hour-pattern",
          kind: "operating",
          label: "Closed-hour pattern",
          unit: "kWh",
          values: { status: "observed" },
          queryIds: ["operating-query"],
          limitation: "Does not establish equipment state.",
        }],
        tools: [],
      },
    }],
  };
}

function sectionedResult(): PreschoolOverviewAiReadModelDto {
  const snapshot = preschoolGoldenSnapshot();
  const binding = {
    workspaceId: snapshot.context.workspaceId,
    projectId: "preschool-demo" as const,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisPeriod: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 1,
  };
  const available = {
    status: "available" as const,
    artifactId: "section-benchmark",
    result: {
      artifactKind: "section-interpretation" as const,
      status: "available" as const,
      providerProfileId: binding.modelProfileId,
      runId: "run-benchmark",
      binding,
      sectionId: "centre-benchmark" as const,
      summary: "Benchmark evidence supports a focused review.",
      keyPoints: [
        { kind: "finding" as const, text: "One pattern deserves attention.", evidenceRefs: ["evidence:benchmark"] },
        { kind: "next-check" as const, text: "Confirm context first.", evidenceRefs: ["evidence:benchmark"] },
      ],
    },
  };
  return {
    artifactKind: "preschool-overview-ai-read-model",
    status: "available",
    binding,
    sections: {
      "centre-benchmark": available,
      "standby-wastage": { status: "unavailable", artifactId: "section-standby", reason: "SECTION_FAILED" },
      "operating-behaviour": { status: "empty", artifactId: "section-operating", result: {
        artifactKind: "section-interpretation",
        status: "empty",
        providerProfileId: binding.modelProfileId,
        binding,
        sectionId: "operating-behaviour",
        runId: "run-operating",
        keyPoints: [],
      } },
      "planning-outlook": { status: "unavailable", reason: "Section interpretation has not been generated." },
    },
    executive: { status: "unavailable", artifactId: "executive", reason: "SYNTHESIS_FAILED" },
  };
}

function v4ReadModelResult(): PreschoolOverviewAiReadModelDto {
  const snapshot = preschoolGoldenSnapshot();
  const binding = {
    workspaceId: snapshot.context.workspaceId,
    projectId: "preschool-demo" as const,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisPeriod: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    modelProfileId: "workspace-default-model-profile",
    modelProfileRevision: 1,
  };

  return {
    artifactKind: "preschool-overview-ai-read-model",
    status: "available",
    binding,
    sections: {
      "centre-benchmark": {
        status: "empty",
        artifactId: "section-benchmark-v4",
        result: {
          artifactKind: "section-interpretation",
          status: "empty",
          providerProfileId: binding.modelProfileId,
          runId: "run-benchmark-v4",
          binding,
          sectionId: "centre-benchmark",
          insights: [],
        },
      },
      "standby-wastage": {
        status: "available",
        artifactId: "section-standby-v4",
        result: {
          artifactKind: "section-interpretation",
          status: "available",
          providerProfileId: binding.modelProfileId,
          runId: "run-standby-v4",
          binding,
          sectionId: "standby-wastage",
          summary: {
            text: "Closed-hour **energy** recurs in the cited portfolio evidence.  \n_Review the pattern_ before assigning a cause; ignore [external link](https://example.test) and <strong>raw summary HTML</strong>.",
            evidenceRefs: ["standby:portfolio"],
          },
          insights: [
            {
              id: "standby-persistent-load",
              title: "Persistent closed-hour base load",
              epistemicStatus: "observed",
              text: "Recurring closed-hour load appears in the cited **peer-baseline Evidence**.  \n_Observed in the pinned Snapshot_; ignore [external link](https://example.test) and <strong>raw insight HTML</strong>.",
              evidenceRefs: ["standby:recurrence", "standby:peer-baseline"],
            },
            {
              id: "standby-schedule-mismatch",
              title: "Schedule mismatch may contribute",
              epistemicStatus: "speculative",
              text: "Published **closing times** and recurring load boundaries may differ.  \n_Verify the operating state_ before assigning a cause; ignore [external link](https://example.test) and <em>raw HTML</em>.",
              evidenceRefs: ["standby:closing-boundary"],
              deepDiveQuestion: "Which Centres show recurring closed-hour load near the published closing boundary?",
            },
          ],
          limitation: "The Snapshot does not establish equipment state or a confirmed cause.",
        },
      },
      "operating-behaviour": {
        status: "available",
        artifactId: "section-operating-v4",
        result: {
          artifactKind: "section-interpretation",
          status: "available",
          providerProfileId: binding.modelProfileId,
          runId: "run-operating-v4",
          binding,
          sectionId: "operating-behaviour",
          summary: {
            text: "Unusual **opening-hour peaks** recur in the cited operating evidence.  \n_Review recurrence_ before assigning a cause; ignore [external link](https://example.test) and <strong>raw operating HTML</strong>.",
            evidenceRefs: ["operating:spikes"],
          },
          insights: [],
        },
      },
      "planning-outlook": {
        status: "unavailable",
        artifactId: "section-planning-v4",
        reason: "SECTION_FAILED",
      },
    },
    executive: {
      status: "available",
      artifactId: "key-findings-v4",
      result: {
        artifactKind: "executive-synthesis",
        status: "available",
        providerProfileId: binding.modelProfileId,
        runId: "run-key-findings-v4",
        binding,
        sourceSectionArtifactIds: ["section-standby-v4", "section-operating-v4"],
        summary: {
          text: "Recurring **time-pattern signals** appear in both closed and opening hours.  \n_Review them together_ without assuming a shared cause; ignore [external link](https://example.test) and <strong>raw Key Findings HTML</strong>.",
          evidenceRefs: ["standby:portfolio", "operating:spikes"],
        },
        findings: [{
          id: "key-finding-closed-hours",
          title: "Two time-pattern signals merit review",
          text: "Closed-hour **energy** and unusual opening-hour _peaks_ are separately evidenced.  \nBoth merit review; ignore [external link](https://example.test) and <em>raw finding HTML</em>.",
          sectionIds: ["standby-wastage", "operating-behaviour"],
          evidenceRefs: ["standby:portfolio", "operating:spikes"],
          alert: { severity: "attention", certainty: "anomaly" },
        }],
      },
    },
  };
}

function cloneV4ReadModelResult(): PreschoolOverviewAiReadModelDto {
  return JSON.parse(JSON.stringify(v4ReadModelResult())) as PreschoolOverviewAiReadModelDto;
}

function currentAdditionalUnit(binding: PreschoolOverviewAiReadModelDto["binding"]) {
  const method = {
    skillId: "energyiq-open-discovery",
    semanticVersion: "1.0.0",
    resourceId: "builtin:energyiq-open-discovery",
    resourceRevision: 1,
    contentSha256: "5af7fdc13e241bf92a4b14268aa1382996c2af31d920d9dc8644bb2efec87d59",
    scope: "builtin",
    workspaceId: binding.workspaceId,
    userId: "energyiq-system",
    role: "core-method",
  };
  return {
    status: "available",
    artifactId: "additional-current-v2",
    result: {
      artifactKind: "autonomous-insights",
      status: "available",
      providerProfileId: binding.modelProfileId,
      runId: "run-additional-v2",
      contract: { id: "energyiq-additional-ai-insights", revision: "energyiq-additional-ai-insights-v2" },
      binding,
      methodExecution: {
        methodSetId: "preschool-additional-insights-current",
        methodSetRevision: "v1",
        methodSetFingerprint: `sha256:${"c".repeat(64)}`,
        loadedMethods: [method],
      },
      capability: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        allowedTools: [],
        usedTools: [],
      },
      toolAudits: [],
      evidenceLineage: {
        catalogContract: "analysis-context-evidence@1",
        sourceId: `project-analysis-snapshot:${binding.projectId}:${binding.dataSnapshotId}`,
        pins: {
          workspaceId: binding.workspaceId,
          projectId: binding.projectId,
          scopeId: binding.scopeId,
          dataSnapshotId: binding.dataSnapshotId,
          dataCutoff: "2026-05-31T16:00:00.000Z",
          projectReleaseId: binding.projectReleaseId,
          metricVersion: "energy-metrics-v1",
        },
        facts: [{
          id: "fact:standby-share",
          label: "Standby share",
          metricId: "energy.standby-share",
          value: 31,
          unit: "%",
          status: "confirmed",
          evidenceRefs: ["snapshot-evidence:standby-share"],
          dimensions: { scopeId: binding.scopeId },
        }],
      },
      findings: [{
        id: "additional:candidate-counter-pattern",
        title: "A counter-pattern appears",
        text: "**Evidence signal:** The cited **standby share** differs from the expected pattern.  \n\n**AI angle:** _Review the current Snapshot_ without assuming a cause; ignore [unsafe link](https://example.test) and <strong>raw HTML</strong>.",
        epistemicStatus: "inferred",
        origin: { kind: "ai-discovery", coreMethod: method, directionMethods: [] },
        evidenceRefs: ["fact:standby-share"],
        toolAuditIds: [],
        alert: {
          severity: "attention",
          certainty: "possible",
          evidenceRefs: ["fact:standby-share"],
        },
        canvas: {
          contractRevision: "energyiq-insight-canvas-v2",
          planId: "canvas-plan:additional:candidate-counter-pattern",
          acceptedBlockIds: ["canvas-block:standby-share", "canvas-block:standby-metric", "canvas-block:standby-trend"],
          acceptedBlocks: [{
            id: "canvas-block:standby-share",
            kind: "quantitative",
            visualization: "comparison",
            title: "Standby share",
            bindings: [{
              evidenceRef: "fact:standby-share",
              entityId: binding.scopeId,
              metricId: "energy.standby-share",
              value: 31,
              unit: "%",
            }],
          }, {
            id: "canvas-block:standby-metric",
            kind: "quantitative",
            visualization: "metric",
            title: "Standby share metric",
            bindings: [{
              evidenceRef: "fact:standby-share",
              entityId: binding.scopeId,
              metricId: "energy.standby-share",
              value: 31,
              unit: "%",
            }],
          }, {
            id: "canvas-block:standby-trend",
            kind: "quantitative",
            visualization: "trend",
            title: "Standby share trend",
            bindings: [{
              evidenceRef: "fact:standby-share",
              entityId: binding.scopeId,
              metricId: "energy.standby-share",
              value: 31,
              unit: "%",
            }],
          }],
          rejections: [],
          gaps: [],
        },
      }],
      publication: {
        policyId: "energyiq-additional-ai-insights",
        policyRevision: "additional-insights-v2",
        discoveredCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
        publishedCount: 1,
        sourceOrderCandidateIds: ["candidate-counter-pattern"],
        acceptedCandidateIds: ["candidate-counter-pattern"],
        rejectedCandidateIds: [],
        publishedCandidateIds: ["candidate-counter-pattern"],
        suppressedCandidateIds: [],
      },
    },
  };
}

function overviewEvidenceLineage(
  binding: PreschoolOverviewAiReadModelDto["binding"],
  factIds: string[],
) {
  return {
    contract: "analysis-context-evidence@1" as const,
    sourceId: `project-analysis-snapshot:${binding.projectId}:${binding.dataSnapshotId}`,
    pins: {
      workspaceId: binding.workspaceId,
      projectId: binding.projectId,
      scopeId: binding.scopeId,
      dataSnapshotId: binding.dataSnapshotId,
      dataCutoff: "2026-05-31T16:00:00.000Z",
      projectReleaseId: binding.projectReleaseId,
      metricVersion: "energy-v1",
    },
    factIds: [...factIds],
    facts: factIds.map((id) => ({
      id,
      label: id,
      metricId: "energy.test",
      value: 1,
      unit: "kWh",
      status: "confirmed" as const,
      evidenceRefs: [`query:${id}`],
      dimensions: {},
    })),
  };
}

function finding(
  id: string,
  relationship: "supports" | "independent",
  withSql: boolean,
  sectionId: LegacyAvailableResult["findings"][number]["sectionId"] = "page-synthesis",
  signalRefs: string[] = [],
): LegacyAvailableResult["findings"][number] {
  return {
    id,
    sectionId,
    signalRefs,
    relationship,
    title: id === "preschool-ai-finding-1" ? "Centre G deserves investigation" : "Standby is a separate angle",
    what: "A scoped pattern is visible.",
    why: { kind: withSql ? "Evidence" : "Hypothesis", text: "The cited Evidence supports an investigation." },
    how: "Inspect the operating context and leading Circuit.",
    expectedIfAct: "The review should isolate the operating condition behind the pattern.",
    ifIgnored: "The unresolved pattern may continue without an accountable investigation.",
    howToVerify: "Repeat the same scoped comparison after investigation.",
    evidenceNote: "This is not a confirmed root cause.",
    ...(withSql ? {
      presentation: {
        version: "1" as const,
        blocks: [{
          type: "metric" as const,
          label: "Centre G EUI",
          value: 12.6,
        }],
      },
    } : {}),
    evidence: {
      snapshotId: "preschool-26b85b9c0b95e090",
      period: { from: "2026-05-01", to: "2026-05-31" },
      deterministic: [{
        id: withSql ? "benchmark:priority-centre:G" : "operating:portfolio",
        kind: withSql ? "centre" : "operating",
        label: withSql ? "Priority Centre G" : "Published Calendar split",
        unit: withSql ? null : "kWh",
        values: withSql ? { centreCode: "G", eui: 12.6 } : { standbySharePct: 12.45 },
        queryIds: ["scope_summary_v1"],
        limitation: "Not a confirmed cause.",
      }],
      tools: withSql ? [{
        evidenceIndex: 1,
        toolCallId: "sql-1",
        sql: "SELECT parent_node_id, SUM(usage_kwh) FROM energy_intervals GROUP BY parent_node_id",
        rowCount: 1,
        auditLogId: "audit-sql-1",
        elapsedMs: 12,
        resultPreview: "{\"rows\":[[\"preschool-centre-7\",843.0985]]}",
      }] : [],
    },
  };
}
