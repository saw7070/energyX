import type { AnalysisContextEvidenceCatalog } from "@datafoundry/agent-runtime";
import { describe, expect, it } from "vitest";

import {
  createPreschoolAdditionalAiInsightRuntime,
  type PreschoolAdditionalAiInsightRuntimeBinding,
} from "./preschool-additional-ai-insight-runtime.js";

describe("Preschool Additional AI Insight scoped runtime", () => {
  it("reads only requested current Catalog facts and records server-owned audit identity", async () => {
    const runtime = createPreschoolAdditionalAiInsightRuntime({ binding: BINDING, catalog: catalog() });

    const read = await runtime.invoke({
      toolName: "energy.evidence.read",
      toolCallId: "tool-call:read:1",
      input: { factIds: ["fact:standby-share"] },
    });
    const compared = await runtime.invoke({
      toolName: "energy.metrics.compare",
      toolCallId: "tool-call:compare:1",
      input: { factIds: ["fact:standby-share", "fact:operating-share"] },
    });

    expect(read).toMatchObject({
      auditId: "additional-tool-audit:tool-call:read:1",
      evidenceRefs: ["fact:standby-share"],
      facts: [{ id: "fact:standby-share", value: 31 }],
    });
    expect(compared.facts.map(({ id }) => id)).toEqual(["fact:standby-share", "fact:operating-share"]);
    expect(runtime.audits()).toEqual([
      expect.objectContaining({
        toolCallId: "tool-call:read:1",
        toolName: "energy.evidence.read",
        status: "succeeded",
        evidenceRefs: ["fact:standby-share"],
      }),
      expect.objectContaining({
        toolCallId: "tool-call:compare:1",
        toolName: "energy.metrics.compare",
        status: "succeeded",
        evidenceRefs: ["fact:standby-share", "fact:operating-share"],
      }),
    ]);
  });

  it.each([
    ["workspace", { ...BINDING, workspaceId: "other-workspace" }],
    ["project", { ...BINDING, projectId: "other-project" }],
    ["scope", { ...BINDING, scopeId: "other-scope" }],
    ["Snapshot", { ...BINDING, dataSnapshotId: "other-snapshot" }],
    ["Release", { ...BINDING, projectReleaseId: "other-release" }],
  ] as const)("rejects a Catalog with %s drift before exposing tools", (_label, binding) => {
    expect(() => createPreschoolAdditionalAiInsightRuntime({ binding, catalog: catalog() }))
      .toThrow("PRESCHOOL_ADDITIONAL_AI_EVIDENCE_IDENTITY_MISMATCH");
  });

  it("rejects forged Evidence, duplicate calls, uncontrolled arguments and unavailable sources", async () => {
    const runtime = createPreschoolAdditionalAiInsightRuntime({ binding: BINDING, catalog: catalog() });

    await expect(runtime.invoke({
      toolName: "energy.evidence.read",
      toolCallId: "tool-call:forged",
      input: { factIds: ["fact:forged"] },
    })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_EVIDENCE_NOT_FOUND");
    await expect(runtime.invoke({
      toolName: "energy.metrics.compare",
      toolCallId: "tool-call:sql",
      input: { factIds: ["fact:standby-share", "fact:operating-share"], sql: "select *" },
    })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_TOOL_INPUT_INVALID");
    await expect(runtime.invoke({
      toolName: "energy.snapshot-history.read",
      toolCallId: "tool-call:history",
      input: { factIds: ["fact:standby-share"] },
    })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_TOOL_SOURCE_UNAVAILABLE");
    await expect(runtime.invoke({
      toolName: "energy.project-knowledge.read",
      toolCallId: "tool-call:knowledge",
      input: { url: "https://example.test" },
    })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_TOOL_INPUT_INVALID");

    await runtime.invoke({
      toolName: "energy.evidence.read",
      toolCallId: "tool-call:duplicate",
      input: { factIds: ["fact:standby-share"] },
    });
    await expect(runtime.invoke({
      toolName: "energy.evidence.read",
      toolCallId: "tool-call:duplicate",
      input: { factIds: ["fact:standby-share"] },
    })).rejects.toThrow("PRESCHOOL_ADDITIONAL_AI_TOOL_CALL_DUPLICATE");

    expect(runtime.toolNames).toEqual([
      "energy.evidence.read",
      "energy.metrics.compare",
      "energy.timeseries.analyze",
      "energy.snapshot-history.read",
      "energy.project-knowledge.read",
    ]);
    expect(runtime.toolNames).not.toEqual(expect.arrayContaining([
      "run_sql_readonly", "write_file", "execute_command", "fetch", "open_url",
    ]));
  });
});

const BINDING: PreschoolAdditionalAiInsightRuntimeBinding = {
  workspaceId: "preschool-workspace",
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  dataSnapshotId: "snapshot-current",
  projectReleaseId: "release-current",
};

const catalog = (): AnalysisContextEvidenceCatalog => ({
  contract: "analysis-context-evidence@1",
  sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
  pins: {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-current",
    dataCutoff: "2026-06-01T00:00:00.000Z",
    projectReleaseId: "release-current",
    metricVersion: "energy-metrics-v1",
  },
  facts: [{
    id: "fact:standby-share",
    label: "Standby share",
    metricId: "energy.standby_share_pct",
    value: 31,
    unit: "%",
    status: "confirmed",
    evidenceRefs: ["snapshot-evidence:standby"],
    dimensions: { period: "standby" },
  }, {
    id: "fact:operating-share",
    label: "Operating share",
    metricId: "energy.operating_share_pct",
    value: 69,
    unit: "%",
    status: "confirmed",
    evidenceRefs: ["snapshot-evidence:operating"],
    dimensions: { period: "operating" },
  }],
});
