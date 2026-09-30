import { EventType, verifyEvents, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { createCustomEvent } from "@datafoundry/agent-runtime";
import { createMetadataStore, RunEventWriter } from "@datafoundry/metadata";
import { loadMaterializedSkillInstructions, materializeSkillPackages } from "@datafoundry/skills";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Observable, type Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverSeams = vi.hoisted(() => ({
  assemblyEvidenceContextItems: [] as unknown[][],
  assemblyOptions: [] as Array<Record<string, unknown>>,
  assemblyRunConfigs: [] as Array<Record<string, unknown>>,
  ensureWorkspace: vi.fn(),
  inspectSchema: vi.fn(),
  materializeAnalysisContextPackage: vi.fn(),
  order: [] as string[],
  readAnalysisContextPackage: vi.fn(),
  readCurrentOverviewProjection: vi.fn(),
  resolveMeterRoute: vi.fn(),
  resolveProjectAnalysis: vi.fn(),
  resolvePublishedContext: vi.fn(),
}));

vi.mock("./energy/energy-analysis-workspace.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./energy/energy-analysis-workspace.js")>(),
  ensureEnergyIqAnalysisWorkspace: serverSeams.ensureWorkspace,
}));

vi.mock("./energy/energy-query-context.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./energy/energy-query-context.js")>(),
  resolveEnergyPublishedMeterRoute: serverSeams.resolveMeterRoute,
}));

vi.mock("./energy/project-analysis-resolver.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./energy/project-analysis-resolver.js")>(),
  materializeProjectAnalysisContextPackage: serverSeams.materializeAnalysisContextPackage,
  readProjectAnalysisContextPackage: serverSeams.readAnalysisContextPackage,
  readCurrentProjectOverviewProjection: serverSeams.readCurrentOverviewProjection,
  resolveProjectAnalysis: serverSeams.resolveProjectAnalysis,
  resolvePublishedEnergyQueryContext: serverSeams.resolvePublishedContext,
}));

import {
  DataFoundryAgUiAgent,
  energyRunMatchesPersistedSessionContext,
  retainRunOwnershipUntilFinalized,
} from "./server.js";
import { RunCancelRegistry } from "./run-cancel-registry.js";
import { sessionEnergyContextFromSnapshot } from "./energy/session-energy-context.js";

const USER_ID = "preparation-test-user";
const WORKSPACE_ID = "preparation-test-workspace";
const PROJECT_ID = "preparation-test-project";
const DATASOURCE_ID = "preparation-test-datasource";
const DATA_ANALYSIS_SKILL_CONTENT = readFileSync(join(
  process.cwd(),
  "packages",
  "skills",
  "builtin",
  "data-analysis",
  "SKILL.md",
));

describe("DataFoundryAgUiAgent Energy preparation orchestration", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "energy-run-preparation-server-"));
    serverSeams.assemblyEvidenceContextItems.length = 0;
    serverSeams.assemblyOptions.length = 0;
    serverSeams.assemblyRunConfigs.length = 0;
    serverSeams.order.length = 0;
    serverSeams.ensureWorkspace.mockReset();
    serverSeams.inspectSchema.mockReset();
    serverSeams.materializeAnalysisContextPackage.mockReset();
    serverSeams.readAnalysisContextPackage.mockReset();
    serverSeams.readCurrentOverviewProjection.mockReset();
    serverSeams.resolveMeterRoute.mockReset();
    serverSeams.resolveProjectAnalysis.mockReset();
    serverSeams.resolvePublishedContext.mockReset();
    serverSeams.resolvePublishedContext.mockImplementation(() => {
      serverSeams.order.push("query-context");
      return { context: exactEnergyContext(), projectRelease: null };
    });
    serverSeams.resolveMeterRoute.mockImplementation(() => {
      serverSeams.order.push("meter-route");
      return {
        source: "published",
        meterMappingRevisionId: "mapping-1",
        attachments: [{ meterPointId: "meter-1", scopeId: "project", officialAggregation: true }],
        componentMeterPointIds: [],
      };
    });
    serverSeams.ensureWorkspace.mockImplementation(async () => {
      serverSeams.order.push("workspace");
      return energyWorkspace();
    });
    serverSeams.inspectSchema.mockImplementation(async (request) => ({
      datasource_id: request.datasource_id,
      dialect: "duckdb",
      tables: [],
    }));
    serverSeams.readAnalysisContextPackage.mockImplementation(async () => {
      serverSeams.order.push("analysis-context-package:missing");
      return undefined;
    });
    serverSeams.readCurrentOverviewProjection.mockRejectedValue(
      new Error("ENERGYIQ_OVERVIEW_PROJECTION_NOT_MATERIALIZED"),
    );
    serverSeams.materializeAnalysisContextPackage.mockImplementation(async (input) => {
      serverSeams.order.push("analysis-context-package:materialized");
      return {
        changed: true,
        resolution: input.resolution,
        contextPackage: analysisContextPackage().contextPackage,
      };
    });
    serverSeams.resolveProjectAnalysis.mockImplementation(async () => {
      serverSeams.order.push("project-analysis");
      return { status: "unavailable", reason: "TEST_PROJECTION_NOT_REQUIRED" };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("opens an Energy run with RUN_STARTED before preparation progress reaches the AG-UI client", async () => {
    const metadata = createTestMetadata(root);
    try {
      serverSeams.resolvePublishedContext.mockImplementation(() => ({
        context: exactEnergyContext(),
        projectRelease: projectRelease(),
      }));
      metadata.sessions.createWithEnergyContext({
        user_id: USER_ID,
        id: "ag-ui-first-event-session",
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "AG-UI first-event replay",
        title_source: "user",
        energy_context: historicalEnergyContext(),
      });

      const agent = createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      });
      const input = energyRunInput("ag-ui-first-event-run", "ag-ui-first-event-session");
      const events = await collectVerifiedEvents(agent, input);

      expect(events[0]).toMatchObject({
        runId: input.runId,
        threadId: input.threadId,
        type: EventType.RUN_STARTED,
      });
      expect(events.some(isPreparationEvent)).toBe(true);

      const persistedBeforeReplay = new RunEventWriter(metadata.runEvents).replay({
        user_id: USER_ID,
        run_id: input.runId,
      });
      serverSeams.order.length = 0;
      const replayed = await collectVerifiedEvents(agent, input);
      expect(replayed[0]).toMatchObject({
        runId: input.runId,
        threadId: input.threadId,
        type: EventType.RUN_STARTED,
      });
      expect(replayed.filter((event) => event.type === EventType.RUN_STARTED)).toHaveLength(1);
      const replayedMilestoneEventIds = replayed
        .map((event) => customEventId(event))
        .filter((eventId): eventId is string => eventId !== undefined);
      expect(new Set(replayedMilestoneEventIds).size).toBe(replayedMilestoneEventIds.length);
      expect(serverSeams.order).not.toContain("stream:RUN_STARTED");
      expect(replayed.at(-1)).toMatchObject({
        message: "TEST_LOCAL_TERMINAL",
        runId: input.runId,
        runTerminalKind: "durable",
        type: EventType.RUN_ERROR,
      });
      expect(new RunEventWriter(metadata.runEvents).replay({
        user_id: USER_ID,
        run_id: input.runId,
      })).toEqual(persistedBeforeReplay);
    } finally {
      metadata.close();
    }
  });

  it("persists the real selected builtin Skill reader output exactly once through the server RUN_STARTED seam", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "actual-loaded-skill-session");
      metadata.configResources.upsert({
        id: "data-analysis",
        workspace_id: WORKSPACE_ID,
        user_id: USER_ID,
        kind: "skill",
        name: "data-analysis",
        description: "Governed data analysis",
        payload: {
          allowedTools: [],
          packageEntry: "SKILL.md",
          packageFileRefId: "data-analysis-package-ref",
          packageFiles: ["SKILL.md"],
          packageFormat: "skill-md",
          userInvocable: true,
          version: "1.0.0",
        },
        builtin: true,
        default_enabled: false,
        status: "valid",
      });
      const input = energyRunInput("actual-loaded-skill-run", "actual-loaded-skill-session");
      const runConfig = input.forwardedProps?.run_config as Record<string, unknown>;
      input.forwardedProps = {
        ...input.forwardedProps,
        run_config: {
          ...runConfig,
          activeSkillId: "data-analysis",
          enabledSkillIds: ["data-analysis"],
          mentioned: { db: [], kb: [], mcp: [], skill: ["data-analysis"] },
          skillIds: ["data-analysis"],
          skillMode: "selected",
        },
      };
      const agent = createAgent(metadata, {
        actualLoadedSkill: {
          content: DATA_ANALYSIS_SKILL_CONTENT,
          packageRefId: "data-analysis-package-ref",
        },
        root,
        terminal: "post-claim-failure",
      });

      await collectEvents(agent, input);
      const firstReplay = new RunEventWriter(metadata.runEvents).replay({
        user_id: USER_ID,
        run_id: input.runId,
      });
      expect(firstReplay.filter(({ event }) => isCustomNamed(event, "skill.materialized"))).toHaveLength(1);
      expect(firstReplay.filter(({ event }) => isCustomNamed(event, "skill.loaded"))).toHaveLength(1);
      expect(firstReplay.find(({ event }) => isCustomNamed(event, "skill.loaded"))?.event).toMatchObject({
        value: {
          eventId: expect.stringMatching(/^skill-loaded:actual-loaded-skill-run:data-analysis:/u),
          skill: {
            id: "data-analysis",
            package_ref: "data-analysis-package-ref",
          },
        },
      });

      await collectEvents(agent, input);
      expect(new RunEventWriter(metadata.runEvents).replay({
        user_id: USER_ID,
        run_id: input.runId,
      })).toEqual(firstReplay);
    } finally {
      metadata.close();
    }
  });

  it("keeps an ordinary Energy run Skill-free when auto mode only matches data-analysis prose", async () => {
    const metadata = createTestMetadata(root);
    try {
      metadata.configResources.upsert({
        id: "data-analysis",
        workspace_id: WORKSPACE_ID,
        user_id: USER_ID,
        kind: "skill",
        name: "data-analysis",
        description: "Analyze governed energy data",
        payload: {
          packageFileRefId: "unused-implicit-data-analysis-package",
          userInvocable: true,
          version: "1.0.0",
        },
        default_enabled: true,
        status: "valid",
      });
      const input = energyRunInput(
        "ordinary-data-analysis-default-off-run",
        "ordinary-data-analysis-default-off-session",
        "Please perform data analysis for this project.",
      );
      (input.forwardedProps as { run_config: Record<string, unknown> }).run_config = {
        activeSkillId: "data-analysis",
        enabledDatasourceIds: [],
        enabledKnowledgeIds: [],
        enabledMcpServerIds: [],
        enabledSkillIds: ["data-analysis"],
        protocol: { id: "general-task", version: "1" },
        skillMode: "auto",
        skillPolicy: {
          allowedToolNames: [],
          deniedToolNames: [],
          maxSkills: 1,
          requireUserInvocable: true,
          strictSkillTools: true,
        },
      };

      await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), input);

      expect(serverSeams.order).toContain("skills:");
      expect(serverSeams.order).not.toContain("skills:data-analysis");
      expect(serverSeams.assemblyRunConfigs.at(-1)).toMatchObject({
        enabledSkillIds: [],
        skillMode: "selected",
      });
    } finally {
      metadata.close();
    }
  });

  it("keeps a claimed Run live and cancelable after the browser transport disconnects", async () => {
    const metadata = createTestMetadata(root);
    const runCancelRegistry = new RunCancelRegistry();
    let releaseRuntime!: () => void;
    let releaseDestroy!: () => void;
    let notifyDestroyStarted!: () => void;
    const runtimeBarrier = new Promise<void>((resolve) => {
      releaseRuntime = resolve;
    });
    const destroyWorkspaceBarrier = new Promise<void>((resolve) => {
      releaseDestroy = resolve;
    });
    const destroyStarted = new Promise<void>((resolve) => {
      notifyDestroyStarted = resolve;
    });
    try {
      const runId = "background-after-transport-close-run";
      const sessionId = "background-after-transport-close-session";
      const agent = createAgent(metadata, {
        root,
        destroyWorkspaceBarrier,
        onDestroyWorkspace: notifyDestroyStarted,
        runCancelRegistry,
        runtimeBarrier,
        terminal: "complete",
      });
      let subscription: Subscription | undefined;
      subscription = agent.run(energyRunInput(runId, sessionId)).subscribe({
        error: () => undefined,
      });

      await vi.waitFor(() => {
        expect(runCancelRegistry.has({ userId: USER_ID, runId })).toBe(true);
      });
      subscription.unsubscribe();

      expect(runCancelRegistry.has({ userId: USER_ID, runId })).toBe(true);
      expect(runCancelRegistry.cancel({
        userId: USER_ID,
        runId,
        reason: "TEST_BACKGROUND_RUN_CLEANUP",
      })).toMatchObject({ canceled: true, runId, sessionId });
      await destroyStarted;
      expect(runCancelRegistry.has({ userId: USER_ID, runId })).toBe(true);
      expect(metadata.runs.find({ user_id: USER_ID, run_id: runId })).toMatchObject({
        status: "canceled",
        error_message: "TEST_BACKGROUND_RUN_CLEANUP",
      });
      releaseDestroy();
      await vi.waitFor(() => {
        expect(metadata.runs.find({ user_id: USER_ID, run_id: runId })?.status).toBe("canceled");
      });
      await vi.waitFor(() => {
        expect(runCancelRegistry.has({ userId: USER_ID, runId })).toBe(false);
      });
    } finally {
      releaseRuntime();
      releaseDestroy();
      metadata.close();
    }
  });

  it("releases Run ownership only after asynchronous terminal finalization settles", async () => {
    let releaseFinalization!: () => void;
    let ownershipReleased = false;
    const pendingFinalization = new Promise<void>((resolve) => {
      releaseFinalization = resolve;
    });
    const retained = retainRunOwnershipUntilFinalized(
      pendingFinalization,
      () => { ownershipReleased = true; },
    );

    expect(ownershipReleased).toBe(false);
    releaseFinalization();
    await retained;
    expect(ownershipReleased).toBe(true);
  });

  it("claims the Run before a missing package can lazily open expensive seams", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-success-session");
      const claim = metadata.runs.claim.bind(metadata.runs);
      vi.spyOn(metadata.runs, "claim").mockImplementation((input) => {
        serverSeams.order.push("run-claim");
        return claim(input);
      });
      const append = metadata.runEvents.append.bind(metadata.runEvents);
      vi.spyOn(metadata.runEvents, "append").mockImplementation((input) => {
        const phase = preparationPhase(input.event);
        serverSeams.order.push(phase ? `persist:${phase}` : `persist:${input.event.type}`);
        return append(input);
      });
      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput("preparation-success-run", "preparation-success-session"));

      const preparationEvents = events.filter(isPreparationEvent);
      expect(preparationEvents.map(preparationPhase)).toEqual([
        "request-accepted",
        "query-context-resolved",
        "meter-route-resolved",
        "analysis-context-package-resolved",
        "run-claimed",
      ]);
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(serverSeams.order.indexOf("run-claim"))
        .toBeLessThan(serverSeams.order.indexOf("persist:request-accepted"));

      const persisted = new RunEventWriter(metadata.runEvents).replay({
        user_id: USER_ID,
        run_id: "preparation-success-run",
      }).map((envelope) => envelope.event);
      expect(persisted.filter(isPreparationEvent).map(preparationPhase))
        .toEqual(preparationEvents.map(preparationPhase));
      expect(persisted.filter((event) => event.type === EventType.RUN_STARTED)).toHaveLength(1);
      expect(events.filter((event) => event.type === EventType.RUN_STARTED)).toHaveLength(1);
      expect(events[0]).toMatchObject({
        runId: "preparation-success-run",
        type: EventType.RUN_STARTED,
      });
      expect(persisted.findIndex((event) => preparationPhase(event) === "run-claimed"))
        .toBeLessThan(persisted.findIndex((event) => event.type === EventType.RUN_STARTED));
      expect(serverSeams.order).toContain("skills:");
      expect(serverSeams.order).not.toContain("skills:energy-insight-investigation");
      expect(tableCount(metadata, "model_request_snapshots")).toBe(0);
    } finally {
      metadata.close();
    }
  });

  it("reuses an exact Analysis Context Package without a second full ProjectAnalysis", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-package-hit-session");
      serverSeams.resolvePublishedContext.mockImplementation(() => {
        serverSeams.order.push("query-context");
        return { context: exactEnergyContext(), projectRelease: projectRelease() };
      });
      serverSeams.readAnalysisContextPackage.mockImplementation(async () => {
        serverSeams.order.push("analysis-context-package:hit");
        return analysisContextPackage();
      });
      const claim = metadata.runs.claim.bind(metadata.runs);
      vi.spyOn(metadata.runs, "claim").mockImplementation((input) => {
        serverSeams.order.push("run-claim");
        return claim(input);
      });

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-package-hit-run",
        "preparation-package-hit-session",
        "What is the total energy usage?",
      ));

      expect(serverSeams.readAnalysisContextPackage).toHaveBeenCalledWith(expect.objectContaining({
        context: exactEnergyContext(),
        projectRelease: projectRelease(),
        workspaceId: WORKSPACE_ID,
      }));
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(serverSeams.order).toContain("evidence-first:false");
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      const releasedEvidenceItem = serverSeams.assemblyEvidenceContextItems.at(-1)
        ?.find((item) => (
          typeof item === "object"
          && item !== null
          && "sourceType" in item
          && item.sourceType === "project-analysis-snapshot"
        )) as { content?: unknown } | undefined;
      expect(String(releasedEvidenceItem?.content)).toContain("context_evidence_selection=");
      expect(String(releasedEvidenceItem?.content)).toContain("analysis.summary.usage_kwh");
      expect(String(releasedEvidenceItem?.content)).not.toContain("deterministic_evidence_bundle=");
      expect(serverSeams.assemblyRunConfigs.at(-1)).toMatchObject({
        enabledDatasourceIds: [],
        protocol: { protocolId: "data-analysis", protocolVersion: "1" },
      });
      expect(serverSeams.assemblyOptions.at(-1)).toMatchObject({
        analysisRequirementsMode: undefined,
        excludedToolNames: expect.arrayContaining(["inspect_schema", "run_sql_readonly"]),
      });
      expect(serverSeams.order.indexOf("analysis-context-package:hit"))
        .toBeLessThan(serverSeams.order.indexOf("run-claim"));
      expect(events.filter(isPreparationEvent).map(preparationPhase)).toEqual([
        "request-accepted",
        "query-context-resolved",
        "meter-route-resolved",
        "analysis-context-package-resolved",
        "run-claimed",
      ]);
      expect(preparationPackageStatus(events.find(
        (event) => preparationPhase(event) === "analysis-context-package-resolved",
      ))).toBe("package_hit");
    } finally {
      metadata.close();
    }
  });

  it("answers the current hourly and off-hours pattern from the exact released package without SQL", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-hourly-package-session");
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: exactEnergyContext(), projectRelease: projectRelease(),
      });
      serverSeams.readAnalysisContextPackage.mockResolvedValue(currentHourlyContextPackage());

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-hourly-package-run",
        "preparation-hourly-package-session",
        "请分析当前范围内每小时用电模式，并指出峰值时段和异常的非营业时段。",
      ));

      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.inspectSchema).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(preparationPackageStatus(events.find(
        (event) => preparationPhase(event) === "analysis-context-package-resolved",
      ))).toBe("package_hit");
      const releasedEvidenceItem = serverSeams.assemblyEvidenceContextItems.at(-1)
        ?.find((item) => (
          typeof item === "object"
          && item !== null
          && "sourceType" in item
          && item.sourceType === "project-analysis-snapshot"
        )) as { content?: unknown } | undefined;
      expect(String(releasedEvidenceItem?.content)).toContain("analysis.hourly_profile.07.usage_kwh");
      expect(String(releasedEvidenceItem?.content)).toContain("analysis.hourly_profile.08.peak_kw");
      expect(String(releasedEvidenceItem?.content)).toContain("analysis.hourly_profile.23.peak_kw");
      expect(String(releasedEvidenceItem?.content)).toContain("analysis.off_hours.share_pct");
      expect(String(releasedEvidenceItem?.content)).toContain("preschool.operational.closed_hour_spikes.count");
      expect(String(releasedEvidenceItem?.content)).not.toContain("deterministic_evidence_bundle=");
      expect(serverSeams.assemblyOptions.at(-1)).toMatchObject({
        excludedToolNames: expect.arrayContaining(["inspect_schema", "run_sql_readonly"]),
      });
    } finally {
      metadata.close();
    }
  });

  it("answers a priority question from the exact current Overview when the all-available package lacks benchmark facts", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-overview-reference-session");
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: exactEnergyContext(), projectRelease: projectRelease(),
      });
      serverSeams.readAnalysisContextPackage.mockResolvedValue(analysisContextPackage());
      serverSeams.readCurrentOverviewProjection.mockResolvedValue(currentOverviewPriorityPackage());

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-overview-reference-run",
        "preparation-overview-reference-session",
        "请按证据列出最值得优先核查的 3 个 Centre，并说明理由。",
      ));

      expect(serverSeams.readCurrentOverviewProjection).toHaveBeenCalledWith(expect.objectContaining({
        expectedDataSnapshotId: "snapshot-1",
        expectedFrom: "2026-05-31T16:00:00.000Z",
        expectedProjectReleaseId: "release-1",
        expectedTo: "2026-06-30T16:00:00.000Z",
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }));
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(preparationPackageStatus(events.find(
        (event) => preparationPhase(event) === "analysis-context-package-resolved",
      ))).toBe("package_hit");
      const releasedEvidenceItem = serverSeams.assemblyEvidenceContextItems.at(-1)
        ?.find((item) => (
          typeof item === "object"
          && item !== null
          && "sourceType" in item
          && item.sourceType === "project-analysis-snapshot"
        )) as { content?: unknown } | undefined;
      for (const centreCode of ["g", "l", "h"]) {
        expect(String(releasedEvidenceItem?.content)).toContain(
          `preschool.benchmark.centres.centre-${centreCode}.priority`,
        );
        expect(String(releasedEvidenceItem?.content)).toContain(
          `preschool.benchmark.centres.centre-${centreCode}.annualised_eui`,
        );
        expect(String(releasedEvidenceItem?.content)).toContain(
          `preschool.benchmark.centres.centre-${centreCode}.per_pax`,
        );
      }
      expect(serverSeams.assemblyOptions.at(-1)).toMatchObject({
        excludedToolNames: expect.arrayContaining(["inspect_schema", "run_sql_readonly"]),
      });
    } finally {
      metadata.close();
    }
  });

  it("answers a priority question from the exact current Overview when the analysis package is not materialized", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-overview-without-package-session");
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: exactEnergyContext(), projectRelease: projectRelease(),
      });
      serverSeams.readAnalysisContextPackage.mockResolvedValue(undefined);
      serverSeams.readCurrentOverviewProjection.mockResolvedValue(currentOverviewPriorityPackage());

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-overview-without-package-run",
        "preparation-overview-without-package-session",
        "请按证据列出最值得优先核查的 3 个 Centre，并说明理由。",
      ));

      expect(serverSeams.readCurrentOverviewProjection).toHaveBeenCalledOnce();
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(preparationPackageStatus(events.find(
        (event) => preparationPhase(event) === "analysis-context-package-resolved",
      ))).toBe("package_hit");
      expect(serverSeams.assemblyOptions.at(-1)).toMatchObject({
        excludedToolNames: expect.arrayContaining(["inspect_schema", "run_sql_readonly"]),
      });
    } finally {
      metadata.close();
    }
  });

  it("keeps targeted SQL for a child Scope even when the Project Overview has sufficient facts", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-child-scope-session");
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: {
          ...exactEnergyContext(),
          scopeId: "centre-g",
          scopeName: "Centre G",
          scopeType: "centre",
        },
        projectRelease: projectRelease(),
      });
      serverSeams.readAnalysisContextPackage.mockResolvedValue(analysisContextPackage());
      serverSeams.readCurrentOverviewProjection.mockResolvedValue(currentOverviewPriorityPackage());

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-child-scope-run",
        "preparation-child-scope-session",
        "请按证据列出最值得优先核查的 3 个 Centre，并说明理由。",
      ));

      expect(serverSeams.readCurrentOverviewProjection).not.toHaveBeenCalled();
      expect(preparationPackageStatus(events.find(
        (event) => preparationPhase(event) === "analysis-context-package-resolved",
      ))).toBe("targeted_query");
      expect(serverSeams.assemblyOptions.at(-1)).toMatchObject({
        excludedToolNames: undefined,
      });
    } finally {
      metadata.close();
    }
  });

  it("keeps targeted SQL when the current Overview window does not match the Session", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-window-mismatch-session");
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: exactEnergyContext(),
        projectRelease: projectRelease(),
      });
      serverSeams.readAnalysisContextPackage.mockResolvedValue(analysisContextPackage());
      serverSeams.readCurrentOverviewProjection.mockRejectedValue(
        new Error("ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH"),
      );

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-window-mismatch-run",
        "preparation-window-mismatch-session",
        "请按证据列出最值得优先核查的 3 个 Centre，并说明理由。",
      ));

      expect(serverSeams.readCurrentOverviewProjection).toHaveBeenCalledWith(expect.objectContaining({
        expectedFrom: "2026-05-31T16:00:00.000Z",
        expectedTo: "2026-06-30T16:00:00.000Z",
      }));
      expect(preparationPackageStatus(events.find(
        (event) => preparationPhase(event) === "analysis-context-package-resolved",
      ))).toBe("targeted_query");
      expect(serverSeams.assemblyOptions.at(-1)).toMatchObject({
        excludedToolNames: undefined,
      });
    } finally {
      metadata.close();
    }
  });

  it("opens the exact scoped workspace once only when a package-gap Agent invokes a data tool", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-package-gap-session");
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: exactEnergyContext(), projectRelease: projectRelease(),
      });
      serverSeams.readAnalysisContextPackage.mockResolvedValue(analysisContextPackage());

      await collectEvents(createAgent(metadata, {
        root,
        invokeLazyGateway: true,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-package-gap-run",
        "preparation-package-gap-session",
        "Forecast next year's tariff cost.",
      ));

      expect(serverSeams.order).toContain("evidence-first:true");
      expect(serverSeams.ensureWorkspace).toHaveBeenCalledOnce();
      expect(serverSeams.inspectSchema).toHaveBeenCalledWith(expect.objectContaining({
        datasource_id: DATASOURCE_ID,
      }));
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
    } finally {
      metadata.close();
    }
  });

  it("persists exact startup milestones through the first visible model content", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-latency-session");
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: exactEnergyContext(),
        projectRelease: projectRelease(),
      });
      serverSeams.readAnalysisContextPackage.mockResolvedValue(analysisContextPackage());

      const events = await collectEvents(createAgent(metadata, {
        root,
        runtimeEvents: [
          createCustomEvent("model.request.prepared", {
            eventId: "model-request-prepared:preparation-latency-run:1:0",
          }),
          { type: "REASONING_START", messageId: "reasoning-1" } as never,
          {
            type: "REASONING_MESSAGE_CONTENT",
            messageId: "reasoning-1",
            delta: "Inspecting the exact released package.",
          } as never,
        ],
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-latency-run",
        "preparation-latency-session",
        "What is the total energy usage?",
      ));

      expect(events.filter(isLatencyEvent).map(latencyPhase)).toEqual([
        "request-received",
        "agent-runtime-started",
        "model-request-prepared",
        "first-model-event",
        "first-model-content",
      ]);
      const persisted = metadata.runEvents.listByRun({
        user_id: USER_ID,
        run_id: "preparation-latency-run",
      }).map(({ payload_json }) => JSON.parse(payload_json) as BaseEvent);
      expect(persisted.filter(isLatencyEvent).map(latencyPhase)).toEqual([
        "request-received",
        "agent-runtime-started",
        "model-request-prepared",
        "first-model-event",
        "first-model-content",
      ]);
      expect(JSON.stringify(events.filter(isLatencyEvent))).not.toMatch(
        /prompt|sql|evidence_text|credential|api[_-]?key|customer/i,
      );
      expect(events.filter((event) => isPreparationEvent(event) || isLatencyEvent(event))
        .every((event) => eventCorrelationId(event) === "f47ac10b-58cc-4372-a567-0e02b2c3d479"))
        .toBe(true);
    } finally {
      metadata.close();
    }
  });

  it("prepares only the targeted datasource when a package does not answer the question", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-targeted-query-session");
      serverSeams.resolvePublishedContext.mockImplementation(() => ({
        context: exactEnergyContext(),
        projectRelease: projectRelease(),
      }));
      serverSeams.readAnalysisContextPackage.mockResolvedValue(analysisContextPackage());

      const events = await collectEvents(createAgent(metadata, {
        root,
        invokeLazyGateway: true,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-targeted-query-run",
        "preparation-targeted-query-session",
        "Forecast next year's tariff cost.",
      ));

      expect(serverSeams.ensureWorkspace).toHaveBeenCalledTimes(1);
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(serverSeams.order.indexOf("stream:request-accepted"))
        .toBeLessThan(serverSeams.order.indexOf("workspace"));
      expect(serverSeams.order.indexOf("stream:RUN_STARTED"))
        .toBeLessThan(serverSeams.order.indexOf("workspace"));
      expect(events.findIndex((event) => preparationPhase(event) === "analysis-context-package-resolved"))
        .toBeLessThan(events.findIndex((event) => preparationPhase(event) === "scoped-datasource-ready"));
      expect(preparationPackageStatus(events.find(
        (event) => preparationPhase(event) === "analysis-context-package-resolved",
      ))).toBe("targeted_query");
      expect(events.filter(isPreparationEvent).map(preparationPhase)).toContain(
        "scoped-datasource-ready",
      );
      expect(serverSeams.assemblyEvidenceContextItems.at(-1)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceType: "project-analysis-snapshot" }),
        ]),
      );
    } finally {
      metadata.close();
    }
  });

  it("keeps package supporting evidence while opening exact lazy SQL for the missing explanation", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-supporting-query-session");
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: exactEnergyContext(),
        projectRelease: projectRelease(),
      });
      serverSeams.readAnalysisContextPackage.mockResolvedValue(analysisContextPackage());

      const events = await collectEvents(createAgent(metadata, {
        root,
        invokeLazyGateway: true,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-supporting-query-run",
        "preparation-supporting-query-session",
        "为什么总用电量是 0 kWh？",
      ));

      expect(preparationPackageStatus(events.find(
        (event) => preparationPhase(event) === "analysis-context-package-resolved",
      ))).toBe("targeted_query");
      expect(serverSeams.ensureWorkspace).toHaveBeenCalledOnce();
      expect(serverSeams.assemblyRunConfigs.at(-1)).toMatchObject({
        activeDatasourceId: "energyiq-lazy-preparation-supporting-query-run",
        enabledDatasourceIds: ["energyiq-lazy-preparation-supporting-query-run"],
      });
      const supportingEvidenceItem = serverSeams.assemblyEvidenceContextItems.at(-1)
        ?.find((item) => (
          typeof item === "object"
          && item !== null
          && "sourceType" in item
          && item.sourceType === "project-analysis-snapshot"
        )) as { content?: unknown } | undefined;
      expect(String(supportingEvidenceItem?.content)).toContain('"mode":"supporting"');
      expect(serverSeams.assemblyOptions.at(-1)).toMatchObject({
        analysisRequirementsMode: undefined,
        excludedToolNames: undefined,
      });
    } finally {
      metadata.close();
    }
  });

  it("opens lazy exact SQL without materializing a missing package before Run claim", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-package-miss-session");
      serverSeams.resolvePublishedContext.mockImplementation(() => ({
        context: exactEnergyContext(),
        projectRelease: projectRelease(),
      }));
      await collectEvents(createAgent(metadata, {
        root,
        invokeLazyGateway: true,
        terminal: "post-claim-failure",
      }), energyRunInput("preparation-package-miss-run", "preparation-package-miss-session"));

      expect(serverSeams.ensureWorkspace).toHaveBeenCalledOnce();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(serverSeams.materializeAnalysisContextPackage).not.toHaveBeenCalled();
      expect(serverSeams.assemblyRunConfigs.at(-1)).toMatchObject({
        activeDatasourceId: "energyiq-lazy-preparation-package-miss-run",
        enabledDatasourceIds: ["energyiq-lazy-preparation-package-miss-run"],
      });
    } finally {
      metadata.close();
    }
  });

  it("persists emitted preparation and terminates honestly when exact context resolution fails", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-failure-session");
      serverSeams.resolvePublishedContext.mockImplementation(() => {
        serverSeams.order.push("query-context-failed");
        throw new Error("ENERGYIQ_TEST_CONTEXT_UNAVAILABLE");
      });
      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput("preparation-failure-run", "preparation-failure-session"));

      expect(events.filter(isPreparationEvent).map(preparationPhase)).toEqual(["request-accepted"]);
      expect(events.filter((event) => event.type === EventType.RUN_STARTED)).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({
        runId: "preparation-failure-run",
        runTerminalKind: "durable",
        status: "failed",
        type: EventType.RUN_ERROR,
        message: "ENERGYIQ_TEST_CONTEXT_UNAVAILABLE",
      });
      expect(metadata.runs.find({ user_id: USER_ID, run_id: "preparation-failure-run" }))
        .toMatchObject({ status: "failed", error_message: "ENERGYIQ_TEST_CONTEXT_UNAVAILABLE" });
      const persisted = new RunEventWriter(metadata.runEvents).replay({
        user_id: USER_ID,
        run_id: "preparation-failure-run",
      }).map((envelope) => envelope.event);
      expect(persisted.filter(isPreparationEvent).map(preparationPhase))
        .toEqual(["request-accepted"]);
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(tableCount(metadata, "model_request_snapshots")).toBe(0);
    } finally {
      metadata.close();
    }
  });

  it("rejects a generic Run before claim when the Session has an exact EnergyIQ binding", async () => {
    const metadata = createTestMetadata(root);
    try {
      metadata.sessions.createWithEnergyContext({
        user_id: USER_ID,
        id: "persisted-generic-bypass-session",
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "Continued current data",
        title_source: "fallback",
        energy_context: persistedEnergyContext(),
      });
      const input = energyRunInput(
        "persisted-generic-bypass-run",
        "persisted-generic-bypass-session",
      );
      (input.forwardedProps as { externalContext: unknown }).externalContext = {};
      const runCountBefore = tableCount(metadata, "runs");
      const messageCountBefore = tableCount(metadata, "conversation_messages");

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), input);

      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_ERROR,
        message: "ENERGYIQ_SESSION_CONTEXT_REQUIRED",
      });
      expect(serverSeams.resolvePublishedContext).not.toHaveBeenCalled();
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(tableCount(metadata, "model_request_snapshots")).toBe(0);
      expect(tableCount(metadata, "runs")).toBe(runCountBefore);
      expect(tableCount(metadata, "conversation_messages")).toBe(messageCountBefore);
    } finally {
      metadata.close();
    }
  });

  it("fails closed before context resolution when a persisted Session binding is malformed", async () => {
    const metadata = createTestMetadata(root);
    try {
      metadata.sessions.createWithEnergyContext({
        user_id: USER_ID,
        id: "persisted-malformed-session",
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "Continued current data",
        title_source: "fallback",
        energy_context: persistedEnergyContext(),
      });
      metadata.db.prepare(`
        UPDATE sessions
        SET energy_context_json = ?
        WHERE user_id = ? AND id = ?
      `).run("", USER_ID, "persisted-malformed-session");
      const runCountBefore = tableCount(metadata, "runs");
      const messageCountBefore = tableCount(metadata, "conversation_messages");

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput("persisted-malformed-run", "persisted-malformed-session"));

      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_ERROR,
        message: "ENERGYIQ_SESSION_CONTEXT_INVALID",
      });
      expect(serverSeams.resolvePublishedContext).not.toHaveBeenCalled();
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(tableCount(metadata, "model_request_snapshots")).toBe(0);
      expect(tableCount(metadata, "runs")).toBe(runCountBefore);
      expect(tableCount(metadata, "conversation_messages")).toBe(messageCountBefore);
    } finally {
      metadata.close();
    }
  });

  it("pins a pre-migration historical Session to its latest server-owned Energy context", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "historical-unmigrated-session");
      metadata.runs.create({
        user_id: USER_ID,
        id: "historical-unmigrated-source-run",
        session_id: "historical-unmigrated-session",
        user_input: "Explain historical evidence",
        status: "completed",
      });
      metadata.contextPackageSnapshots.create({
        user_id: USER_ID,
        session_id: "historical-unmigrated-session",
        run_id: "historical-unmigrated-source-run",
        package_id: "historical-unmigrated-package",
        revision: 1,
        payload: authoritativeEnergyContextPackage(historicalEnergyContext()),
      });
      metadata.contextPackageSnapshots.create({
        user_id: USER_ID,
        session_id: "historical-unmigrated-session",
        run_id: "historical-unmigrated-source-run",
        package_id: "later-generic-package",
        revision: 2,
        payload: { items: [] },
      });
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: { ...exactEnergyContext(), dataSnapshotId: "snapshot-drifted" },
        projectRelease: projectRelease(),
      });
      const runCountBefore = tableCount(metadata, "runs");
      const messageCountBefore = tableCount(metadata, "conversation_messages");

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput("historical-unmigrated-follow-up", "historical-unmigrated-session"));

      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_ERROR,
        message: "ENERGYIQ_SESSION_CONTEXT_MISMATCH",
      });
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(tableCount(metadata, "model_request_snapshots")).toBe(0);
      expect(tableCount(metadata, "runs")).toBe(runCountBefore);
      expect(tableCount(metadata, "conversation_messages")).toBe(messageCountBefore);
    } finally {
      metadata.close();
    }
  });

  it("fails closed before resolution when an existing historical Session has no recoverable Energy binding", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "historical-binding-missing-session");
      metadata.runs.create({
        user_id: USER_ID,
        id: "historical-binding-missing-source-run",
        session_id: "historical-binding-missing-session",
        user_input: "Historical question without an exact Energy package",
        status: "completed",
      });
      const runCountBefore = tableCount(metadata, "runs");
      const messageCountBefore = tableCount(metadata, "conversation_messages");

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "historical-binding-missing-follow-up",
        "historical-binding-missing-session",
      ));

      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_ERROR,
        message: "ENERGYIQ_SESSION_CONTEXT_UNAVAILABLE",
      });
      expect(serverSeams.resolvePublishedContext).not.toHaveBeenCalled();
      expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
      expect(serverSeams.resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(tableCount(metadata, "model_request_snapshots")).toBe(0);
      expect(tableCount(metadata, "runs")).toBe(runCountBefore);
      expect(tableCount(metadata, "conversation_messages")).toBe(messageCountBefore);
    } finally {
      metadata.close();
    }
  });

  it("keeps unavailable continuation lineage in the first Run ContextPackage and reload", async () => {
    const metadata = createTestMetadata(root);
    try {
      const persisted = {
        ...historicalEnergyContext(),
        forkedFromSessionId: "source-contextless-session",
        forkedFromContextStatus: "unavailable" as const,
        forkedFromUnavailableReason: "source-context-unavailable" as const,
      };
      metadata.sessions.createWithEnergyContext({
        user_id: USER_ID,
        id: "continued-current-session",
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "Continued current data",
        title_source: "fallback",
        energy_context: persisted,
      });
      serverSeams.resolvePublishedContext.mockReturnValue({
        context: exactEnergyContext(),
        projectRelease: projectRelease(),
      });
      const input = energyRunInput("continued-current-run", "continued-current-session");
      input.forwardedProps = {
        ...input.forwardedProps,
        externalContext: {
          ...(input.forwardedProps?.externalContext as Record<string, unknown>),
          forkedFromSessionId: "source-contextless-session",
          forkedFromContextStatus: "unavailable",
          forkedFromUnavailableReason: "source-context-unavailable",
        },
      };

      const events = await collectEvents(createAgent(metadata, {
        recordContextPackage: true,
        root,
        terminal: "post-claim-failure",
      }), input);
      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_ERROR,
        message: "TEST_LOCAL_TERMINAL",
      });

      const reloadedSnapshot = [...metadata.contextPackageSnapshots.iterateBySession({
        user_id: USER_ID,
        session_id: "continued-current-session",
      })][0];
      expect(reloadedSnapshot).toBeDefined();
      expect(sessionEnergyContextFromSnapshot(reloadedSnapshot!)).toMatchObject({
        forkedFromSessionId: "source-contextless-session",
        forkedFromContextStatus: "unavailable",
        forkedFromUnavailableReason: "source-context-unavailable",
      });
    } finally {
      metadata.close();
    }
  });

  it("keeps the claimed durable failure when auxiliary conversation persistence fails", async () => {
    const metadata = createTestMetadata(root);
    try {
      seedTitledSession(metadata, "preparation-auxiliary-failure-session");
      serverSeams.resolvePublishedContext.mockImplementation(() => {
        throw new Error("ENERGYIQ_TEST_CONTEXT_UNAVAILABLE");
      });
      vi.spyOn(metadata.conversationMessages, "append").mockImplementation(() => {
        throw new Error("TEST_AUXILIARY_MESSAGE_WRITE_FAILED");
      });
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), energyRunInput(
        "preparation-auxiliary-failure-run",
        "preparation-auxiliary-failure-session",
      ));

      expect(events.at(-1)).toMatchObject({
        runId: "preparation-auxiliary-failure-run",
        runTerminalKind: "durable",
        status: "failed",
      });
      expect(metadata.runs.get({
        user_id: USER_ID,
        run_id: "preparation-auxiliary-failure-run",
      })).toMatchObject({
        error_message: "ENERGYIQ_TEST_CONTEXT_UNAVAILABLE",
        status: "failed",
      });
      expect(metadata.runEvents.listByRun({
        user_id: USER_ID,
        run_id: "preparation-auxiliary-failure-run",
      })).not.toHaveLength(0);
    } finally {
      metadata.close();
    }
  });

  it.each([
    {
      label: "missing live interaction",
      interruptRunId: "interaction-missing-run",
      response: { approved: true },
      runtimeEvent: {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "missing-tool-call",
        content: "approved",
      } as BaseEvent,
      expectedMessage: "INTERACTION_NOT_FOUND:missing-tool-call",
    },
    {
      label: "mismatched restored interaction",
      interruptRunId: "foreign-restored-run",
      response: { approved: true },
      runtimeEvent: {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "mismatched-tool-call",
        content: "approved",
      } as BaseEvent,
      expectedMessage: "INTERACTION_IDENTITY_MISMATCH:mismatched-tool-call",
      seedForeignInteraction: true,
    },
    {
      label: "missing cancellation interaction",
      interruptRunId: "interaction-cancel-run",
      response: false as const,
      runtimeEvent: { type: EventType.RUN_FINISHED } as BaseEvent,
      expectedMessage: "INTERACTION_NOT_FOUND:cancel-tool-call",
    },
  ])("fails $label through one exact durable Run terminal", async ({
    expectedMessage,
    interruptRunId,
    response,
    runtimeEvent,
    seedForeignInteraction,
  }) => {
    const metadata = createTestMetadata(root);
    const requestedRunId = response === false ? "interaction-cancel-run" : "interaction-missing-run";
    const runId = interruptRunId;
    const sessionId = `${requestedRunId}-session`;
    const toolCallId = response === false
      ? "cancel-tool-call"
      : (runtimeEvent as BaseEvent & { toolCallId?: string }).toolCallId!;
    try {
      if (seedForeignInteraction) {
        serverSeams.resolvePublishedContext.mockReturnValue({
          context: exactEnergyContext(),
          projectRelease: projectRelease(),
        });
        metadata.sessions.createWithEnergyContext({
          user_id: USER_ID,
          id: sessionId,
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          title: "Restored exact interaction",
          title_source: "user",
          energy_context: historicalEnergyContext(),
        });
        seedTitledSession(metadata, "foreign-restored-session");
        metadata.runs.create({
          user_id: USER_ID,
          id: runId,
          session_id: sessionId,
          user_input: "Suspended in another Session",
          status: "suspended",
        });
        metadata.contextPackageSnapshots.create({
          user_id: USER_ID,
          session_id: sessionId,
          run_id: runId,
          package_id: "foreign-restored-package",
          revision: 1,
          payload: authoritativeEnergyContextPackage(historicalEnergyContext()),
        });
        metadata.interactions.request({
          id: "foreign-restored-interaction",
          user_id: USER_ID,
          session_id: "foreign-restored-session",
          run_id: runId,
          tool_call_id: toolCallId,
          tool_name: "ask_user",
          payload: {},
        });
      } else {
        seedTitledSession(metadata, sessionId);
      }
      const input = interactionResumeRunInput({
        interruptRunId,
        response,
        runId: requestedRunId,
        sessionId,
        toolCallId,
      });
      const events = await collectEvents(createAgent(metadata, {
        root,
        runtimeEvents: [runtimeEvent],
        terminal: "post-claim-failure",
      }), input);

      const durableTerminals = events.filter((event) => (
        (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
      ));
      expect(durableTerminals).toHaveLength(1);
      expect(durableTerminals[0]).toMatchObject({
        message: expectedMessage,
        runId,
        runTerminalKind: "durable",
        status: "failed",
        type: EventType.RUN_ERROR,
      });
      expect(metadata.runs.find({ user_id: USER_ID, run_id: runId })).toMatchObject({
        error_message: expectedMessage,
        status: "failed",
      });
    } finally {
      metadata.close();
    }
  });

  it("keeps a malformed restored command non-durable when no authoritative Run exists", async () => {
    const metadata = createTestMetadata(root);
    const runId = "malformed-restored-command-run";
    const sessionId = "malformed-restored-command-session";
    try {
      seedTitledSession(metadata, sessionId);
      const input = energyRunInput(runId, sessionId);
      input.forwardedProps = {
        ...input.forwardedProps,
        command: {
          interruptEvent: { malformed: true },
          resume: { approved: true },
        },
      };

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), input);

      expect(() => assertAgUiClientFirstEvent(events)).not.toThrow();
      expect(events.find(isLatencyEvent)).toMatchObject({
        name: "energy.run.latency",
        type: EventType.CUSTOM,
        value: {
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          eventId: `energy-run-latency:${runId}:request-received`,
          phase: "request-received",
        },
      });
      expect(events.filter((event) => (
        (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
      ))).toHaveLength(0);
      expect(events.at(-1)).toMatchObject({
        message: "INVALID_INTERACTION_INTERRUPT",
        type: EventType.RUN_ERROR,
      });
      expect(events.at(-1)).not.toHaveProperty("runId");
      expect(metadata.runs.find({ user_id: USER_ID, run_id: runId })).toBeUndefined();
    } finally {
      metadata.close();
    }
  });

  it(
    "fails an authoritative suspended restored Run exactly once",
    async () => {
      const metadata = createTestMetadata(root);
      const status = "suspended" as const;
      const runId = "malformed-restored-suspended-run";
      const sessionId = "malformed-restored-suspended-session";
      try {
        seedTitledSession(metadata, sessionId);
        metadata.runs.create({
          user_id: USER_ID,
          id: runId,
          session_id: sessionId,
          user_input: "Resume the governed interaction",
          status,
        });
        const input = malformedRestoredRunInput(runId, sessionId);

        const events = await collectEvents(createAgent(metadata, {
          root,
          terminal: "post-claim-failure",
        }), input);

        expect(() => assertAgUiClientFirstEvent(events)).not.toThrow();
        expect(events.find(isLatencyEvent)).toMatchObject({
          name: "energy.run.latency",
          value: {
            eventId: `energy-run-latency:${runId}:request-received`,
            phase: "request-received",
          },
        });
        expectSingleDurableFailure(events, {
          message: "INVALID_INTERACTION_INTERRUPT",
          runId,
        });
        expect(metadata.runs.find({ user_id: USER_ID, run_id: runId })).toMatchObject({
          error_message: "INVALID_INTERACTION_INTERRUPT",
          session_id: sessionId,
          status: "failed",
        });
      } finally {
        metadata.close();
      }
    },
  );

  it("does not fail another running Run when a malformed resume names it", async () => {
    const metadata = createTestMetadata(root);
    const runId = "malformed-restored-running-run";
    const sessionId = "malformed-restored-running-session";
    try {
      seedTitledSession(metadata, sessionId);
      metadata.runs.create({
        user_id: USER_ID,
        id: runId,
        session_id: sessionId,
        user_input: "Another active prompt",
        status: "running",
      });

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), malformedRestoredRunInput("fresh-transport-run", sessionId, runId));

      expect(events.filter((event) => (
        (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
      ))).toHaveLength(0);
      expect(metadata.runs.get({ user_id: USER_ID, run_id: runId })).toMatchObject({
        status: "running",
      });
      expect(metadata.runEvents.listByRun({ user_id: USER_ID, run_id: runId })).toHaveLength(0);
    } finally {
      metadata.close();
    }
  });

  it.each(["completed", "canceled", "failed"] as const)(
    "does not rewrite an immutable %s restored Run",
    async (status) => {
      const metadata = createTestMetadata(root);
      const runId = `malformed-restored-${status}-run`;
      const sessionId = `malformed-restored-${status}-session`;
      try {
        seedTitledSession(metadata, sessionId);
        metadata.runs.create({
          user_id: USER_ID,
          id: runId,
          session_id: sessionId,
          user_input: "Already finalized",
          status,
        });

        const events = await collectEvents(createAgent(metadata, {
          root,
          terminal: "post-claim-failure",
        }), malformedRestoredRunInput(runId, sessionId));

        expect(events.filter((event) => (
          (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
        ))).toHaveLength(0);
        expect(events.at(-1)).not.toHaveProperty("runId");
        expect(metadata.runs.find({ user_id: USER_ID, run_id: runId })).toMatchObject({
          status,
        });
        expect(metadata.runEvents.listByRun({ user_id: USER_ID, run_id: runId })).toHaveLength(0);
      } finally {
        metadata.close();
      }
    },
  );

  it("does not emit a second durable terminal for a duplicate malformed resume", async () => {
    const metadata = createTestMetadata(root);
    const runId = "malformed-restored-duplicate-run";
    const sessionId = "malformed-restored-duplicate-session";
    try {
      seedTitledSession(metadata, sessionId);
      metadata.runs.create({
        user_id: USER_ID,
        id: runId,
        session_id: sessionId,
        user_input: "Resume once",
        status: "suspended",
      });

      const first = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), malformedRestoredRunInput(runId, sessionId));
      const duplicate = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), malformedRestoredRunInput(runId, sessionId));

      expect(first.filter((event) => (
        (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
      ))).toHaveLength(1);
      expect(duplicate.filter((event) => (
        (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
      ))).toHaveLength(0);
      expect(metadata.runs.find({ user_id: USER_ID, run_id: runId })).toMatchObject({
        error_message: "INVALID_INTERACTION_INTERRUPT",
        status: "failed",
      });
    } finally {
      metadata.close();
    }
  });

  it("binds malformed restored transport to the authorized suspended Run instead of the fresh request id", async () => {
    const metadata = createTestMetadata(root);
    const requestRunId = "malformed-restored-fresh-transport-run";
    const suspendedRunId = "malformed-restored-authoritative-run";
    const sessionId = "malformed-restored-authoritative-session";
    try {
      seedTitledSession(metadata, sessionId);
      metadata.runs.create({
        user_id: USER_ID,
        id: suspendedRunId,
        session_id: sessionId,
        user_input: "Suspended exact prompt",
        status: "suspended",
      });

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), malformedRestoredRunInput(requestRunId, sessionId, suspendedRunId));

      expect(() => assertAgUiClientFirstEvent(events)).not.toThrow();
      expect(events.find(isLatencyEvent)).toMatchObject({
        name: "energy.run.latency",
        value: { eventId: `energy-run-latency:${suspendedRunId}:request-received` },
      });
      expectSingleDurableFailure(events, {
        message: "INVALID_INTERACTION_INTERRUPT",
        runId: suspendedRunId,
      });
      expect(metadata.runs.get({ user_id: USER_ID, run_id: suspendedRunId })).toMatchObject({
        status: "failed",
      });
      expect(metadata.runEvents.listByRun({
        user_id: USER_ID,
        run_id: suspendedRunId,
      }).map(({ payload_json }) => JSON.parse(payload_json))).toEqual([
        expect.objectContaining({
          name: "energy.run.latency",
          value: expect.objectContaining({
            eventId: `energy-run-latency:${suspendedRunId}:request-received`,
          }),
        }),
      ]);
      expect(metadata.runs.find({ user_id: USER_ID, run_id: requestRunId })).toBeUndefined();
    } finally {
      metadata.close();
    }
  });

  it("does not bind a malformed restored transport to a Run owned by another Session", async () => {
    const metadata = createTestMetadata(root);
    const requestRunId = "malformed-restored-foreign-request";
    const suspendedRunId = "malformed-restored-foreign-run";
    const sessionId = "malformed-restored-current-session";
    try {
      seedTitledSession(metadata, sessionId);
      seedTitledSession(metadata, "malformed-restored-foreign-session");
      metadata.runs.create({
        user_id: USER_ID,
        id: suspendedRunId,
        session_id: "malformed-restored-foreign-session",
        user_input: "Foreign prompt",
        status: "suspended",
      });

      const events = await collectEvents(createAgent(metadata, {
        root,
        terminal: "post-claim-failure",
      }), malformedRestoredRunInput(requestRunId, sessionId, suspendedRunId));

      expect(() => assertAgUiClientFirstEvent(events)).not.toThrow();
      expect(events.find(isLatencyEvent)).toMatchObject({
        value: { eventId: `energy-run-latency:${requestRunId}:request-received` },
      });
      expect(events.filter((event) => (
        (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
      ))).toHaveLength(0);
      expect(metadata.runs.get({ user_id: USER_ID, run_id: suspendedRunId })).toMatchObject({
        status: "suspended",
      });
      expect(metadata.runEvents.listByRun({
        user_id: USER_ID,
        run_id: suspendedRunId,
      })).toHaveLength(0);
    } finally {
      metadata.close();
    }
  });

  it("routes a malformed live interrupt through the claimed Run finalizer once", async () => {
    const metadata = createTestMetadata(root);
    const runId = "malformed-live-interrupt-run";
    const sessionId = "malformed-live-interrupt-session";
    try {
      seedTitledSession(metadata, sessionId);
      const events = await collectEvents(createAgent(metadata, {
        root,
        runtimeEvents: [{
          type: EventType.CUSTOM,
          name: "on_interrupt",
          value: { type: "mastra_suspend", runId },
        } as BaseEvent],
        terminal: "post-claim-failure",
      }), energyRunInput(runId, sessionId));

      expectSingleDurableFailure(events, {
        message: "INVALID_INTERACTION_INTERRUPT",
        runId,
      });
      expect(metadata.runs.find({ user_id: USER_ID, run_id: runId })).toMatchObject({
        error_message: "INVALID_INTERACTION_INTERRUPT",
        session_id: sessionId,
        status: "failed",
      });
    } finally {
      metadata.close();
    }
  });
});

const expectSingleDurableFailure = (
  events: BaseEvent[],
  input: { message: string; runId: string },
): void => {
  const terminals = events.filter((event) => (
    (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
  ));
  expect(terminals).toHaveLength(1);
  expect(terminals[0]).toMatchObject({
    message: input.message,
    runId: input.runId,
    runTerminalKind: "durable",
    status: "failed",
    type: EventType.RUN_ERROR,
  });
};

const malformedRestoredRunInput = (
  runId: string,
  sessionId: string,
  interruptRunId = runId,
): RunAgentInput => {
  const input = energyRunInput(runId, sessionId);
  input.forwardedProps = {
    ...input.forwardedProps,
    command: {
      interruptEvent: {
        type: "mastra_suspend",
        runId: interruptRunId,
        malformed: true,
      },
      resume: { approved: true },
    },
  };
  return input;
};

const createAgent = (
  metadata: ReturnType<typeof createMetadataStore>,
  input: {
    actualLoadedSkill?: { content: Buffer; packageRefId: string };
    destroyWorkspaceBarrier?: Promise<void>;
    invokeLazyGateway?: boolean;
    onDestroyWorkspace?: () => void;
    recordContextPackage?: boolean;
    root: string;
    runCancelRegistry?: RunCancelRegistry;
    runtimeBarrier?: Promise<void>;
    runtimeEvents?: BaseEvent[];
    terminal: "complete" | "post-claim-failure";
  },
): DataFoundryAgUiAgent => {
  const fileAssetService = {
    gcOrphanAssets: () => 0,
    readRef: ({ id, user_id, workspace_id }: { id: string; user_id: string; workspace_id: string }) => {
      if (!input.actualLoadedSkill
        || id !== input.actualLoadedSkill.packageRefId
        || user_id !== USER_ID
        || workspace_id !== WORKSPACE_ID) {
        throw new Error("FILE_ASSET_REF_NOT_FOUND");
      }
      return { body: input.actualLoadedSkill.content, mimeType: "text/markdown" };
    },
  };
  return new DataFoundryAgUiAgent({
  artifactService: {} as never,
  completedMemoryFlushOverride: async () => undefined,
  conversationMemoryMode: "off",
  dataGateway: {
    inspectSchema: serverSeams.inspectSchema,
  } as never,
  fileAssetService: fileAssetService as never,
  knowledgeService: {} as never,
  memoryExtractionTimeoutMs: 50,
  metadataStore: metadata,
  runAgentAssemblyFactory: async (assemblyInput) => {
    serverSeams.order.push(`skills:${assemblyInput.selectedSkills.map((skill) => skill.id).join(",")}`);
    serverSeams.assemblyEvidenceContextItems.push(assemblyInput.evidenceContextItems ?? []);
    serverSeams.assemblyOptions.push({
      analysisRequirementsMode: assemblyInput.analysisRequirementsMode,
      excludedToolNames: assemblyInput.excludedToolNames,
    });
    if (input.recordContextPackage && assemblyInput.evidenceContextItems?.length) {
      assemblyInput.contextPackageRecorder?.record({
        contextPackage: {
          version: 2,
          packageId: "continued-current-authoritative-context",
          revision: 1,
          runId: assemblyInput.runContext.run_id,
          sessionId: assemblyInput.runContext.session_id,
          items: assemblyInput.evidenceContextItems,
          groups: [],
          sourceSnapshots: [],
          artifactRefs: [],
          auditRefs: [],
          truncation: [],
        },
      });
    }
    serverSeams.assemblyRunConfigs.push(
      assemblyInput.effectiveRunConfig as unknown as Record<string, unknown>,
    );
    serverSeams.order.push(`evidence-first:${Boolean(
      assemblyInput.preferEvidenceContextBeforeDataTools,
    )}`);
    const skillRunDir = join(input.root, "actual-loaded-skill-cache", assemblyInput.runContext.run_id);
    const materializedSkills = input.actualLoadedSkill
      ? await materializeSkillPackages({
          fileAssetService: fileAssetService as never,
          runDir: skillRunDir,
          skills: assemblyInput.selectedSkills,
          userId: assemblyInput.userId,
          workspaceId: assemblyInput.workspaceId,
        })
      : [];
    const loadedSkills = input.actualLoadedSkill
      ? loadMaterializedSkillInstructions({
          materializedSkills,
          runDir: skillRunDir,
          selectedSkills: assemblyInput.selectedSkills,
          userId: assemblyInput.userId,
          workspaceId: assemblyInput.workspaceId,
        })
      : [];
    return {
      destroyWorkspace: async () => {
        input.onDestroyWorkspace?.();
        await input.destroyWorkspaceBarrier;
      },
      flushProtocolEvents: () => undefined,
      governedMessages: assemblyInput.messages,
      loadedSkills,
      materializedSkills,
      mastraAgent: {
        run: () => new Observable<BaseEvent>((subscriber) => {
          serverSeams.order.push("stream:RUN_STARTED");
          subscriber.next({ type: EventType.RUN_STARTED, runId: assemblyInput.runContext.run_id });
          void (async () => {
            await input.runtimeBarrier;
            if (input.invokeLazyGateway) {
              expect(serverSeams.ensureWorkspace).not.toHaveBeenCalled();
              serverSeams.order.push("lazy-tool-invoked");
              await assemblyInput.dataGateway.inspectSchema({
                user_id: USER_ID,
                workspace_id: WORKSPACE_ID,
                datasource_id: assemblyInput.runContext.selected_datasource_id!,
              });
            }
            input.runtimeEvents?.forEach((event) => subscriber.next(event));
            if (input.terminal === "post-claim-failure") {
              subscriber.next({
                type: EventType.RUN_ERROR,
                message: "TEST_LOCAL_TERMINAL",
                timestamp: Date.now(),
              });
            } else {
              subscriber.next({
                type: EventType.RUN_FINISHED,
                timestamp: Date.now(),
              });
            }
            subscriber.complete();
          })().catch((error) => subscriber.error(error));
        }),
      } as never,
      protocol: {} as never,
      sessionDir: input.root,
      workspace: { command_execution_enabled: false, isolation: "none" as const },
      workspaceDir: input.root,
    };
  },
  runCancelRegistry: input.runCancelRegistry ?? new RunCancelRegistry(),
  sessionOutputService: {} as never,
  taskStateRuntime: {} as never,
  traceSectionSummaries: false,
  user: { id: USER_ID, email: "preparation@example.test", display_name: "Preparation Test" },
  workspaceId: WORKSPACE_ID,
  workspaceRoot: input.root,
  });
};

const createTestMetadata = (root: string) => {
  const metadata = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    secret_master_key: "preparation-test-secret",
  });
  metadata.users.upsertDevUser({
    id: USER_ID,
    email: "preparation@example.test",
    display_name: "Preparation Test",
    dev_token: "preparation-test-token",
  });
  metadata.workspaces.upsert({ id: "default", owner_user_id: USER_ID, name: "Default", kind: "personal" });
  metadata.workspaces.upsert({ id: WORKSPACE_ID, owner_user_id: USER_ID, name: "Customer", kind: "customer" });
  const secretRef = metadata.secrets.put({
    workspace_id: "default",
    user_id: USER_ID,
    owner_kind: "model-profile",
    owner_id: "preparation-test-model",
    value: { apiKey: "never-used-test-key" },
  });
  metadata.configResources.upsert({
    id: "preparation-test-model",
    workspace_id: "default",
    user_id: USER_ID,
    kind: "model-profile",
    name: "Preparation test model",
    payload: {
      provider: "openai-compatible",
      modelName: "preparation-test-model",
      baseUrl: "https://provider.invalid/v1",
    },
    secret_ref: secretRef,
    default_enabled: true,
    status: "connected",
  });
  metadata.configResources.upsert({
    id: "energy-insight-investigation",
    workspace_id: WORKSPACE_ID,
    user_id: USER_ID,
    kind: "skill",
    name: "energy-insight-investigation",
    description: "Find incremental Overview insights",
    payload: {
      packageFileRefId: "not-used-because-implicit-selection-is-denied",
      userInvocable: true,
      version: "1.0.0",
    },
    default_enabled: true,
    status: "valid",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "preparation-test-model",
    profile_owner_user_id: USER_ID,
    configured_by_user_id: USER_ID,
  });
  metadata.dataSources.create({
    id: DATASOURCE_ID,
    user_id: USER_ID,
    name: "Preparation scoped datasource",
    type: "duckdb",
    config: { database_path: "unused" },
  });
  return metadata;
};

const collectEvents = (agent: DataFoundryAgUiAgent, input: RunAgentInput): Promise<BaseEvent[]> => (
  new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    agent.run(input).subscribe({
      next: (event) => {
        const phase = preparationPhase(event);
        serverSeams.order.push(phase ? `stream:${phase}` : `stream:${event.type}`);
        events.push(event);
      },
      error: reject,
      complete: () => resolve(events),
    });
  })
);

const collectVerifiedEvents = (
  agent: DataFoundryAgUiAgent,
  input: RunAgentInput,
): Promise<BaseEvent[]> => (
  new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    agent.run(input).pipe(verifyEvents()).subscribe({
      next: (event) => events.push(event),
      error: reject,
      complete: () => resolve(events),
    });
  })
);

const assertAgUiClientFirstEvent = (events: readonly BaseEvent[]): void => {
  if (events[0]?.type !== EventType.RUN_STARTED) {
    throw new Error("First event must be 'RUN_STARTED'");
  }
};

const customEventId = (event: BaseEvent): string | undefined => {
  if (event.type !== EventType.CUSTOM || !("value" in event)) return undefined;
  const value = event.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.eventId === "string" ? record.eventId : undefined;
};

const isCustomNamed = (event: BaseEvent, name: string): boolean => (
  event.type === EventType.CUSTOM && "name" in event && event.name === name
);

const seedTitledSession = (
  metadata: ReturnType<typeof createMetadataStore>,
  sessionId: string,
): void => {
  metadata.sessions.create({
    user_id: USER_ID,
    id: sessionId,
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    title: "Preparation test",
    title_source: "user",
  });
};

const energyRunInput = (
  runId: string,
  threadId: string,
  question = "Explain exact energy evidence.",
): RunAgentInput => ({
  runId,
  threadId,
  state: {},
  messages: [{ id: `${runId}:user`, role: "user", content: question }],
  tools: [],
  context: [],
  forwardedProps: {
    energyRunCorrelation: {
      contract: "energyiq-run-correlation@1",
      correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    },
    externalContext: {
      source: "energyiq",
      projectId: PROJECT_ID,
      scopeId: "project",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-01",
      to: "2026-06-30",
      expectedDataSnapshotId: "snapshot-1",
      expectedProjectReleaseId: "release-1",
    },
    run_config: {
      protocol: { id: "general-task", version: "1" },
      activeSkillId: "energy-insight-investigation",
      skillMode: "auto",
      enabledDatasourceIds: [],
      enabledKnowledgeIds: [],
      enabledMcpServerIds: [],
      enabledSkillIds: ["energy-insight-investigation"],
      skillPolicy: {
        allowedToolNames: [],
        deniedToolNames: ["list_data_sources", "preview_table"],
        maxSkills: 1,
        requireUserInvocable: true,
        strictSkillTools: true,
      },
    },
  },
});

const interactionResumeRunInput = (input: {
  interruptRunId: string;
  response: false | { approved: boolean };
  runId: string;
  sessionId: string;
  toolCallId: string;
}): RunAgentInput => {
  const runInput = energyRunInput(input.runId, input.sessionId);
  runInput.forwardedProps = {
    ...runInput.forwardedProps,
    command: {
      interruptEvent: {
        type: "mastra_suspend",
        args: {},
        resumeSchema: {},
        runId: input.interruptRunId,
        suspendPayload: {},
        toolCallId: input.toolCallId,
        toolName: "ask_user",
      },
      resume: input.response,
    },
  };
  return runInput;
};

const exactEnergyContext = () => ({
  userId: USER_ID,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  projectName: "Preparation Project",
  scopeId: "project",
  scopeName: "Preparation Project",
  scopeType: "project",
  resource: "electricity" as const,
  timezone: "Asia/Singapore",
  from: "2026-05-31T16:00:00.000Z",
  to: "2026-06-30T16:00:00.000Z",
  endExclusive: true as const,
  period: "Custom" as const,
  hierarchyRevisionId: "hierarchy-1",
  meterMappingRevisionId: "mapping-1",
  meterFormulaRevisionId: "formula-1",
  dataSnapshotId: "snapshot-1",
  metricVersion: "metrics-1",
  businessCalendarVersion: "calendar-1",
  tariffScheduleVersion: "tariff-1",
  resolvedAt: "2026-07-01T00:00:00.000Z",
});

const persistedEnergyContext = () => {
  const context = exactEnergyContext();
  return {
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    projectName: context.projectName,
    scopeId: context.scopeId,
    scopeName: context.scopeName,
    scopeType: context.scopeType,
    resource: context.resource,
    timezone: context.timezone,
    from: context.from,
    to: context.to,
    hierarchyRevisionId: context.hierarchyRevisionId,
    meterMappingRevisionId: context.meterMappingRevisionId,
    meterFormulaRevisionId: context.meterFormulaRevisionId,
    projectReleaseId: "release-1",
    dataSnapshotId: context.dataSnapshotId,
    forkedFromSessionId: "session-historical",
    forkedFromContextStatus: "available" as const,
    forkedFromRunId: "run-historical",
    forkedFromFrom: "2026-04-30T16:00:00.000Z",
    forkedFromTo: "2026-05-31T16:00:00.000Z",
  };
};

const authoritativeEnergyContextPackage = (energyQueryContext: Record<string, unknown>) => ({
  items: [{
    sourceType: "energy-query-context",
    trust: "tool",
    content: "Server-owned EnergyIQ context",
    metadata: {
      sourceKind: "energy-query-context",
      sourceOwner: "server",
      energyQueryContext,
    },
  }],
});

const historicalEnergyContext = (): Record<string, unknown> => Object.fromEntries(
  Object.entries(persistedEnergyContext())
    .filter(([key]) => !key.startsWith("forkedFrom")),
);

describe("persisted EnergyIQ Session context binding", () => {
  it("accepts only the exact Snapshot, Release, revisions, range, and fork lineage", () => {
    const fork = {
      sourceSessionId: "session-historical",
      sourceRunId: "run-historical",
      sourceFrom: "2026-04-30T16:00:00.000Z",
      sourceTo: "2026-05-31T16:00:00.000Z",
    };
    expect(energyRunMatchesPersistedSessionContext({
      persisted: persistedEnergyContext(),
      resolved: exactEnergyContext(),
      projectReleaseId: "release-1",
      fork,
    })).toBe(true);
    expect(energyRunMatchesPersistedSessionContext({
      persisted: persistedEnergyContext(),
      resolved: { ...exactEnergyContext(), dataSnapshotId: "snapshot-drifted" },
      projectReleaseId: "release-1",
      fork,
    })).toBe(false);
    expect(energyRunMatchesPersistedSessionContext({
      persisted: persistedEnergyContext(),
      resolved: { ...exactEnergyContext(), timezone: "UTC" },
      projectReleaseId: "release-1",
      fork,
    })).toBe(false);
    expect(energyRunMatchesPersistedSessionContext({
      persisted: persistedEnergyContext(),
      resolved: exactEnergyContext(),
      projectReleaseId: "release-2",
      fork,
    })).toBe(false);
    expect(energyRunMatchesPersistedSessionContext({
      persisted: persistedEnergyContext(),
      resolved: exactEnergyContext(),
      projectReleaseId: "release-1",
      fork: { ...fork, sourceRunId: "run-other" },
    })).toBe(false);
  });

  it("accepts exact current execution when persisted continuation lineage is explicitly unavailable", () => {
    const persisted = {
      ...historicalEnergyContext(),
      forkedFromSessionId: "session-contextless",
      forkedFromContextStatus: "unavailable" as const,
      forkedFromUnavailableReason: "source-run-unavailable" as const,
    };
    expect(energyRunMatchesPersistedSessionContext({
      persisted: persisted as Parameters<
        typeof energyRunMatchesPersistedSessionContext
      >[0]["persisted"],
      resolved: exactEnergyContext(),
      projectReleaseId: "release-1",
    })).toBe(true);
  });
});

const energyWorkspace = () => ({
  identity: {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    scopeId: "project",
    resource: "electricity" as const,
    dataSnapshotId: "snapshot-1",
    dataCutoff: "2026-06-30T16:00:00.000Z",
    hierarchyRevisionId: "hierarchy-1",
  },
  scopedDatasource: {
    datasourceId: DATASOURCE_ID,
    revision: 1,
    viewName: "energy_preparation_facts",
    metadataViewName: "energy_preparation_metadata",
    databasePath: "unused",
  },
  scopeDimensions: [],
  semantics: {
    contract: "energyiq-analysis-semantics@1" as const,
    relations: {
      facts: {
        relation: "energy_preparation_facts",
        usageColumn: "usage_kwh",
        qualityStatusColumn: "quality_status",
        officialAggregationColumn: "official_aggregation_eligible",
      },
      scopeMetadata: {
        relation: "energy_preparation_metadata",
        scopeIdColumn: "scope_id",
        scopeTypeColumn: "scope_type",
        facilityTypeColumn: "facility_type",
        metadataStatusColumn: "metadata_status",
        publishedFacilityTypes: [],
      },
    },
    measureAuthorities: [],
  },
});

const projectRelease = () => ({
  id: "release-1",
  projectId: PROJECT_ID,
  source: "legacy-profile" as const,
  templateRevisionId: null,
  templateRevisionSequence: 1,
  reportTimePolicyRevisionId: "report-time-1",
  hierarchyRevisionId: "hierarchy-1",
  meterMappingRevisionId: "mapping-1",
  meterFormulaRevisionId: "formula-1",
  businessCalendarVersion: "calendar-1",
  tariffScheduleVersion: "tariff-1",
  metricRevisionIds: [],
  ruleRevisionIds: [],
  publishedAt: "2026-07-01T00:00:00.000Z",
  recipe: { id: "recipe-1", version: "1" },
  renderer: {
    key: "preschool-overview" as const,
    version: "1" as const,
    contractVersion: "project-analysis-snapshot@1" as const,
  },
  document: {},
});

const analysisContextPackage = () => ({
  resolution: {
    status: "ready" as const,
    snapshot: {
      context: {
        ...exactEnergyContext(),
        primaryPeriod: {
          start: exactEnergyContext().from,
          endExclusive: exactEnergyContext().to,
        },
        projectReleaseId: "release-1",
      },
      projectRelease: projectRelease(),
      recipe: projectRelease().recipe,
      renderer: projectRelease().renderer,
      dataQuality: { status: "complete" as const },
      evidence: [{ id: "evidence:usage", metricId: "energy.total_usage_kwh", queryIds: [] }],
      findings: [],
      dataSnapshot: {
        id: "snapshot-1",
        importBatchIds: [],
        lastSeenAt: null,
      },
      metadata: {
        selectedScope: { status: "confirmed" as const },
      },
      analysis: {
        context: exactEnergyContext(),
        summary: { usageKwh: 0, peakKw: 0 },
        comparison: { usageKwh: 0, changeKwh: 0, changePct: null },
        categories: [],
        childScopes: [],
        topCircuits: [],
        offHours: { status: "unavailable" as const },
        provenance: {
          dataSnapshotId: "snapshot-1",
          hierarchyRevisionId: "hierarchy-1",
          meterMappingRevisionId: "mapping-1",
          meterFormulaRevisionId: "formula-1",
          queryIds: [],
        },
      },
    },
  },
  contextPackage: {
    contract: "energyiq-analysis-context-package@1" as const,
    projectionRef: "sha256:package-hit",
    identity: {},
    snapshot: {},
    evidenceRefs: [],
  },
});

const currentHourlyContextPackage = () => {
  const base = analysisContextPackage();
  return {
    ...base,
    resolution: {
      ...base.resolution,
      snapshot: {
        ...base.resolution.snapshot,
        analysis: {
          ...base.resolution.snapshot.analysis,
          hourlyProfile: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            usageKwh: hour === 8 ? 120 : 40 + hour,
            averageKw: hour === 8 ? 15 : 5,
            peakKw: hour === 8 ? 22 : 5 + hour,
            observationCount: 31,
          })),
          offHours: { status: "available" as const, usageKwh: 120, sharePct: 12.5 },
        },
        preschoolOperational: {
          status: "available",
          standbyAppliances: { appliances: [] },
          operatingAppliances: { appliances: [] },
          sop: { centres: [] },
          evidence: {
            projectReleaseId: "release-1",
            dataSnapshotId: "snapshot-1",
          },
          spikes: {
            standby: {
              count: 4,
              centreCount: 1,
              centres: [{
                scopeId: "centre-l",
                centreCode: "L",
                name: "Centre L",
                spikeCount: 4,
                worstSpike: {
                  localDate: "2026-06-15",
                  localHour: 22,
                  usageKwh: 30.8,
                  baselineKwh: 4.6,
                  impactKwh: 26.2,
                  variancePct: 569.6,
                  leadingCircuitName: "Heater",
                },
              }],
            },
          },
        } as never,
      },
    },
  };
};

const currentOverviewPriorityPackage = () => {
  const base = analysisContextPackage();
  return {
    ...base,
    resolution: {
      ...base.resolution,
      snapshot: {
        ...base.resolution.snapshot,
        preschoolBenchmark: {
          status: "provisional" as const,
          contract: { id: "preschool-may-2026-benchmark" as const, version: "1" as const, annualisationFactor: 12 },
          period: {
            start: "2026-04-30T16:00:00.000Z",
            endExclusive: "2026-05-31T16:00:00.000Z",
            timezone: "Asia/Singapore",
          },
          sampleSize: 3,
          portfolio: {
            eui: { p50: 100, p75: 120, unit: "kWh/m2/year" as const },
            perPax: { p50: 25, p75: 30, unit: "kWh/person/month" as const },
          },
          cohorts: [],
          centres: ["g", "l", "h"].map((code, index) => ({
            scopeId: `centre-${code}`,
            centreCode: code.toUpperCase(),
            name: `Centre ${code.toUpperCase()}`,
            cohort: "Child Care Centre",
            usageKwh: 1000 - index * 10,
            annualisedEuiKwhPerSqmYear: 140 - index * 5,
            mayKwhPerPerson: 35 - index,
            quadrant: "priority" as const,
            priority: true,
          })),
          priorityCentreCodes: ["G", "L", "H"],
          evidence: {
            projectReleaseId: "release-1",
            dataSnapshotId: "snapshot-1",
            hierarchyRevisionId: "hierarchy-1",
            meterMappingRevisionId: "mapping-1",
            metricRevisionIds: [],
            metadataRevisionIds: [],
            sourceQueryIds: [],
            projectionRecipeIds: [
              "preschool-eui-benchmark-v1" as const,
              "preschool-per-pax-benchmark-v1" as const,
              "preschool-quadrant-v1" as const,
            ],
            cohortSource: "published-hierarchy-node-metadata" as const,
            metadataStatus: "provisional" as const,
            normalisation: { eui: "annualised", perPax: "monthly" },
          },
        },
      },
    },
  };
};

const isPreparationEvent = (event: BaseEvent): boolean => (
  event.type === EventType.CUSTOM && event.name === "energy.run.preparation"
);

const isLatencyEvent = (event: BaseEvent): boolean => (
  event.type === EventType.CUSTOM && event.name === "energy.run.latency"
);

const latencyPhase = (event: BaseEvent): string | undefined => {
  if (!isLatencyEvent(event) || typeof event.value !== "object" || event.value === null) return undefined;
  const phase = (event.value as Record<string, unknown>).phase;
  return typeof phase === "string" ? phase : undefined;
};

const preparationPhase = (event: BaseEvent): string | undefined => {
  if (!isPreparationEvent(event) || typeof event.value !== "object" || event.value === null) return undefined;
  const phase = (event.value as Record<string, unknown>).phase;
  return typeof phase === "string" ? phase : undefined;
};

const preparationPackageStatus = (event: BaseEvent | undefined): string | undefined => {
  if (!event || !isPreparationEvent(event) || typeof event.value !== "object" || event.value === null) {
    return undefined;
  }
  const status = (event.value as Record<string, unknown>).package_status;
  return typeof status === "string" ? status : undefined;
};

const eventCorrelationId = (event: BaseEvent): string | undefined => {
  if (event.type !== EventType.CUSTOM || typeof event.value !== "object" || event.value === null) {
    return undefined;
  }
  const correlationId = (event.value as Record<string, unknown>).correlation_id;
  return typeof correlationId === "string" ? correlationId : undefined;
};

const tableCount = (
  metadata: ReturnType<typeof createMetadataStore>,
  table: "conversation_messages" | "model_request_snapshots" | "runs",
): number => {
  const row = metadata.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return typeof row === "object" && row !== null && "count" in row && typeof row.count === "number"
    ? row.count
    : -1;
};
