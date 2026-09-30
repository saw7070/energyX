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
}) => Promise<{ answer: string; sessionId?: string }>;
