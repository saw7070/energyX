import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { selectSkillsForRun } from "./index.js";

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true }));
});

describe("data-analysis governed selection", () => {
  it("selects only the exact eligible owner and revision while disabled, stale, and missing packages fail closed", () => {
    const { metadataStore, root } = createHarness();
    roots.push(root);
    try {
      const exact = upsertSkill(metadataStore, {
        id: "data-analysis",
        userId: "analyst-1",
        workspaceId: "workspace-1",
      });
      upsertSkill(metadataStore, {
        id: "data-analysis",
        packageRef: "wrong-workspace",
        userId: "analyst-1",
        workspaceId: "workspace-other",
      });
      upsertSkill(metadataStore, {
        id: "data-analysis",
        packageRef: "wrong-user",
        userId: "analyst-other",
        workspaceId: "workspace-1",
      });
      upsertSkill(metadataStore, {
        id: "disabled-skill",
        status: "disabled",
        userId: "analyst-1",
        workspaceId: "workspace-1",
      });
      upsertSkill(metadataStore, {
        id: "stale-skill",
        status: "stale",
        userId: "analyst-1",
        workspaceId: "workspace-1",
      });
      upsertSkill(metadataStore, {
        id: "missing-package",
        packageRef: null,
        userId: "analyst-1",
        workspaceId: "workspace-1",
      });

      const result = selectSkillsForRun({
        metadataStore,
        runConfig: runConfig(["data-analysis", "disabled-skill", "stale-skill", "missing-package"]),
        userId: "analyst-1",
        userInput: "analyze this dataset",
        workspaceId: "workspace-1",
      });

      expect(result.selectedSkills).toEqual([expect.objectContaining({
        id: "data-analysis",
        owner: { scope: "workspace", userId: "analyst-1", workspaceId: "workspace-1" },
        packageFileRefId: "package-data-analysis",
        revision: exact.revision,
      })]);
      expect(result.audit).toEqual(expect.arrayContaining([
        expect.objectContaining({ decision: "rejected", reasons: ["status:disabled"], skillId: "disabled-skill" }),
        expect.objectContaining({ decision: "rejected", reasons: ["status:stale"], skillId: "stale-skill" }),
        expect.objectContaining({ decision: "rejected", reasons: ["package:missing-file-ref"], skillId: "missing-package" }),
      ]));
      expect(JSON.stringify(result)).not.toContain("wrong-workspace");
      expect(JSON.stringify(result)).not.toContain("wrong-user");
    } finally {
      metadataStore.close();
    }
  });

  it("preserves an explicit empty strict intersection", () => {
    const { metadataStore, root } = createHarness();
    roots.push(root);
    try {
      upsertSkill(metadataStore, {
        allowedTools: ["inspect_schema"],
        id: "data-analysis",
        userId: "analyst-1",
        workspaceId: "workspace-1",
      });
      const result = selectSkillsForRun({
        metadataStore,
        runConfig: {
          ...runConfig(["data-analysis"]),
          skillPolicy: {
            allowedToolNames: ["server-only-tool"],
            deniedToolNames: [],
            maxSkills: 1,
            requireUserInvocable: true,
            strictSkillTools: true,
          },
        },
        userId: "analyst-1",
        userInput: "use only governed capability",
        workspaceId: "workspace-1",
      });

      expect(result.effectiveToolPolicy.allowedTools).toEqual([]);
    } finally {
      metadataStore.close();
    }
  });
});

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "data-analysis-selection-"));
  const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  for (const [id, email] of [
    ["analyst-1", "one@example.test"],
    ["analyst-other", "other@example.test"],
  ] as const) {
    metadataStore.users.upsertDevUser({ id, email, display_name: id, dev_token: `${id}-token` });
  }
  metadataStore.workspaces.upsert({
    id: "workspace-1",
    owner_user_id: "analyst-1",
    name: "One",
    kind: "customer",
  });
  metadataStore.workspaces.upsert({
    id: "workspace-other",
    owner_user_id: "analyst-1",
    name: "Other",
    kind: "customer",
  });
  return { metadataStore, root };
};

const upsertSkill = (
  metadataStore: ReturnType<typeof createMetadataStore>,
  input: {
    allowedTools?: string[];
    id: string;
    packageRef?: string | null;
    status?: string;
    userId: string;
    workspaceId: string;
  },
) => metadataStore.configResources.upsert({
  id: input.id,
  workspace_id: input.workspaceId,
  user_id: input.userId,
  kind: "skill",
  name: input.id,
  payload: {
    allowedTools: input.allowedTools ?? ["inspect_schema"],
    description: "Governed data analysis.",
    name: input.id,
    ...(input.packageRef === null ? {} : { packageFileRefId: input.packageRef ?? `package-${input.id}` }),
    packageEntry: "SKILL.md",
    packageFiles: ["SKILL.md"],
    packageFormat: "skill-md",
    scope: "workspace",
    userInvocable: true,
    version: "1.0.0",
  },
  status: input.status ?? "valid",
});

const runConfig = (skillIds: string[]) => ({
  ...(skillIds[0] ? { activeSkillId: skillIds[0] } : {}),
  enabledSkillIds: skillIds,
  skillIds,
  skillMode: "selected" as const,
  skillPolicy: {
    deniedToolNames: [],
    maxSkills: 10,
    requireUserInvocable: true,
    strictSkillTools: true,
  },
  skillTags: [],
});
