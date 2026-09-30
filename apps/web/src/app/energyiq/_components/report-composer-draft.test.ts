/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { composerDraftKey, readComposerDraft, writeComposerDraft } from "./report-composer-draft";
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); vi.restoreAllMocks(); });
it("isolates user, customer, project, conversation and setup drafts", () => {
  const args = ["u", "w", "p", "s", "initialize"] as const;
  const keys = [composerDraftKey(...args), ...args.map((_, i) => { const changed: [string, string, string, string, string] = [...args]; changed[i] = "different"; return composerDraftKey(...changed); })];
  expect(new Set(keys).size).toBe(6);
});
it("ignores malformed storage and tolerates unavailable storage", () => {
  sessionStorage.setItem("draft", "bad-json"); expect(readComposerDraft("draft")).toBeNull();
  sessionStorage.setItem("draft", "{}"); expect(readComposerDraft("draft")).toBeNull();
  vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("Quota"); } });
  expect(writeComposerDraft("draft", { prompt: "text", from: "", to: "", periodPreset: "recent", parentId: "" })).toBe(false);
});
