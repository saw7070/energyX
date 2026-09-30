import assert from "node:assert/strict";

const baseUrl = (process.env.PROTOCOL_E2E_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/u, "");
const profileId = process.env.ENERGYIQ_TEST_MODEL_PROFILE_ID ?? "energyiq-qwen3-8-max";
const chartMode = process.argv.includes("--chart");
const stamp = Date.now();
const runId = `energyiq-qwen-smoke-${stamp}`;

const response = await fetch(`${baseUrl}/api/copilotkit`, {
  method: "POST",
  headers: {
    Accept: "text/event-stream",
    Authorization: "Bearer dev-token",
    "Content-Type": "application/json",
    "X-Workspace-Id": "default"
  },
  body: JSON.stringify({
    method: "agent/run",
    params: { agentId: "dataFoundry" },
    body: {
      threadId: `energyiq-qwen-thread-${stamp}`,
      runId,
      state: {},
      messages: [{
        id: `${runId}:user`,
        role: "user",
        content: chartMode
          ? "For the selected Ngee Ann energy scope and period, analyze hourly electricity consumption and create a simple line-chart preview file showing the hourly trend. State the local date range, summarize the peak, use read-only SQL, and do not guess."
          : "For the selected Ngee Ann energy scope and period, calculate total electricity consumption and identify the highest-consuming circuit or scope available in the data. Inspect the schema first, use read-only SQL, cite the computed evidence, and do not guess."
      }],
      tools: [],
      context: [],
      forwardedProps: {
        externalContext: {
          source: "energyiq",
          projectId: "ngee-ann-polytechnic",
          scopeId: "l7-load-4",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-03",
          to: "2026-06-09"
        },
        run_config: {
          protocol: { id: "data-analysis", version: "1" },
          activeLlmProfileId: profileId,
          activeSkillId: "data-analysis",
          enabledDatasourceIds: [],
          enabledKnowledgeIds: [],
          enabledMcpServerIds: [],
          enabledSkillIds: ["data-analysis"]
        }
      }
    }
  }),
  signal: AbortSignal.timeout(5 * 60 * 1000)
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
assert.ok(toolNames.includes("inspect_schema"), `inspect_schema missing: ${JSON.stringify(toolNames)}`);
assert.ok(toolNames.includes("run_sql_readonly"), `run_sql_readonly missing: ${JSON.stringify(toolNames)}`);
assert.equal(toolNames.filter((name) => name === "inspect_schema").length, 1, "Schema should be inspected once");
assert.ok(
  toolNames.filter((name) => name === "run_sql_readonly").length <= (chartMode ? 5 : 3),
  `EnergyIQ fast path used too many SQL calls: ${JSON.stringify(toolNames)}`
);
for (const disallowedTool of [
  "list_data_sources",
  "list_files",
  "preview_table",
  ...(chartMode ? [] : ["write_file"])
]) {
  assert.equal(toolNames.includes(disallowedTool), false, `${disallowedTool} should not run on the trusted fast path`);
}
if (chartMode) {
  assert.equal(toolNames.includes("write_file"), false, "Chart mode must not let the model assemble chart files");
  assert.equal(toolNames.includes("execute_command"), false, "Chart mode must use the backend chart renderer");
  const chartEvent = events.find((event) =>
    event.type === "CUSTOM" && event.name === "artifact" && event.value?.type === "chart"
  );
  assert.ok(chartEvent, "Chart mode should emit a backend-validated chart artifact");
  assert.equal(
    chartEvent.value?.preview_json?.points?.length,
    168,
    "Hourly trend chart should contain the complete 168-point local timeline"
  );
}

const protocolTerminal = events.find((event) =>
  event.type === "CUSTOM"
  && (event.name === "protocol.run.completed" || event.name === "protocol.run.degraded")
);
assert.ok(protocolTerminal, "Data analysis protocol did not reach a valid terminal state");

const answer = events
  .filter((event) => event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string")
  .map((event) => event.delta)
  .join("")
  .trim();
assert.ok(answer.length > 0, "Agent produced no final answer text");
assert.match(answer, /kWh/iu, "Agent answer should contain an electricity result with kWh units");
assert.doesNotMatch(answer, /energy-scope-/iu, "Agent answer leaked an internal datasource id");
assert.doesNotMatch(
  answer,
  /requirements? committed|protocol completed|validation completed/iu,
  "Agent answer leaked internal workflow state"
);
if (chartMode) {
  assert.doesNotMatch(answer, /chart below/iu, "Chart preview currently lives in Task Console Outputs, not inline");
  assert.match(answer, /Outputs|Preview/iu, "Agent should direct the user to the chart preview");
}
assert.match(
  answer,
  chartMode ? /2026-06-03/iu : /2026-06-03\s+00:00/iu,
  "Agent answer did not show the local period start"
);
assert.match(
  answer,
  chartMode ? /2026-06-09/iu : /2026-06-09\s+23:59/iu,
  "Agent answer did not show the local period end"
);

console.log(
  `EnergyIQ Qwen Agent smoke OK: profile=${profileId}, tools=${[...new Set(toolNames)].join(",")}, `
  + `terminal=${protocolTerminal.name}, answer_chars=${answer.length}.`
);

function parseEventStream(text) {
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((chunk) => chunk !== "[DONE]")
    .map((chunk) => JSON.parse(chunk));
}
