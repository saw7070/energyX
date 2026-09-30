import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSkillPackage } from "./index.js";

describe("builtin energy-insight-investigation Method Skill", () => {
  it("is one valid SKILL.md with an open discovery method and no fixed finding quota", async () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), "../builtin/energy-insight-investigation/SKILL.md");
    const content = readFileSync(path);
    const parsed = await parseSkillPackage({
      content,
      filename: "SKILL.md",
      mimeType: "text/markdown",
    });
    const text = content.toString("utf8");

    expect(parsed).toMatchObject({
      name: "energy-insight-investigation",
      version: "1.0.0",
      allowedTools: ["inspect_schema", "run_sql_readonly"],
      packageFormat: "skill-md",
      manifest: { entry: "SKILL.md", files: ["SKILL.md"] },
    });
    expect(text).toContain("optional patterns, not a checklist");
    expect(text).toContain("Zero candidates is valid");
    expect(text).toContain("No visual is a valid choice");
    expect(text).not.toMatch(/exactly\s+\d+|at most\s+\d+\s+findings/iu);
  });
});
