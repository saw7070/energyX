export type DataTaskInteractionGateState = {
  generation: number;
  disabledReason: string | null;
};

const STALE_INTERACTION_REASON =
  "Analysis context changed before this action could run.";

export function advanceDataTaskInteractionGate(
  current: DataTaskInteractionGateState,
  disabledReason: string | null,
): DataTaskInteractionGateState {
  const crossedInteractionBoundary = (current.disabledReason === null)
    !== (disabledReason === null);
  return {
    generation: current.generation + (crossedInteractionBoundary ? 1 : 0),
    disabledReason,
  };
}

export function resolveDataTaskInteractionBlockReason(
  current: DataTaskInteractionGateState,
  capturedGeneration: number,
): string | null {
  if (current.disabledReason) {
    return current.disabledReason;
  }
  return capturedGeneration === current.generation
    ? null
    : STALE_INTERACTION_REASON;
}

export function runDataTaskInteractionMutation<T>(input: {
  capturedGeneration: number;
  getBlockReason: (capturedGeneration: number) => string | null;
  mutation: () => T;
}): { status: "blocked"; reason: string } | { status: "started"; value: T } {
  const reason = input.getBlockReason(input.capturedGeneration);
  if (reason) return { status: "blocked", reason };
  return { status: "started", value: input.mutation() };
}

export async function runDataTaskInteractionMutationAfterAwait<T>(input: {
  capturedGeneration: number;
  getBlockReason: (capturedGeneration: number) => string | null;
  beforeMutation: () => void | Promise<void>;
  mutation: () => T;
}): Promise<{ status: "blocked"; reason: string } | { status: "started"; value: T }> {
  await input.beforeMutation();
  return runDataTaskInteractionMutation(input);
}
