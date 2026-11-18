import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addNoteLine, followUpNoteLine, memoryNoteLine, removeNoteLine, updateAdvisorNotes, type NotesStore } from "./report-feedback-notes.js";
import { ReportStore, type ReportSettings } from "./report-store.js";

let root: string;
let metadata: ReturnType<typeof createMetadataStore>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "report-feedback-notes-"));
  metadata = createMetadataStore({ database_path: join(root, "db.sqlite") });
  metadata.users.createPasswordUser({ id: "admin", email: "admin@example.test" });
  metadata.workspaces.upsert({ id: "w", name: "W", kind: "customer", owner_user_id: "admin" });
  metadata.energyIq.upsertProject({ id: "p", workspace_id: "w", name: "Project", status: "published", timezone: "Asia/Singapore" });
});
afterEach(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });

const settings = (contextNotes: string): ReportSettings => ({
  projectId: "p", workspaceId: "w", actorUserId: "owner", timezone: "Asia/Singapore", contextNotes, fileRefIds: [], useProjectData: true,
  skill: "", revision: 0, frequency: "off", localHour: 3, scheduledPrompt: "",
});

it("writes lines in the advisor-facts format the Project notes page reads", () => {
  expect(memoryNoteLine("2026-11-18", "The pavilion\nfan must   never run.")).toBe("- 2026-11-18 · Note: The pavilion fan must never run.");
  expect(followUpNoteLine("2026-11-18", "Check lights off at 7:10")).toBe("- 2026-11-18 · Coming up: Follow up: Check lights off at 7:10");
});

it("adds the section when missing, adds under the last fact, and removes exactly one line", () => {
  const brief = "# Site brief\nA polytechnic block.";
  const first = addNoteLine(brief, "- 2026-11-18 · Note: A");
  expect(first).toBe("# Site brief\nA polytechnic block.\n\n## Things the advisor should know\n\n- 2026-11-18 · Note: A\n");
  const withNext = addNoteLine(`${first}\n## Later section\ntext`, "- 2026-11-18 · Note: B");
  expect(withNext).toContain("- 2026-11-18 · Note: A\n- 2026-11-18 · Note: B\n\n## Later section");
  expect(addNoteLine(withNext, "- 2026-11-18 · Note: B")).toBe(withNext);
  const removed = removeNoteLine(withNext, "- 2026-11-18 · Note: A");
  expect(removed).not.toContain("Note: A");
  expect(removed).toContain("Note: B");
  // A line in another section, or one edited by hand, is never touched.
  expect(removeNoteLine("## Other\n- 2026-11-18 · Note: A", "- 2026-11-18 · Note: A")).toBe("## Other\n- 2026-11-18 · Note: A");
});

it("saves through the report settings, keeping their owner, and creates them when the project has none", () => {
  const reports = new ReportStore(metadata.db);
  expect(updateAdvisorNotes({ metadata, projectId: "p", workspaceId: "w", actorUserId: "admin", add: ["- 2026-11-18 · Note: A"], remove: [], store: reports })).toBe(true);
  expect(reports.settings("p")).toMatchObject({ actorUserId: "admin", revision: 1, contextNotes: "## Things the advisor should know\n\n- 2026-11-18 · Note: A\n" });
  reports.saveSettings({ ...reports.settings("p")!, actorUserId: "owner" });
  updateAdvisorNotes({ metadata, projectId: "p", workspaceId: "w", actorUserId: "admin", add: [], remove: ["- 2026-11-18 · Note: A"], store: reports });
  expect(reports.settings("p")).toMatchObject({ actorUserId: "owner", revision: 3 });
  expect(reports.settings("p")!.contextNotes).not.toContain("Note: A");
});

it("tries once more when someone saved the notes at the same moment, and never overwrites their edit", () => {
  let current = { ...settings("Someone's brief"), revision: 4 };
  const saveSettings = vi.fn((next: ReportSettings) => {
    if (saveSettings.mock.calls.length === 1) {
      // Another person saves first; the retry must start from their text.
      current = { ...current, contextNotes: "Someone's newer brief", revision: 5 };
      throw new Error("REPORT_SETTINGS_CHANGED");
    }
    current = { ...next, revision: next.revision + 1 };
    return current;
  });
  const store: NotesStore = { settings: () => current, saveSettings };
  expect(updateAdvisorNotes({ metadata, projectId: "p", workspaceId: "w", actorUserId: "admin", add: ["- 2026-11-18 · Note: A"], remove: [], store })).toBe(true);
  expect(saveSettings).toHaveBeenCalledTimes(2);
  expect(current.contextNotes).toBe("Someone's newer brief\n\n## Things the advisor should know\n\n- 2026-11-18 · Note: A\n");
  const alwaysChanged: NotesStore = { settings: () => current, saveSettings: () => { throw new Error("REPORT_SETTINGS_CHANGED"); } };
  expect(updateAdvisorNotes({ metadata, projectId: "p", workspaceId: "w", actorUserId: "admin", add: ["- x"], remove: [], store: alwaysChanged })).toBe(false);
});

it("leaves the notes alone when the report agent is not running", () => {
  expect(updateAdvisorNotes({ metadata, projectId: "p", workspaceId: "w", actorUserId: "admin", add: ["- 2026-11-18 · Note: A"], remove: [] })).toBe(false);
});
