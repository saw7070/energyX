import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";

const storageRoot = process.env.STORAGE_ROOT_DIR;
assert(storageRoot, "STORAGE_ROOT_DIR must name the explicitly approved Analyst smoke fixture");
assert.equal(
  process.env.ENERGYIQ_ANALYST_SMOKE_ALLOW_WRITES,
  "true",
  "Set ENERGYIQ_ANALYST_SMOKE_ALLOW_WRITES=true only after confirming no other API writer uses this fixture",
);

// This smoke runs only while the formal API listener is stopped. It uses the
// same production build and stores, but switches HTTP authentication to the
// local dev identity so CI/agents never need a human password.
process.env.DATAFOUNDRY_AUTH_MODE = "dev";

const { createServer } = await import("../apps/api/dist/server.js");
const server = await createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
const stamp = Date.now();
const runId = `energyiq-analysis-workspace-smoke-${stamp}`;
const queryContextRequest = {
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  resource: "electricity",
  period: "Custom",
  from: "2026-05-01",
  to: "2026-05-31",
};

try {
  const analysisResponse = await fetch(`${baseUrl}/api/v1/energy/analysis/resolve`, {
    method: "POST",
    headers: {
      Authorization: "Bearer dev-token",
      "Content-Type": "application/json",
      "X-Workspace-Id": "preschool-demo-org",
    },
    body: JSON.stringify(queryContextRequest),
  });
  const analysisPayload = await analysisResponse.json();
  assert.equal(analysisResponse.ok, true, `Analysis HTTP failure (${analysisResponse.status})`);
  assert.equal(analysisPayload.success, true, JSON.stringify(analysisPayload));
  assert.equal(analysisPayload.data?.status, "ready", JSON.stringify(analysisPayload));
  const { createProjectAnalysisSnapshotContextItem } = await import(
    "../apps/api/dist/energy/energy-context-item.js"
  );
  const deterministicContext = createProjectAnalysisSnapshotContextItem({
    snapshot: analysisPayload.data.snapshot,
    sessionId: `energyiq-analysis-workspace-thread-${stamp}`,
    userId: "dev-user",
  });
  const deterministicContextBytes = Buffer.byteLength(deterministicContext.content, "utf8");
  assert.ok(
    deterministicContextBytes < 50_000,
    `Deterministic context is no longer bounded: ${deterministicContextBytes} bytes`,
  );

  const response = await fetch(`${baseUrl}/api/copilotkit`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      Authorization: "Bearer dev-token",
      "Content-Type": "application/json",
      "X-Workspace-Id": "preschool-demo-org",
    },
    body: JSON.stringify({
      method: "agent/run",
      params: { agentId: "dataFoundry" },
      body: {
        threadId: `energyiq-analysis-workspace-thread-${stamp}`,
        runId,
        state: {},
        messages: [{
          id: `${runId}:user`,
          role: "user",
          content: "有几个 Active Aging Center？请用当前 Published Metadata 验证后回答数量和依据，不要从电表名称猜测。",
        }],
        tools: [],
        context: [],
        forwardedProps: {
          externalContext: {
            source: "energyiq",
            ...queryContextRequest,
          },
          run_config: {
            protocol: { id: "data-analysis", version: "1" },
            activeSkillId: "data-analysis",
            enabledDatasourceIds: [],
            enabledKnowledgeIds: [],
            enabledMcpServerIds: [],
            enabledSkillIds: ["data-analysis"],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const body = await response.text();
  assert.equal(response.ok, true, `Agent HTTP failure (${response.status}): ${body}`);
  const events = parseEventStream(body);
  const runError = events.findLast((event) => event.type === "RUN_ERROR");
  assert.equal(runError, undefined, `Unexpected RUN_ERROR: ${JSON.stringify(runError)}`);
  assert.equal(events.findLast((event) => event.type === "RUN_FINISHED")?.type, "RUN_FINISHED");

  const toolNames = events
    .filter((event) => event.type === "TOOL_CALL_START")
    .map((event) => event.toolCallName)
    .filter(Boolean);
  assert.ok(toolNames.includes("inspect_schema"), `inspect_schema missing: ${JSON.stringify(toolNames)}`);
  assert.ok(toolNames.includes("run_sql_readonly"), `run_sql_readonly missing: ${JSON.stringify(toolNames)}`);
  const evidenceText = JSON.stringify(events.filter((event) =>
    event.type === "TOOL_CALL_START" || event.type === "TOOL_CALL_RESULT"));
  assert.match(evidenceText, /facility_type/iu, "Published facility_type was absent from tool Evidence");
  assert.match(evidenceText, /_metadata/iu, "The scoped Metadata relation was absent from tool Evidence");
  assert.doesNotMatch(evidenceText, /adapter_missing/iu,
    "A production Analyst tool observation still lacks a Context adapter");

  const answer = events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string")
    .map((event) => event.delta)
    .join("")
    .trim();
  assert.match(answer, /(^|\D)8(\D|$)/u, `Expected Active Aging Center count 8: ${answer}`);
  assert.doesNotMatch(answer, /adapter_missing/iu, `Internal adapter details leaked into the answer: ${answer}`);
  assert.doesNotMatch(answer, /(?:数量|count|共有|总共)[^。\n]{0,20}(?:为|是|:|：)?\s*0\b/iu,
    `Missing Metadata must not become a zero business count: ${answer}`);
  const traceSection = await waitForCompletedTraceSection(runId);

  console.log(JSON.stringify({
    status: "passed",
    runId,
    tools: [...new Set(toolNames)],
    deterministicContextBytes,
    traceSection,
    answer,
  }, null, 2));
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    setImmediate(() => server.closeAllConnections?.());
  });
}

async function waitForCompletedTraceSection(runId) {
  const databasePath = resolve(process.env.METADATA_DB_PATH
    ?? join(storageRoot, "metadata", "workbench.sqlite"));
  const deadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < deadline) {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const section = database.prepare(`
      SELECT status, start_event_seq AS startEventSeq, end_event_seq AS endEventSeq, title
      FROM trace_sections
      WHERE run_id = ?
      ORDER BY end_event_seq DESC
      LIMIT 1
    `).get(runId);
    database.close();
    if (section?.status === "completed") return section;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`TraceSection did not finish before shutdown: ${runId}`);
}

function parseEventStream(text) {
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((chunk) => chunk !== "[DONE]")
    .map((chunk) => JSON.parse(chunk));
}
