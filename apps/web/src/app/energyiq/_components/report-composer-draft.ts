export type ComposerDraft = { prompt: string; from: string; to: string; periodPreset: string; parentId: string; fileRefIds?: string[] | null };
export function composerDraftKey(userId: string, workspaceId: string, projectId: string, sessionId: string, focus = "") {
  return `energyiq:composer:v1:${JSON.stringify([userId, workspaceId, projectId, sessionId || "new", focus])}`;
}
export function readComposerDraft(key: string): ComposerDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value && ["prompt", "from", "to", "periodPreset", "parentId"].every(field => typeof value[field] === "string")) return { ...value, fileRefIds: Array.isArray(value.fileRefIds) && value.fileRefIds.every((id: unknown)=>typeof id === "string") ? value.fileRefIds : null };
  } catch { /* Storage may be unavailable; typing must remain possible. */ }
  return null;
}
export function writeComposerDraft(key: string, value: ComposerDraft | null): boolean {
  try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); return true; }
  catch { return false; }
}
