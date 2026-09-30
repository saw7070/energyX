import type { FileAssetService } from "@datafoundry/files";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadMaterializedSkillInstructions,
  materializeSkillPackages,
  parseSkillPackage,
  type SkillRecord,
} from "./index.js";

const roots: string[] = [];
const SKILL_CONTENT = [
  "---",
  "name: data-analysis",
  "description: Governed analysis.",
  "version: 1.0.0",
  "allowed-tools:",
  "  - inspect_schema",
  "---",
  "# Data Analysis",
  "Inspect before querying.",
  "",
].join("\n");
const CONTENT_SHA256 = "sha256:ab4da52116de4d1dba246ed552ba0c93eab07e9e68ef39d6ad0e9adfc6222b5a";

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true }));
});

describe("governed Skill content loading", () => {
  it("loads exact materialized data-analysis instructions with immutable identity evidence", () => {
    const { runDir } = createPackage("data-analysis-load-", "SKILL.md");

    expect(loadMaterializedSkillInstructions({
      materializedSkills: [materializedSkill("skills/data-analysis")],
      runDir,
      selectedSkills: [dataAnalysisSkill()],
      userId: "analyst-1",
      workspaceId: "workspace-1",
    })).toEqual([expect.objectContaining({
      configRevision: 7,
      contentSha256: CONTENT_SHA256,
      id: "data-analysis",
      instructions: "# Data Analysis\nInspect before querying.",
      packageRef: "file-ref-data-analysis-v1",
      semanticVersion: "1.0.0",
    })]);
  });

  it("fails closed on owner or content mismatch", () => {
    const { runDir } = createPackage("data-analysis-mismatch-", "SKILL.md");
    expect(() => loadMaterializedSkillInstructions({
      materializedSkills: [materializedSkill("skills/data-analysis")],
      runDir,
      selectedSkills: [dataAnalysisSkill()],
      userId: "analyst-1",
      workspaceId: "workspace-other",
    })).toThrow("SKILL_LOAD_OWNER_MISMATCH:data-analysis");

    expect(() => loadMaterializedSkillInstructions({
      materializedSkills: [{
        ...materializedSkill("skills/data-analysis"),
        contentSha256: `sha256:${"b".repeat(64)}`,
      }],
      runDir,
      selectedSkills: [dataAnalysisSkill()],
      userId: "analyst-1",
      workspaceId: "workspace-1",
    })).toThrow("SKILL_LOAD_MATERIALIZATION_CONTENT_MISMATCH:data-analysis");
  });

  it("reads the exact governed package entry instead of assuming a root SKILL.md", () => {
    const { runDir } = createPackage("data-analysis-entry-", "governed/SKILL.md");
    const selectedSkill = dataAnalysisSkill();
    selectedSkill.packageEntry = "governed/SKILL.md";
    selectedSkill.packageFiles = ["governed/SKILL.md"];

    expect(loadMaterializedSkillInstructions({
      materializedSkills: [materializedSkill("skills/data-analysis")],
      runDir,
      selectedSkills: [selectedSkill],
      userId: "analyst-1",
      workspaceId: "workspace-1",
    })[0]?.instructions).toContain("Inspect before querying.");
  });

  it("parses, materializes, and loads a nested ZIP entry without leaking the cache path", async () => {
    const packageBody = storedZip([{ name: "governed/SKILL.md", content: Buffer.from(SKILL_CONTENT) }]);
    const parsed = await parseSkillPackage({ content: packageBody, filename: "data-analysis.zip" });
    const runDir = mkdtempSync(join(tmpdir(), "data-analysis-nested-zip-"));
    roots.push(runDir);
    const selectedSkill = dataAnalysisSkill();
    selectedSkill.packageEntry = parsed.manifest.entry;
    selectedSkill.packageFiles = parsed.manifest.files;
    selectedSkill.packageFormat = "zip";
    const fileAssetService = {
      readRef: () => ({ body: packageBody, mimeType: "application/zip" }),
    } as unknown as FileAssetService;

    const materialized = await materializeSkillPackages({
      fileAssetService,
      runDir,
      skills: [selectedSkill],
      userId: "analyst-1",
      workspaceId: "workspace-1",
    });

    expect(loadMaterializedSkillInstructions({
      materializedSkills: materialized,
      runDir,
      selectedSkills: [selectedSkill],
      userId: "analyst-1",
      workspaceId: "workspace-1",
    })[0]?.instructions).toContain("Inspect before querying.");
  });

  it("returns a stable path-free code when the exact materialized entry is missing", () => {
    const { runDir } = createPackage("data-analysis-entry-missing-", "SKILL.md");
    const selectedSkill = dataAnalysisSkill();
    selectedSkill.packageEntry = "missing/SKILL.md";
    let thrown: unknown;
    try {
      loadMaterializedSkillInstructions({
        materializedSkills: [materializedSkill("skills/data-analysis")],
        runDir,
        selectedSkills: [selectedSkill],
        userId: "analyst-1",
        workspaceId: "workspace-1",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(new Error("SKILL_LOAD_ENTRY_UNAVAILABLE:data-analysis"));
    expect(String(thrown)).not.toContain(runDir);
  });

  it("fails closed before model assembly when the actual-load context ceiling is exceeded", () => {
    const oversized = `${SKILL_CONTENT}${"x".repeat(256 * 1024)}`;
    const { runDir } = createPackage("data-analysis-context-ceiling-", "SKILL.md", oversized);
    expect(() => loadMaterializedSkillInstructions({
      materializedSkills: [{
        ...materializedSkill("skills/data-analysis"),
        contentSha256: `sha256:${createHash("sha256").update(oversized).digest("hex")}`,
      }],
      runDir,
      selectedSkills: [dataAnalysisSkill()],
      userId: "analyst-1",
      workspaceId: "workspace-1",
    })).toThrow("SKILL_LOAD_CONTEXT_BUDGET_EXCEEDED:data-analysis");
  });
});

const createPackage = (prefix: string, entry: string, content = SKILL_CONTENT) => {
  const runDir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(runDir);
  const entryPath = join(runDir, "skills", "data-analysis", entry);
  mkdirSync(join(entryPath, ".."), { recursive: true });
  writeFileSync(entryPath, content, "utf8");
  return { runDir };
};

const materializedSkill = (path: string) => ({
  configRevision: 7,
  contentSha256: CONTENT_SHA256,
  id: "data-analysis",
  name: "data-analysis",
  packageRef: "file-ref-data-analysis-v1",
  path,
});

const storedZip = (entries: Array<{ content: Buffer; name: string }>): Buffer => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  entries.forEach(({ content, name }) => {
    const fileName = Buffer.from(name, "utf8");
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    localParts.push(local, fileName, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, fileName);
    offset += local.length + fileName.length + content.length;
  });
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
};

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dataAnalysisSkill = (): SkillRecord => ({
  allowedTools: ["inspect_schema"],
  builtin: false,
  defaultDbIds: [],
  defaultEnabled: true,
  defaultKbIds: [],
  defaultMcpIds: [],
  deniedTools: [],
  description: "Governed analysis.",
  id: "data-analysis",
  name: "data-analysis",
  owner: { scope: "workspace", userId: "analyst-1", workspaceId: "workspace-1" },
  packageEntry: "SKILL.md",
  packageFileRefId: "file-ref-data-analysis-v1",
  packageFiles: ["SKILL.md"],
  packageFormat: "skill-md",
  revision: 7,
  scope: "workspace",
  status: "valid",
  tags: ["data"],
  userInvocable: true,
  version: "1.0.0",
});
