import {
  createCustomEvent,
  InMemoryProtocolStateStore,
} from "@datafoundry/agent-runtime";
import type { FileAssetService } from "@datafoundry/files";
import { createMetadataStore, RunEventWriter } from "@datafoundry/metadata";
import type { SkillRecord, SkillSelectionResult } from "@datafoundry/skills";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy/energy-bootstrap.js";
import { createProjectAiOperationsReader } from "./energy/project-ai-operations.js";
import { createRunAgentAssembly } from "./run-agent-assembly.js";
import { emitRunSkillEvidenceAuditEvents } from "./run-config-audit.js";

const BUILTIN_CONTENT = readFileSync(join(
  process.cwd(),
  "packages",
  "skills",
  "builtin",
  "data-analysis",
  "SKILL.md",
));

describe("Issue #114 actual-loaded data-analysis vertical", () => {
  it("persists one idempotent exact event chain from the real builtin reader and projects it historically", async () => {
    const root = mkdtempSync(join(tmpdir(), "data-analysis-actual-load-vertical-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    let assembly: Awaited<ReturnType<typeof createRunAgentAssembly>> | undefined;
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      metadata.sessions.create({
        id: "session-actual-load",
        user_id: user.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadata.runs.create({
        id: "run-actual-load",
        user_id: user.id,
        session_id: "session-actual-load",
        user_input: "Analyze the governed data.",
      });
      const selectedSkill = dataAnalysisSkill(user.id);
      assembly = await createAssembly({ root, selectedSkills: [selectedSkill] });
      expect(assembly.loadedSkills).toEqual([expect.objectContaining({
        id: "data-analysis",
        instructions: expect.stringContaining("# Data Analysis"),
      })]);

      const writer = new RunEventWriter(metadata.runEvents);
      const emit = (event: ReturnType<typeof createCustomEvent>): void => {
        writer.write({
          user_id: user.id,
          run_id: "run-actual-load",
          session_id: "session-actual-load",
          event,
        });
      };
      emit(createCustomEvent("run.config.resolved", {
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        resource_revisions: { "skill:data-analysis": 7 },
      }));
      emit(createCustomEvent("skill.selection", {
        selected: [{ id: "data-analysis", name: "data-analysis", revision: 7 }],
        audit: [{ skillId: "data-analysis", decision: "selected" }],
      }));
      emitRunSkillEvidenceAuditEvents({
        emit,
        loadedSkills: assembly.loadedSkills,
        materializedSkills: assembly.materializedSkills,
        runId: "run-actual-load",
      });
      emitRunSkillEvidenceAuditEvents({
        emit,
        loadedSkills: assembly.loadedSkills,
        materializedSkills: assembly.materializedSkills,
        runId: "run-actual-load",
      });

      const events = writer.replay({ user_id: user.id, run_id: "run-actual-load" })
        .map(({ event }) => event as unknown as Record<string, unknown>);
      expect(events.filter((event) => event.name === "skill.materialized")).toHaveLength(1);
      expect(events.filter((event) => event.name === "skill.loaded")).toHaveLength(1);

      const detail = createProjectAiOperationsReader({
        metadataStore: metadata,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      }).readProjectAiOperations("preschool-demo", {
        actorId: user.id,
        runId: "run-actual-load",
      }).selectedRun;
      expect(detail?.historicalConfiguration.loadedSkills).toMatchObject({
        status: "available",
        items: [expect.objectContaining({
          evidenceStatus: "available",
          id: "data-analysis",
          revision: 7,
        })],
      });
    } finally {
      await assembly?.destroyWorkspace();
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps an ordinary Run actual-load default off", async () => {
    const root = mkdtempSync(join(tmpdir(), "data-analysis-default-off-"));
    const readRef = vi.fn();
    const assembly = await createAssembly({ root, selectedSkills: [], readRef });
    try {
      expect(assembly.materializedSkills).toEqual([]);
      expect(assembly.loadedSkills).toEqual([]);
      expect(readRef).not.toHaveBeenCalled();
    } finally {
      await assembly.destroyWorkspace();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const createAssembly = async (input: {
  readRef?: ReturnType<typeof vi.fn>;
  root: string;
  selectedSkills: SkillRecord[];
}) => {
  const assembly = await createRunAgentAssembly({
  analysisRequirementsMode: "omit",
  artifactService: {} as never,
  contextPackageExists: () => true,
  dataGateway: {} as never,
  disableTools: true,
  effectiveRunConfig: {
    enabledDatasourceIds: [],
    fileIds: [],
    enabledKnowledgeIds: [],
    enabledMcpServerIds: [],
    enabledSkillIds: input.selectedSkills.map(({ id }) => id),
    skillIds: input.selectedSkills.map(({ id }) => id),
    skillMode: input.selectedSkills.length > 0 ? "selected" : "none",
    skillPolicy: {
      deniedToolNames: [],
      maxSkills: 1,
      requireUserInvocable: true,
      strictSkillTools: true,
    },
    skillTags: [],
    evidenceRefs: [],
    protocol: { protocolId: "data-analysis", protocolVersion: "1" },
    resourceRevisions: input.selectedSkills.length > 0 ? { "skill:data-analysis": 7 } : {},
  },
  emitter: { emit: () => undefined },
  fileAssetService: {
    readRef: input.readRef ?? (() => ({ body: BUILTIN_CONTENT, mimeType: "text/markdown" })),
  } as unknown as FileAssetService,
  knowledgeService: {} as never,
  longTermMemories: [],
  mcpRuntime: { servers: [], toolNames: [], toolNamesByServerId: {} },
  messages: [],
  modelProvider: {
    kind: "openai-compatible",
    model: "openai/test-model",
    model_name: "test-model",
    provider_id: "openai-compatible",
  },
  protocolStateStore: new InMemoryProtocolStateStore(),
  runContext: {
    user_id: "dev-user",
    workspace_id: PRESCHOOL_WORKSPACE_ID,
    session_id: "session-actual-load",
    run_id: "run-actual-load",
    user_input: "Analyze the governed data.",
    chat_mode: "copilotkit",
    model_name: "test-model",
  },
  selectedSkills: input.selectedSkills,
  sessionOutputService: {} as never,
  skillSelection: selection(input.selectedSkills),
  userId: "dev-user",
  workspaceId: PRESCHOOL_WORKSPACE_ID,
  workspaceRoot: input.root,
  });
  return assembly;
};

const selection = (skills: SkillRecord[]): SkillSelectionResult => ({
  audit: skills.map((skill) => ({ decision: "selected", reasons: ["explicit:id"], skillId: skill.id })),
  effectiveToolPolicy: { allowedTools: [], deniedTools: [], mergeStrategy: "intersection" },
  selectedSkills: skills,
});

const dataAnalysisSkill = (userId: string): SkillRecord => ({
  allowedTools: [],
  builtin: true,
  defaultDbIds: [],
  defaultEnabled: false,
  defaultKbIds: [],
  defaultMcpIds: [],
  deniedTools: [],
  description: "Governed data analysis.",
  id: "data-analysis",
  name: "data-analysis",
  owner: { scope: "builtin", userId, workspaceId: PRESCHOOL_WORKSPACE_ID },
  packageEntry: "SKILL.md",
  packageFileRefId: "file-ref-data-analysis-v1",
  packageFiles: ["SKILL.md"],
  packageFormat: "skill-md",
  revision: 7,
  scope: "builtin",
  status: "valid",
  tags: ["data", "analysis"],
  userInvocable: true,
  version: "1.0.0",
});
