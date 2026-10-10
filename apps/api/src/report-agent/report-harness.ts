/** Report delivery depends on execution capability, not a provider's wire protocol. */
export type ReportHarness = (input: {
  directory: string;
  runId: string;
  prompt: string;
  signal: AbortSignal;
  previousStateDirectory?: string;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  executeTool?: (name: string, args: unknown) => Promise<unknown>;
  onEvent?: (event: { type: string; tool?: string; isError?: boolean; text?: string }) => void;
  /** The organisation the run is for: its AI settings choose the model. */
  workspaceId?: string;
  /** Called after each model response with the tokens it used, when the provider reports them. */
  onUsage?: (usage: { model: string; inputTokens: number; outputTokens: number }) => void;
}) => Promise<{ answer: string; sessionId?: string }>;
