import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
const period = z.object({ from: day, toExclusive: day }).strict().refine(p => p.from < p.toExclusive);
const id = z.string().min(1).max(160);
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const contractSchema = z.object({
  schemaVersion: z.literal(1), runId: id, workspaceId: id, projectId: id,
  analysisPeriod: period, timezone: id, inputManifestHash: z.string().length(64),
}).strict();
const packageSchema = z.object({
  schemaVersion: z.literal(1), runId: id, workspaceId: id, projectId: id,
  evidence: z.array(z.object({
    id, period, metric: z.string().min(1).max(240), value: z.number().finite(),
    unit: z.string().min(1).max(40), sampleCount: z.number().int().nonnegative(),
    coverage: z.number().min(0).max(1).nullable(),
    calculationPath: id, dataPath: id, valueKey: id, unitKey: id,
    limitations: z.string().max(2000),
  }).strict()),
  findings: z.array(z.object({
    id, subjectIds: z.array(id).min(1), claim: z.string().min(1).max(2000),
    certainty: z.enum(["observed", "hypothesis", "confirmed"]),
    evidenceIds: z.array(id).min(1), explanation: z.string().max(4000),
    openQuestions: z.array(z.string().min(1).max(1000)),
  }).strict()),
}).strict();

/** All source versions and Skill hashes remain in the server-owned input manifest. */
export function writeAnalysisContract(inputDir: string): void {
  const raw = readFileSync(join(inputDir, "manifest.json"));
  const m = JSON.parse(raw.toString());
  const contract = contractSchema.parse({ schemaVersion: 1, runId: m.runId,
    workspaceId: m.workspaceId, projectId: m.projectId, analysisPeriod: m.analysisPeriod,
    timezone: m.timezone, inputManifestHash: digest(raw) });
  writeFileSync(join(inputDir, "analysis-contract.json"), JSON.stringify(contract, null, 2));
}

function artifact(root: string, relative: string, limit = 4 * 1024 * 1024): Buffer {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(relative) || relative.split("/").some(x => !x || x === "." || x === ".."))
    throw new Error("REPORT_ANALYSIS_PATH_INVALID");
  const base = realpathSync(root), target = resolve(base, relative);
  if (!target.startsWith(base + sep)) throw new Error("REPORT_ANALYSIS_PATH_INVALID");
  let cursor = base;
  for (const part of relative.split("/")) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("REPORT_ANALYSIS_PATH_INVALID");
  }
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.size > limit) throw new Error("REPORT_ANALYSIS_ARTIFACT_INVALID");
  return readFileSync(target);
}

/** Structural/source integrity only; the independent report reviewer still verifies reasoning and arithmetic. */
function readAnalysisPackage(directory: string) {
  const inputs = join(directory, "inputs"), outputs = join(directory, "outputs");
  if (!existsSync(join(inputs, "analysis-contract.json"))) return undefined; // Historical/legacy runs.
  const contract = contractSchema.parse(JSON.parse(artifact(inputs, "analysis-contract.json").toString()));
  const manifestBytes = artifact(inputs, "manifest.json");
  if (digest(manifestBytes) !== contract.inputManifestHash) throw new Error("REPORT_ANALYSIS_INPUT_CHANGED");
  const manifest = JSON.parse(manifestBytes.toString());
  const raw = artifact(outputs, "analysis-findings.json");
  const data = packageSchema.parse(JSON.parse(raw.toString()));
  for (const key of ["runId", "workspaceId", "projectId"] as const)
    if (data[key] !== contract[key]) throw new Error("REPORT_ANALYSIS_IDENTITY_MISMATCH");
  const brief = artifact(outputs, "analysis-brief.md");
  if (!brief.toString().trim()) throw new Error("REPORT_ANALYSIS_BRIEF_EMPTY");
  const hashes: Record<string, string> = { "analysis-findings.json": digest(raw), "analysis-brief.md": digest(brief) };
  const evidenceIds = new Set<string>(), findingIds = new Set<string>();
  const subjects = new Set<string>([contract.projectId, ...(manifest.hierarchy ?? []).map((x: {id: string}) => x.id),
    ...(manifest.meterAttachments ?? []).map((x: {meterPointId: string}) => x.meterPointId)]);
  for (const e of data.evidence) {
    if (evidenceIds.has(e.id)) throw new Error("REPORT_ANALYSIS_DUPLICATE_ID");
    evidenceIds.add(e.id);
    if (e.period.from < contract.analysisPeriod.from || e.period.toExclusive > contract.analysisPeriod.toExclusive)
      throw new Error("REPORT_ANALYSIS_WINDOW_INVALID");
    for (const path of [e.calculationPath, e.dataPath]) {
      if (!path.startsWith("evidence/")) throw new Error("REPORT_ANALYSIS_PATH_INVALID");
      hashes[path] = digest(artifact(outputs, path));
    }
    const values = JSON.parse(artifact(outputs, e.dataPath).toString());
    if (!Object.hasOwn(values, e.valueKey) || !Object.hasOwn(values, e.unitKey) || values[e.valueKey] !== e.value || values[e.unitKey] !== e.unit)
      throw new Error("REPORT_ANALYSIS_METRIC_MISMATCH");
  }
  for (const f of data.findings) {
    if (findingIds.has(f.id)) throw new Error("REPORT_ANALYSIS_DUPLICATE_ID");
    findingIds.add(f.id);
    if (f.evidenceIds.some(x => !evidenceIds.has(x))) throw new Error("REPORT_ANALYSIS_REFERENCE_INVALID");
    if (f.subjectIds.some(x => !subjects.has(x))) throw new Error("REPORT_ANALYSIS_SUBJECT_INVALID");
    // Confirmation requires a separate authorized fact source; v1 only admits observations/hypotheses.
    if (f.certainty === "confirmed") throw new Error("REPORT_ANALYSIS_CONFIRMATION_SOURCE_REQUIRED");
  }
  return { schemaVersion: 1, status: "source_integrity_checked", contract, manifest, artifacts: hashes, findings: data.findings, evidence: data.evidence };
}

export function validateAnalysisPackage(directory: string) {
  try { return readAnalysisPackage(directory); }
  catch (error) {
    if (error instanceof Error && /^REPORT_ANALYSIS_[A-Z_]+$/.test(error.message)) throw error;
    throw new Error("REPORT_ANALYSIS_INVALID");
  }
}

export function acceptAnalysisPackage(directory: string): void {
  const value = validateAnalysisPackage(directory);
  if (!value) return;
  const reportHash = digest(artifact(join(directory, "outputs"), "report.html", 16 * 1024 * 1024));
  const path = join(directory, "accepted-analysis.json"), text = JSON.stringify({ ...value, reportHash }, null, 2);
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== text) throw new Error("REPORT_ANALYSIS_ACCEPTED_VERSION_CHANGED");
    return;
  }
  writeFileSync(path, text, { flag: "wx" });
}

export const ANALYSIS_PACKAGE_INSTRUCTIONS = `If /workspace/inputs/analysis-contract.json exists and you deliver a full project report, read it before analysis. Deliver /workspace/outputs/analysis-brief.md and /workspace/outputs/analysis-findings.json before composing HTML. The JSON uses schemaVersion:1 and the contract's runId/workspaceId/projectId, evidence:[], findings:[]. Each evidence has id, period:{from,toExclusive}, metric, numeric value, unit, sampleCount, coverage (0..1 or null), limitations, calculationPath and dataPath under evidence/, and valueKey/unitKey naming top-level fields in that JSON data file. Copy reproducible calculation scripts and chart data into /workspace/outputs/evidence/. Evidence paths in JSON are relative to /workspace/outputs/. Each finding has id, subjectIds (published scope or meter IDs, or projectId), claim, certainty (observed or hypothesis), evidenceIds, explanation and openQuestions. Preserve all useful supported findings, including normal operation, school-calendar differences and unknown causes; finding count is independent of home-page selection. Findings need no action or quantified saving. Classify and prioritize actionable recommendations afterwards. Compose the report from the full brief and evidence. Review calculations and report claims against these same artifacts; revise them together when evidence changes. Use separate evidence records for separate calculation windows within the supplied analysis period. Derive sampleCount from the calculation, explicitly state its sample unit and eligibility in limitations, and save that count in the evidence data file. Compute coverage for that evidence window and cohort, not an unrelated full-history window; use null with an explanation when it cannot be established. This contract checks references and values, not whether a causal explanation is true.`;
