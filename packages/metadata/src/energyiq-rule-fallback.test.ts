import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { EnergyIqRuleStore, initializeEnergyIqRuleSchema } from "./energyiq-rule-store.js";

it("preserves the latest published rules when no editable configuration exists", () => {
  const db = new DatabaseSync(":memory:");
  try {
    initializeEnergyIqRuleSchema(db);
    db.exec("CREATE TABLE energyiq_template_revisions(project_id TEXT, sequence INTEGER, selected_rule_revision_ids_json TEXT)");
    const ids = ["comparison.daily_usage_above_baseline@1", "comparison.school_holiday_context@1"];
    db.prepare("INSERT INTO energyiq_template_revisions VALUES (?, ?, ?)").run("project", 1, JSON.stringify(ids));
    const store = new EnergyIqRuleStore(db);
    expect(store.getProjectConfig("project").selected_rule_revision_ids).toEqual(ids);
    expect(store.getProjectConfig("new-project").selected_rule_revision_ids).not.toContain(ids[0]);
    db.prepare("INSERT INTO energyiq_template_revisions VALUES (?, ?, ?)").run("project", 2, "[]");
    expect(store.getProjectConfig("project").selected_rule_revision_ids).toEqual([]);
  } finally { db.close(); }
});
