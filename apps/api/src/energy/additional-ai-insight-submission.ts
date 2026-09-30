const ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME = "energyiq_additional_insights_submit";

type SubmissionAttempt = {
  name?: string;
  resultIndex?: number;
  result?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseResult = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

/**
 * Returns the one successful native tool submission. Assistant text, literal
 * tool markup, incomplete calls, and duplicate successes all fail closed.
 */
export const collectAdditionalAiInsightSubmission = (
  events: readonly Record<string, unknown>[],
): { candidates: unknown[] } | null => {
  const attempts = new Map<string, SubmissionAttempt>();
  const starts: Array<{ id: string; startIndex: number }> = [];
  for (const [index, event] of events.entries()) {
    const id = nonEmptyString(event.toolCallId)
      ? event.toolCallId
      : nonEmptyString(event.tool_call_id) ? event.tool_call_id : null;
    if (!id) continue;
    const attempt = attempts.get(id) ?? {};
    const name = nonEmptyString(event.toolCallName)
      ? event.toolCallName
      : nonEmptyString(event.tool_call_name) ? event.tool_call_name : undefined;
    if (name) attempt.name = name;
    if (event.type === "TOOL_CALL_START" && name === ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME) {
      starts.push({ id, startIndex: index });
    }
    if (event.type === "TOOL_CALL_RESULT") {
      if (attempt.resultIndex !== undefined) return null;
      attempt.resultIndex = index;
      attempt.result = event.result ?? event.content;
    }
    attempts.set(id, attempt);
  }

  if (starts.length === 0 || new Set(starts.map(({ id }) => id)).size !== starts.length) return null;
  const results = starts.flatMap(({ id, startIndex }) => {
    const attempt = attempts.get(id);
    if (!attempt
      || attempt.name !== ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME
      || attempt.resultIndex === undefined
      || attempt.resultIndex <= startIndex) return [];
    const parsed = parseResult(attempt.result);
    return isRecord(parsed) ? [{ id, parsed, startIndex }] : [];
  });
  if (results.length !== starts.length) return null;
  const successes = results.flatMap(({ id, parsed, startIndex }, attemptIndex) => {
    if (!isRecord(parsed)
      || parsed.ok !== true
      || parsed.resultType !== "additional-ai-insight-submission"
      || !isRecord(parsed.payload)
      || !Array.isArray(parsed.payload.candidates)
      || Object.keys(parsed.payload).length !== 1) return [];
    return [{ candidates: parsed.payload.candidates, attemptIndex, id, startIndex }];
  });
  if (successes.length !== 1 || successes[0]!.attemptIndex !== starts.length - 1) return null;
  const successful = successes[0]!;
  const nonSubmissionCallIds = new Set([...attempts.entries()].flatMap(([id, attempt]) =>
    id !== successful.id && attempt.name !== ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME ? [id] : []));
  const hasPostSubmissionToolActivity = events.slice(successful.startIndex + 1).some((event) => {
    const id = nonEmptyString(event.toolCallId)
      ? event.toolCallId
      : nonEmptyString(event.tool_call_id) ? event.tool_call_id : null;
    return id !== null && nonSubmissionCallIds.has(id);
  });
  return hasPostSubmissionToolActivity ? null : { candidates: successful.candidates };
};
