import type { DatabaseSync } from "node:sqlite";

export const runSchemaMigration = (
  db: DatabaseSync,
  id: string,
  description: string,
  runner: () => void,
  options: { atomic?: boolean } = {},
): void => {
  if (options.atomic) {
    let transactionStarted = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const applied = db.prepare("SELECT 1 AS applied FROM schema_migrations WHERE id = ? LIMIT 1").get(id);
      if (!applied) {
        runner();
        recordSchemaMigration(db, id, description);
      }
      db.exec("COMMIT");
      return;
    } catch (error) {
      if (transactionStarted) db.exec("ROLLBACK");
      throw error;
    }
  }
  const applied = db.prepare("SELECT 1 AS applied FROM schema_migrations WHERE id = ? LIMIT 1").get(id);
  if (applied) return;
  runner();
  recordSchemaMigration(db, id, description);
};

export const recordSchemaMigration = (
  db: DatabaseSync,
  id: string,
  description: string,
): void => {
  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (id, description, applied_at)
    VALUES (?, ?, ?)
  `).run(id, description, new Date().toISOString());
};
