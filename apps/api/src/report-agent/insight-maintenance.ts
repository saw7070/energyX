import type { KeyPointPublication } from "./key-point-store.js";

/** Read-only planning context; missing evidence never marks an issue resolved. */
export function insightMaintenanceContext(
  actions: Array<{id:string;state:string}>,
  publication: KeyPointPublication | null,
  dataEndExclusive: string,
) {
  return {
    dataEndExclusive, recommendationLimit: 6, homepageLimit: 3,
    instructions: "Recheck every existing recommendation during this analysis. Revalidate entries flagged stale before recommending them. Following-up and history entries do not consume recommendation slots. Omission from the next shortlist does not mean resolved. Preserve user execution states.",
    entries: actions.map(action => {
      const item = publication?.selection.active.find(value=>value.actionId===action.id);
      const ageDays = item ? Math.max(0, (Date.parse(dataEndExclusive)-Date.parse(item.evidenceToExclusive))/86400000) : null;
      const group = ["scheduled","implemented"].includes(action.state) ? "following_up"
        : ["paused","declined"].includes(action.state) ? "history" : "considering";
      return {actionId:action.id,group,state:action.state,
        lastEvidenceEndExclusive:item?.evidenceToExclusive ?? null,
        needsRevalidation:group==="considering" && (ageDays===null || ageDays>=14),
        previousSelectionReason:item?.reason ?? null};
    }),
  };
}
