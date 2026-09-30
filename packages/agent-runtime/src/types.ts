import type { BaseEvent } from "@ag-ui/core";
import type { EvidenceRef } from "@datafoundry/contracts";
import type { TrustedEnergyTextQueryContract } from "./semantic/trusted-energy-text.js";

/** Per-run @ mention focus (R-019). Each kind lists focused IDs (subset of enabled*Ids). */
export type PerRunMention = {
  db: string[];
  kb: string[];
  mcp: string[];
  skill: string[];
};

export type AgentEnergyQueryContext = {
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  resource: "electricity" | "water";
  timezone: string;
  from: string;
  to: string;
  endExclusive: true;
  period: "Yesterday" | "Last 7 days" | "Last 30 days" | "Previous week" | "Previous month" | "Custom";
  dataSnapshotId?: string;
  metricVersion?: string;
};

export type AgentRunContext = {
  active_skill_id?: string;
  user_id: string;
  workspace_id?: string;
  session_id: string;
  run_id: string;
  user_input: string;
  chat_mode: string;
  selected_datasource_id?: string;
  enabled_datasource_ids?: string[];
  enabled_knowledge_ids?: string[];
  enabled_mcp_server_ids?: string[];
  requested_llm_profile_id?: string;
  model_name?: string;
  /** Provider-neutral reasoning switch resolved from the selected model profile. */
  reasoning_model?: boolean;
  /** Per-run @ mentions (R-019) — focus signal, not a narrowing of enabled*Ids. */
  mentioned?: PerRunMention;
  /** Per-run pinned session-relative paths (R-024). */
  pinned_paths?: string[];
  /** User-selected evidence references for this run. Concrete content is resolved server-side. */
  evidence_refs?: EvidenceRef[];
  /** Server-authoritative EnergyIQ project, scope, time range and version pins. */
  energy_query_context?: AgentEnergyQueryContext | TrustedEnergyTextQueryContract;
};

export type AgentRunContextInput = AgentRunContext;

export interface AgUiEventEmitter {
  emit(event: BaseEvent): void;
}
