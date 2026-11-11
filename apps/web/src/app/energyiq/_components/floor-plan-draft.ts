"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import type { EnergyIqLocale } from "./energyiq-messages";
import { notesWithReference, planFromReference, referenceFromPlan, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";
import { draftKey } from "./floor-plan-draft-key";
import { editorPrefs, withPrefs, type EditorPrefs } from "./floor-plan-snap";

/**
 * An unsaved draft of the floor plan, kept in this browser while someone edits, so a reload, a closed tab or a save that
 * could not go through does not lose a long design session. It is only ever offered back (never applied by itself), it
 * is checked like any saved layout before it is used, and it is cleared once the plan is saved or the draft discarded.
 */
export const DRAFT_DELAY = 1000;
/** A draft older than this is not offered any more. */
export const DRAFT_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
/** `user` is who made it: a draft is only ever offered back to the same signed-in person. */
type DraftRecord = { version: 1; savedAt: number; base: string; user?: string; reference: unknown };
export type DraftOffer = { savedAt: number; plan: FloorPlan; stale: boolean };

export { clearAllPlanDrafts, draftKey } from "./floor-plan-draft-key";
/** A short fingerprint of the saved layout a draft was made from (so a later save by someone else can be told apart). */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}
export function clearPlanDraft(projectId: string, userId = ""): void { try { window.localStorage.removeItem(draftKey(projectId, userId)); } catch { /* per-browser convenience only */ } }
function writeDraft(projectId: string, userId: string, record: DraftRecord): void { try { window.localStorage.setItem(draftKey(projectId, userId), JSON.stringify(record)); } catch { /* full or blocked: the editor keeps working without a draft */ } }
/** The stored draft, checked like a saved layout (anything that would not load, or made by someone else, is ignored), or null. */
export function readDraft(projectId: string, now = Date.now(), userId = ""): { savedAt: number; base: string; reference: StoredSpatialReference } | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(draftKey(projectId, userId)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const { version, savedAt, base, user, reference } = value as Partial<DraftRecord>;
    if (version !== 1 || typeof savedAt !== "number" || !Number.isFinite(savedAt) || typeof base !== "string" || savedAt > now + 60_000 || now - savedAt > DRAFT_MAX_AGE || !reference || typeof reference !== "object") return null;
    if ((typeof user === "string" ? user : "") !== userId) return null;
    const checked = readProjectSpatialReference(notesWithReference("", null, reference as StoredSpatialReference), projectId);
    return checked ? { savedAt, base, reference: checked.reference as StoredSpatialReference } : null;
  } catch { return null; }
}
const layoutText = (reference: StoredSpatialReference) => JSON.stringify(reference.layout);

/**
 * Keeps the draft while editing (at most once a second, and right away when the page is closed or reloaded) and offers
 * a draft left from before when it differs from the saved layout. `opened` is the plan as the editor opened it, and
 * `userId` who is signed in. Editing without answering the offer means the new work wins: the offer goes away
 * (`onReplaced` says so) and the new work is kept instead, so it is never lost to a reload.
 */
export function usePlanDraft({ projectId, userId = "", block, previous, locale, opened, plan, prefs, changed, busy, onReplaced }: { projectId: string; userId?: string; block: string | null; previous: StoredSpatialReference | null; locale: EnergyIqLocale; opened: FloorPlan; plan: FloorPlan; prefs: EditorPrefs; changed: boolean; busy: () => boolean; onReplaced?: () => void }) {
  const base = fingerprint(block ?? "");
  const [offer, setOffer] = useState<DraftOffer | null>(() => {
    const draft = readDraft(projectId, Date.now(), userId);
    if (!draft) return null;
    // A draft that is the same as what is saved is nothing to offer. A saved layout that loads but could not be saved as
    // it is (written by hand or by the advisor) is never "the same", so a draft that fixes it is still offered.
    let same: boolean;
    try { same = layoutText(referenceFromPlan(withPrefs(opened, editorPrefs(opened)), projectId, previous, locale)) === layoutText(draft.reference); } catch { same = false; }
    if (same) return null;
    try { return { savedAt: draft.savedAt, plan: planFromReference(draft.reference, locale), stale: draft.base !== base }; } catch { return null; }
  });
  const latest = useRef({ plan, prefs, changed });
  useLayoutEffect(() => { latest.current = { plan, prefs, changed }; });
  const done = useRef(false);
  // Once a draft is restored, going back to the saved plan (an Undo) keeps it: only Save, leaving or Discard drop it.
  const restored = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const write = useCallback(() => {
    const { plan: current, prefs: chosen, changed: dirty } = latest.current;
    if (done.current || !dirty) return;
    // A plan that cannot be saved yet (a name half typed) keeps the last good draft.
    try { writeDraft(projectId, userId, { version: 1, savedAt: Date.now(), base, ...(userId ? { user: userId } : {}), reference: referenceFromPlan(withPrefs(current, chosen), projectId, previous, locale) }); } catch { /* not a valid plan yet */ }
  }, [projectId, userId, base, previous, locale]);
  const stop = useCallback(() => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } }, []);
  const busyRef = useRef(busy);
  useLayoutEffect(() => { busyRef.current = busy; });
  const replacedRef = useRef(onReplaced);
  useLayoutEffect(() => { replacedRef.current = onReplaced; });
  useEffect(() => {
    if (done.current) return;
    // While an earlier draft is being offered and nothing has changed, it is left alone.
    if (!changed) { if (!offer) { stop(); if (!restored.current) clearPlanDraft(projectId, userId); } return; }
    // A change made without answering the offer: the new work is what is kept from now on.
    if (offer) { setOffer(null); replacedRef.current?.(); }
    if (timer.current !== null) return;
    const tick = () => { if (busyRef.current()) { timer.current = setTimeout(tick, DRAFT_DELAY); return; } timer.current = null; write(); };
    timer.current = setTimeout(tick, DRAFT_DELAY);
  }, [plan, prefs, changed, offer, projectId, userId, write, stop]);
  // Closing or reloading the page keeps the very latest change; leaving the editor inside the page just stops.
  useEffect(() => {
    const flush = () => { if (timer.current !== null) { stop(); write(); } };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [write, stop]);
  useEffect(() => stop, [stop]);
  return {
    offer,
    /** The draft's plan, to load into the editor (the draft itself stays until the plan is saved). */
    restore: () => { const plan = offer?.plan ?? null; if (plan) restored.current = true; setOffer(null); return plan; },
    discard: () => { setOffer(null); clearPlanDraft(projectId, userId); },
    /** Saved, or left on purpose without saving: no draft is kept. */
    finish: () => { done.current = true; stop(); clearPlanDraft(projectId, userId); },
  };
}
