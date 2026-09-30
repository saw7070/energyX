import { readFileSync } from "node:fs";

export const REPORT_PRESENTATION_METHOD = readFileSync(new URL("../../../../packages/skills/builtin/report-presentation/SKILL.md", import.meta.url), "utf8");
