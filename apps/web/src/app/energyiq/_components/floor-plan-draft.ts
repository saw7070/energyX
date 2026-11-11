"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import type { EnergyIqLocale } from "./energyiq-messages";
import { notesWithReference, planFromReference, referenceFromPlan, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";
import { editorPrefs, withPrefs, type EditorPrefs } from "./floor-plan-snap";

/**
 * An unsaved draft of the floor plan, kept in this browser while someone edits, so a reload, a closed tab or a save that
 * could not go through does not lose a long design session. It is only ever offered back (never applied by itself), it
 * is checked like any saved layout before it is used, and it is cleared once the plan is saved or the draft discarded.
 */
export const DRAFT_DELAY = 1000;
/** A draft older than this is not offered any more. */
export const DRAFT_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
type DraftRecord = { version: 1; savedAt: number; base: string; reference: unknown };
export type DraftOffer = { savedAt: number; plan: FloorPlan; stale: boolean };

export const draftKey = (projectId: string) => `energyiq.floorPlanDraft.${projectId}`;
/** A short fingerprint of the saved layout a draft was made from (so a later save by someone else can be told apart). */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}
export function clearPlanDraft(projectId: string): void { try { window.localStorage.removeItem(draftKey(projectId)); } catch { /* per-browser convenience only */ } }
function writeDraft(projectId: string, record: DraftRecord): void { try { window.localStorage.setItem(draftKey(projectId), JSON.stringify(record)); } catch { /* full or blocked: the editor keeps working without a draft */ } }
/** The stored draft, checked like a saved layout (anything that would not load is ignored), or null. */
export function readDraft(projectId: string, now = Date.now()): { savedAt: number; base: string; reference: StoredSpatialReference } | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(draftKey(projectId)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const { version, savedAt, base, reference } = value as Partial<DraftRecord>;
    if (version !== 1 || typeof savedAt !== "number" || !Number.isFinite(savedAt) || typeof base !== "string" || savedAt > now + 60_000 || now - savedAt > DRAFT_MAX_AGE || !reference || typeof reference !== "object") return null;
    const checked = readProjectSpatialReference(notesWithReference("", null, reference as StoredSpatialReference), projectId);
    return checked ? { savedAt, base, reference: checked.reference as StoredSpatialReference } : null;
  } catch { return null; }
}
const layoutText = (reference: StoredSpatialReference) => JSON.stringify(reference.layout);

/**
 * Keeps the draft while editing (at most once a second, and right away when the page is closed or reloaded) and offers
 * a draft left from before when it differs from the saved layout. `opened` is the plan as the editor opened it.
 */
export function usePlanDraft({ projectId, block, previous, locale, opened, plan, prefs, changed, busy }: { projectId: string; block: string | null; previous: StoredSpatialReference | null; locale: EnergyIqLocale; opened: FloorPlan; plan: FloorPlan; prefs: EditorPrefs; changed: boolean; busy: () => boolean }) {
  const base = fingerprint(block ?? "");
  const [offer, setOffer] = useState<DraftOffer | null>(() => {
    const draft = readDraft(projectId);
    if (!draft) return null;
    try {
      // A draft that is the same as what is saved is nothing to offer.
      const same = layoutText(referenceFromPlan(withPrefs(opened, editorPrefs(opened)), projectId, previous, locale)) === layoutText(draft.reference);
      return same ? null : { savedAt: draft.savedAt, plan: planFromReference(draft.reference, locale), stale: draft.base !== base };
    } catch { return null; }
  });
  const latest = useRef({ plan, prefs, changed });
  useLayoutEffect(() => { latest.current = { plan, prefs, changed }; });
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const write = useCallback(() => {
    const { plan: current, prefs: chosen, changed: dirty } = latest.current;
    if (done.current || !dirty) return;
    // A plan that cannot be saved yet (a name half typed) keeps the last good draft.
    try { writeDraft(projectId, { version: 1, savedAt: Date.now(), base, reference: referenceFromPlan(withPrefs(current, chosen), projectId, previous, locale) }); } catch { /* not a valid plan yet */ }
  }, [projectId, base, previous, locale]);
  const stop = useCallback(() => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } }, []);
  const busyRef = useRef(busy);
  useLayoutEffect(() => { busyRef.current = busy; });
  useEffect(() => {
    // While an earlier draft is being offered, it is left alone until the reader restores or discards it.
    if (offer || done.current) return;
    if (!changed) { stop(); clearPlanDraft(projectId); return; }
    if (timer.current !== null) return;
    const tick = () => { if (busyRef.current()) { timer.current = setTimeout(tick, DRAFT_DELAY); return; } timer.current = null; write(); };
    timer.current = setTimeout(tick, DRAFT_DELAY);
  }, [plan, prefs, changed, offer, projectId, write, stop]);
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
    restore: () => { const plan = offer?.plan ?? null; setOffer(null); return plan; },
    discard: () => { setOffer(null); clearPlanDraft(projectId); },
    /** Saved, or left on purpose without saving: no draft is kept. */
    finish: () => { done.current = true; stop(); clearPlanDraft(projectId); },
  };
}
