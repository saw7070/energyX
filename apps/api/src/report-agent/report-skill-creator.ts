import { readFileSync } from "node:fs";

/** Product method shared by the runtime and the Skills library. */
export const REPORT_SKILL_CREATOR_METHOD = readFileSync(new URL("../../../../packages/skills/builtin/report-skill-creator/SKILL.md", import.meta.url), "utf8");
