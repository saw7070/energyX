import { expect, it } from "vitest";
import { resolveSnapshotReportTimeContext } from "../energy/project-analysis-resolver.js";
import { resolveReportTimeContext } from "../energy/report-time-context.js";
import type { ReportTimePolicyRevision } from "@datafoundry/contracts";
const policy: ReportTimePolicyRevision = { policyId: "tuya-office-report-time", revision: "v1", windows: [{ windowId: "recent", role: "operations", label: "Recent complete days", strategy: { kind: "rolling_complete_days", days: 28 } }, { windowId: "month", role: "month", label: "Month to date", strategy: { kind: "calendar_month_to_date" } }] };
it("resolves the publication tail's all-available cutoff without pretending the partial last day is complete", () => {
  const input = {
    metadataStore: { energyIq: { reportTimePolicies: { get: () => ({ policy }) } } },
    projectRelease: { id: "tuya-release", projectId: "tuya-office", renderer: { key: "tuya-office-overview" }, reportTimePolicyRevisionId: "tuya-office-report-time@v1" },
    context: { workspaceId: "tuya-office", projectId: "tuya-office", scopeId: "tuya-office-project", resource: "electricity", timezone: "Asia/Singapore" },
    dataSnapshotId: "replayed-snapshot", acceptedDataEndExclusive: "2026-09-05T15:45:00.000Z", resolvedAt: "2026-09-12T06:00:00.000Z",
  } as unknown as Parameters<typeof resolveSnapshotReportTimeContext>[0];
  const result = resolveSnapshotReportTimeContext(input)!;
  expect(result.acceptedDataEndExclusive).toBe("2026-09-05T15:45:00.000Z");
  expect(result.dataThroughLocalDate).toBe("2026-09-04");
  expect(result.windows).toMatchObject([{ toExclusive: "2026-09-04T16:00:00.000Z", completeDayCount: 28 }, { from: "2026-08-31T16:00:00.000Z", toExclusive: "2026-09-04T16:00:00.000Z", completeDayCount: 4 }]);
  // Projection readback reconstructs the context using the exact accepted cutoff.
  expect(resolveReportTimeContext({ binding: result.binding, timezone: result.timezone, asOf: result.asOf, acceptedDataEndExclusive: result.acceptedDataEndExclusive, lastRefreshedAt: result.lastRefreshedAt, policy })).toEqual(result);
});
it("keeps an already complete local midnight boundary unchanged", () => {
  const result = resolveReportTimeContext({ binding: { workspaceId: "w", projectId: "p", scopeId: "root", resource: "electricity", dataSnapshotId: "s", projectReleaseId: "r" }, timezone: "Asia/Singapore", asOf: "2026-09-12T06:00:00.000Z", lastRefreshedAt: "2026-09-12T06:00:00.000Z", acceptedDataEndExclusive: "2026-09-05T16:00:00.000Z", policy });
  expect(result.acceptedDataEndExclusive).toBe("2026-09-05T16:00:00.000Z");
  expect(result.dataThroughLocalDate).toBe("2026-09-05");
  expect(result.windows[0]!.toExclusive).toBe("2026-09-05T16:00:00.000Z");
});
