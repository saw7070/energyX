import type { DatabaseSync } from "node:sqlite";

/** Keep every editable Project configuration on the same delivery-state rule. */
export const markEnergyIqProjectConfigurationChanged = (
  db: DatabaseSync,
  projectId: string,
  now: string,
): void => {
  db.prepare(`
    UPDATE energyiq_projects
    SET has_unpublished_changes = 1,
        delivery_stage = CASE WHEN status = 'published' THEN 'configured' ELSE 'draft' END,
        updated_at = ?
    WHERE id = ?
  `).run(now, projectId);
};
