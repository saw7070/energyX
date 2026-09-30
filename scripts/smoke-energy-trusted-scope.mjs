import {
  ensureEnergyScopedDataSource,
  LocalDataGateway
} from "../packages/data-gateway/dist/index.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";
import { mkdirSync } from "node:fs";

const stamp = Date.now();
const root = `storage/energy-scope-smoke/${stamp}`;
mkdirSync(root, { recursive: true });
const store = createMetadataStore({ database_path: `${root}/metadata.sqlite` });
const gateway = new LocalDataGateway(store);
const userId = "dev-user";

try {
  const scoped = await ensureEnergyScopedDataSource({
    metadataStore: store,
    userId,
    databasePath: "storage/energy/default/energy.duckdb",
    context: {
      workspaceId: "default",
      projectId: "ngee-ann-polytechnic",
      scopeId: "level-7",
      meterAttachments: [
        ["mapping-lvl-7-total-office-light-17", "l7-total-light", true],
        ["mapping-lvl-7-total-office-load-18", "l7-total-load", true],
        ["mapping-lvl-7-front-row-office-light-11", "l7-front-light", false],
        ["mapping-lvl-7-middle-row-office-light-12", "l7-middle-light", false],
        ["mapping-lvl-7-back-row-office-light-10", "l7-back-light", false],
        ["mapping-lvl-7-office-load-1-l1p1-l3p6-13", "l7-load-1", false],
        ["mapping-lvl-7-office-load-2-l1p7-l3p15-14", "l7-load-2", false],
        ["mapping-lvl-7-office-load-3-l1p16-l3p21-15", "l7-load-3", false],
        ["mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16", "l7-load-4", false]
      ].map(([meterPointId, scopeId, officialAggregation]) => ({
        meterPointId,
        scopeId,
        officialAggregation
      })),
      resource: "electricity",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
      timezone: "Asia/Singapore",
      hierarchyRevisionId: "ngee-ann-hierarchy-v1",
      meterMappingRevisionId: "smoke-published-routing-v2",
      meterFormulaRevisionId: "ngee-ann-meter-formula-v1",
      dataSnapshotId: "ngee-ann-4bac1177eca62cdb",
      metricVersion: "energy-metrics-v1"
    }
  });

  const result = await gateway.runSqlReadonly({
    user_id: userId,
    workspace_id: "default",
    datasource_id: scoped.datasourceId,
    sql: `SELECT meter_node_id, SUM(usage_kwh) AS usage_kwh
          FROM "${scoped.viewName}"
          WHERE meter_role = 'total'
          GROUP BY meter_node_id
          ORDER BY meter_node_id`
  });
  assert(result.row_count === 2, `expected two Level 7 total meters, got ${result.row_count}`);

  await assertTableBlocked(() => gateway.runSqlReadonly({
    user_id: userId,
    workspace_id: "default",
    datasource_id: scoped.datasourceId,
    sql: "SELECT * FROM energy_interval_facts"
  }));

  const schema = await gateway.inspectSchema({
    user_id: userId,
    workspace_id: "default",
    datasource_id: scoped.datasourceId
  });
  assert(
    schema.tables.length === 1 && schema.tables[0]?.name === scoped.viewName,
    `expected only the scoped view in schema, got ${schema.tables.map((table) => table.name).join(",")}`
  );

  const preschoolScopeNodeIds = [
    "preschool-centre-a-aircon-1",
    "preschool-centre-a-aircon-2",
    "preschool-centre-a-heater",
    "preschool-centre-a-living-area-plug-load",
    "preschool-centre-a-kitchen-plug-load",
    "preschool-centre-a-plug-load3",
    "preschool-centre-a-living-room-lighting",
    "preschool-centre-a-kitchen-lighting",
    "preschool-centre-a-other-lighting3"
  ];
  const preschoolScoped = await ensureEnergyScopedDataSource({
    metadataStore: store,
    userId,
    databasePath: "storage/energy/default/energy.duckdb",
    context: {
      workspaceId: "default",
      projectId: "preschool-demo",
      scopeId: "preschool-centre-a",
      meterAttachments: preschoolScopeNodeIds.map((meterPointId) => ({
        meterPointId,
        scopeId: meterPointId,
        officialAggregation: true
      })),
      resource: "electricity",
      from: "2026-04-30T16:00:00.000Z",
      to: "2026-05-31T16:00:00.000Z",
      timezone: "Asia/Singapore",
      hierarchyRevisionId: "preschool-hierarchy-v3",
      meterMappingRevisionId: "smoke-published-routing-v2",
      meterFormulaRevisionId: "preschool-meter-formula-v2",
      dataSnapshotId: "preschool-26b85b9c0b95e090",
      metricVersion: "energy-metrics-v1"
    }
  });
  const preschoolResult = await gateway.runSqlReadonly({
    user_id: userId,
    workspace_id: "default",
    datasource_id: preschoolScoped.datasourceId,
    sql: `SELECT
            COUNT(*) AS interval_rows,
            COUNT(DISTINCT meter_node_id) AS circuits,
            ROUND(SUM(usage_kwh), 4) AS usage_kwh,
            ROUND(SUM(usage_kwh) FILTER (WHERE NOT is_operating), 4) AS non_operating_kwh
          FROM "${preschoolScoped.viewName}"
          WHERE meter_role = 'component'`
  });
  const preschoolRow = preschoolResult.rows[0] ?? [];
  const [preschoolIntervals, preschoolCircuits, preschoolUsage] = preschoolRow.map(Number);
  assert(preschoolIntervals === 6696, `expected 6696 Centre A intervals, got ${preschoolIntervals}`);
  assert(preschoolCircuits === 9, `expected 9 Centre A circuits, got ${preschoolCircuits}`);
  assert(preschoolUsage === 843.0985, `expected Centre A 843.0985 kWh, got ${preschoolUsage}`);

  console.log(
    `Energy trusted scope smoke OK: datasource=${scoped.datasourceId}, ` +
    `allowed_rows=${result.row_count}, schema_tables=${schema.tables.length}, ` +
    `preschool_circuits=${preschoolCircuits}, preschool_kwh=${preschoolUsage}`
  );
} finally {
  store.close();
}

async function assertTableBlocked(callback) {
  try {
    await callback();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TABLE_NOT_ALLOWED:")) {
      return;
    }
    throw error;
  }
  throw new Error("Expected base table access to be blocked");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
