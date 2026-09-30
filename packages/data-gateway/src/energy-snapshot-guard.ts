export type EnergySnapshotGuardScope = {
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  manifestFingerprint: string;
  sourceSha256: string[];
  factWriterContractVersion: string;
  canonicalIntervalCount: number;
  canonicalIntervalDigest: string;
};

export type EnergySnapshotIdentityScope = Omit<
  EnergySnapshotGuardScope,
  "canonicalIntervalCount" | "canonicalIntervalDigest"
>;

export const assertEnergySnapshotReceipt = (
  expected: EnergySnapshotIdentityScope,
  actual: EnergySnapshotGuardScope,
): void => {
  if (actual.dataSnapshotId !== expected.dataSnapshotId) {
    throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${expected.dataSnapshotId}`);
  }
  if (actual.workspaceId !== expected.workspaceId
    || actual.projectId !== expected.projectId
    || actual.manifestFingerprint !== expected.manifestFingerprint
    || actual.factWriterContractVersion !== expected.factWriterContractVersion
    || JSON.stringify(actual.sourceSha256) !== JSON.stringify(expected.sourceSha256)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
};

export const energySnapshotGuardSql = (scope: EnergySnapshotGuardScope): string => `(
  SELECT CASE
    WHEN COUNT(*) = 0 THEN error('ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE')
    WHEN bool_or(state.data_snapshot_id <> ${sqlLiteral(scope.dataSnapshotId)})
      THEN error('ENERGYIQ_SNAPSHOT_STALE')
    WHEN bool_and(
      ${energySnapshotReceiptPredicateSql(scope, "state")}
      AND integrity.canonical_interval_count = state.canonical_interval_count
      AND integrity.canonical_interval_digest = state.canonical_interval_digest
    ) THEN TRUE
    ELSE error('ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE')
  END
  FROM energy_project_fact_state state
  CROSS JOIN (
    ${energyCanonicalIntervalIntegritySql(scope)}
  ) integrity
  WHERE state.project_id = ${sqlLiteral(scope.projectId)}
)`;

const energySnapshotReceiptPredicateSql = (
  scope: EnergySnapshotGuardScope,
  alias: string,
): string => `${alias}.workspace_id = ${sqlLiteral(scope.workspaceId)}
      AND ${alias}.manifest_fingerprint = ${sqlLiteral(scope.manifestFingerprint)}
      AND ${alias}.source_sha256_json = ${sqlLiteral(JSON.stringify(scope.sourceSha256))}
      AND ${alias}.fact_writer_contract_version = ${sqlLiteral(scope.factWriterContractVersion)}
      AND ${alias}.canonical_interval_count = ${scope.canonicalIntervalCount}
      AND ${alias}.canonical_interval_digest = ${sqlLiteral(scope.canonicalIntervalDigest)}`;

export const energyCanonicalIntervalIntegritySql = (scope: Pick<
  EnergySnapshotGuardScope,
  "workspaceId" | "projectId" | "sourceSha256"
>): string => `
  SELECT
    COUNT(*) AS canonical_interval_count,
    sha256(COALESCE(string_agg(row_digest, '' ORDER BY row_digest), '')) AS canonical_interval_digest
  FROM (
    SELECT sha256(to_json(struct_pack(
      workspace_id := workspace_id,
      project_id := project_id,
      import_batch_id := import_batch_id,
      resource := resource,
      meter_node_id := meter_node_id,
      scope_id := scope_id,
      parent_node_id := parent_node_id,
      level_node_id := level_node_id,
      device_name := device_name,
      appliance := appliance,
      circuit_name := circuit_name,
      category := category,
      meter_role := meter_role,
      source_reading_kind := source_reading_kind,
      interval_start := interval_start,
      interval_end := interval_end,
      elapsed_minutes := elapsed_minutes,
      active_energy_kwh := active_energy_kwh,
      previous_active_energy_kwh := previous_active_energy_kwh,
      raw_delta_kwh := raw_delta_kwh,
      usage_kwh := usage_kwh,
      average_kw := average_kw,
      quality_status := quality_status,
      local_date := local_date,
      local_hour := local_hour,
      day_type := day_type,
      is_operating := is_operating,
      source_file := source_file,
      source_sha256 := source_sha256
    ))) AS row_digest
    FROM energy_interval_facts
    WHERE workspace_id = ${sqlLiteral(scope.workspaceId)}
      AND project_id = ${sqlLiteral(scope.projectId)}
      AND lower(source_sha256) IN (${scope.sourceSha256.map(sqlLiteral).join(", ")})
  ) canonical_rows
`;

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
