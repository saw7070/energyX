import type { FileAssetService } from "@datafoundry/files";
import {
  loadMaterializedSkillInstructions,
  materializeSkillPackages,
  parseSkillPackage,
} from "@datafoundry/skills";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildUploadedSkillMaterializationRecord } from "./config-api.js";

const roots: string[] = [];
const skillPackage = Buffer.from([
  "---",
  "name: user-analysis",
  "description: User-scoped governed analysis.",
  "version: 1.0.0",
  "allowed-tools: []",
  "---",
  "# User Analysis",
  "Use the exact user-owned package.",
  "",
].join("\n"), "utf8");

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true }));
});

describe("uploaded Skill scope identity", () => {
  it("keeps a user-scoped upload exact through materialize and actual load", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "user-skill-upload-"));
    roots.push(runDir);
    const parsed = await parseSkillPackage({
      content: skillPackage,
      filename: "SKILL.md",
      mimeType: "text/markdown",
    });
    const skill = buildUploadedSkillMaterializationRecord({
      fields: { scope: "user" },
      packageFileRefId: "user-skill-package-ref",
      parsed,
      userId: "analyst-1",
      workspaceId: "workspace-1",
    });
    const fileAssetService = {
      readRef: ({ id, user_id, workspace_id }) => {
        if (id !== "user-skill-package-ref"
          || user_id !== "analyst-1"
          || workspace_id !== "workspace-1") {
          throw new Error("FILE_ASSET_REF_NOT_FOUND");
        }
        return { body: skillPackage, mimeType: "text/markdown" };
      },
    } as FileAssetService;

    const materializedSkills = await materializeSkillPackages({
      fileAssetService,
      runDir,
      skills: [skill],
      userId: "analyst-1",
      workspaceId: "workspace-1",
    });

    expect(loadMaterializedSkillInstructions({
      materializedSkills,
      runDir,
      selectedSkills: [skill],
      userId: "analyst-1",
      workspaceId: "workspace-1",
    })).toEqual([
      expect.objectContaining({
        id: "user-analysis",
        owner: {
          scope: "user",
          userId: "analyst-1",
          workspaceId: "workspace-1",
        },
      }),
    ]);
  });
});
