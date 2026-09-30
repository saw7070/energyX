import type { ContextItem } from "../inventory/context-item.js";
import type { RuntimeContextSource } from "./runtime-context-source.js";

const EVIDENCE_FOCUS_SOURCE_TYPE = "evidence-focus";

/** Project server-authoritative evidence into one replaceable run-scoped source. */
export const createEvidenceFocusRuntimeSource = (
  items: ContextItem[]
): RuntimeContextSource | undefined => {
  if (items.length === 0) {
    return undefined;
  }

  return {
    sourceType: EVIDENCE_FOCUS_SOURCE_TYPE,
    collect: () => items.map((item) => ({
      ...item,
      sourceType: EVIDENCE_FOCUS_SOURCE_TYPE,
      metadata: {
        ...item.metadata,
        originalSourceType: item.sourceType
      }
    }))
  };
};
