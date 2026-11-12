/**
 * Where the layout editor keeps an unsaved draft in this browser (see floor-plan-draft). Each signed-in person has their
 * own, so someone else using the same browser is never offered it, and signing out removes every draft. Kept apart from
 * the draft itself so the account menu can clear drafts without loading the editor.
 */
export const DRAFT_PREFIX = "energyiq.floorPlanDraft.";
export const draftKey = (projectId: string, userId = "") => userId ? `${DRAFT_PREFIX}${userId}.${projectId}` : `${DRAFT_PREFIX}${projectId}`;
/** Removes every layout draft kept in this browser (on signing out). */
export function clearAllPlanDrafts(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) { const key = window.localStorage.key(index); if (key?.startsWith(DRAFT_PREFIX)) keys.push(key); }
    keys.forEach(key => window.localStorage.removeItem(key));
  } catch { /* per-browser convenience only */ }
}
