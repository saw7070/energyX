/** Keep the report probe and Pi bridge on the same provider request contract. */
export function reportChatRequest(
  model: { model: string; baseUrl: string },
  body: Record<string, unknown>,
): Record<string, unknown> {
  const request: Record<string, unknown> = { ...body, model: model.model };
  if (new URL(model.baseUrl).hostname === "api.openai.com" && /^gpt-5\.6(?:-|$)/.test(model.model)) {
    if (request.max_tokens !== undefined) {
      request.max_completion_tokens ??= request.max_tokens;
      delete request.max_tokens;
    }
    // The existing report harness uses thinkingLevel=off. GPT-5.6 tool calls
    // on Chat Completions require this explicit setting; reasoning needs Responses.
    request.reasoning_effort = "none";
  }
  return request;
}
