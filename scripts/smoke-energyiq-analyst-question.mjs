import assert from "node:assert/strict";

const baseUrl = (process.env.PROTOCOL_E2E_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/u, "");
const workspaceId = process.env.ENERGYIQ_TEST_WORKSPACE_ID ?? "default";
const projectId = process.env.ENERGYIQ_TEST_PROJECT_ID ?? "ngee-ann-polytechnic";
const scopeId = process.env.ENERGYIQ_TEST_SCOPE_ID ?? "project";
const profileId = process.env.ENERGYIQ_TEST_MODEL_PROFILE_ID ?? "energyiq-deepseek-v4-flash";
const from = process.env.ENERGYIQ_TEST_FROM ?? "2026-06-03";
const to = process.env.ENERGYIQ_TEST_TO ?? "2026-06-09";
const question = process.env.ENERGYIQ_TEST_QUESTION
  ?? "What is the total electricity consumption for the selected scope and period?";
const stamp = Date.now();
const runId = `energyiq-analyst-question-${stamp}`;
const threadId = process.env.ENERGYIQ_TEST_THREAD_ID ?? `energyiq-analyst-question-thread-${stamp}`;
const startedAt = Date.now();

const response = await fetch(`${baseUrl}/api/copilotkit`, {
  method: "POST",
  headers: {
    Accept: "text/event-stream",
    Authorization: "Bearer dev-token",
    "Content-Type": "application/json",
    "X-Workspace-Id": workspaceId,
  },
  body: JSON.stringify({
    method: "agent/run",
    params: { agentId: "dataFoundry" },
    body: {
      threadId,
      runId,
      state: {},
      messages: [{ id: `${runId}:user`, role: "user", content: question }],
      tools: [],
      context: [],
      forwardedProps: {
        externalContext: {
          source: "energyiq",
          projectId,
          scopeId,
          resource: "electricity",
          period: "Custom",
          from,
          to,
        },
        run_config: {
          protocol: { id: "data-analysis", version: "1" },
          activeLlmProfileId: profileId,
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

const responseBody = await response.text();
assert.equal(response.ok, true, `Agent API failed (${response.status}): ${responseBody}`);
const events = parseEventStream(responseBody);
const runError = events.findLast((event) => event.type === "RUN_ERROR");
assert.equal(runError, undefined, `Unexpected RUN_ERROR: ${JSON.stringify(runError)}`);
assert.equal(events.findLast((event) => event.type === "RUN_FINISHED")?.type, "RUN_FINISHED");

const toolNames = events
  .filter((event) => event.type === "TOOL_CALL_START")
  .map((event) => event.toolCallName)
  .filter(Boolean);
const dataToolNames = toolNames.filter((name) => name === "inspect_schema" || name === "run_sql_readonly");
assert.equal(dataToolNames[0], "inspect_schema",
  `Current-run SQL must not use a stale schema before inspection: ${JSON.stringify(toolNames)}`);
assert.equal(toolNames.filter((name) => name === "inspect_schema").length, 1,
  `Expected one schema inspection: ${JSON.stringify(toolNames)}`);
if (process.env.ENERGYIQ_TEST_REQUIRE_SQL !== "false") {
  assert.ok(toolNames.includes("run_sql_readonly"), `run_sql_readonly missing: ${JSON.stringify(toolNames)}`);
}
assert.equal(toolNames.filter((name) => name === "analysis_requirements_commit").length, 1,
  `Expected one requirements commit: ${JSON.stringify(toolNames)}`);

const messages = new Map();
for (const event of events) {
  if (event.type !== "TEXT_MESSAGE_CONTENT" || typeof event.delta !== "string") continue;
  const messageId = event.messageId ?? "unknown";
  messages.set(messageId, `${messages.get(messageId) ?? ""}${event.delta}`);
}
const answer = [...messages.values()].at(-1)?.trim() ?? "";
assert.ok(answer.length > 0, "Agent produced no final answer text");
assert.doesNotMatch(answer, /requirements? committed|protocol completed|validation completed/iu,
  "Agent answer leaked internal workflow state");
const expected = process.env.ENERGYIQ_TEST_EXPECT_REGEX;
if (expected) assert.match(answer, new RegExp(expected, "iu"));

const tokenEvents = events.filter((event) => event.type === "CUSTOM" && event.name === "token_usage");
const tokenTotals = tokenEvents.reduce((total, event) => ({
  input: total.input + Number(event.value?.input_tokens ?? 0),
  output: total.output + Number(event.value?.output_tokens ?? 0),
}), { input: 0, output: 0 });

console.log(JSON.stringify({
  status: "passed",
  runId,
  threadId,
  elapsedMs: Date.now() - startedAt,
  projectId,
  scopeId,
  profileId,
  tools: toolNames,
  reasoningRounds: events.filter((event) => event.type === "REASONING_START").length,
  tokens: tokenTotals,
  answer,
}, null, 2));

function parseEventStream(text) {
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((chunk) => chunk !== "[DONE]")
    .map((chunk) => JSON.parse(chunk));
}
