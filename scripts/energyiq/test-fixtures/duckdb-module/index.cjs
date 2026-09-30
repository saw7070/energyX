const requiredTables = [
  "energy_interval_facts",
  "energy_project_fact_state",
  "energy_quality_events",
  "normalized_meter_readings",
];

class Database {
  constructor(_filePath, callback) {
    queueMicrotask(() => callback(null));
  }

  all(_sql, callback) {
    queueMicrotask(() => callback(null, requiredTables.map((table_name) => ({ table_name }))));
  }

  close(callback) {
    queueMicrotask(() => callback(null));
  }
}

module.exports = { Database };
