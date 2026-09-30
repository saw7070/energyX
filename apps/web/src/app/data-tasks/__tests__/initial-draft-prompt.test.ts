import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => {
  const cwdPath = join(process.cwd(), path);
  const webWorkspacePath = join(process.cwd(), "apps/web", path);

  return readFileSync(existsSync(cwdPath) ? cwdPath : webWorkspacePath, "utf8")
    .replaceAll("\r\n", "\n");
};

describe("DataTasksApp initial composer draft", () => {
  it("passes initialDraftPrompt to one lazy composer draft request", () => {
    const page = source("src/app/data-tasks/data-tasks-app.tsx");
    const helperStart = page.indexOf("export function createInitialDraftPromptRequest");
    const helperEnd = page.indexOf("export default function DataTasksApp", helperStart);
    const helper = page.slice(helperStart, helperEnd);

    expect(helper).toContain("const text = initialDraftPrompt?.trim()");
    expect(helper).toContain("return text ? { id: 1, text } : null");
    expect(helper).not.toContain("runAgent");
    expect(page).toContain("initialDraftPrompt?: string");
    expect(page).toContain("initialDraftPrompt={initialDraftPrompt}");
    expect(page).toContain("useState<{\n    id: number;\n    text: string;\n  } | null>(() => createInitialDraftPromptRequest(initialDraftPrompt))");
  });

  it("prefills the textarea without automatically submitting or starting a Run", () => {
    const chatInput = source("src/app/data-tasks/components/chat/DataTaskChatInput.tsx");
    const effectStart = chatInput.indexOf("if (!draftPromptRequest || mode !== \"input\") return");
    const effectEnd = chatInput.indexOf("const focusTextArea", effectStart);
    const prefillEffect = chatInput.slice(effectStart, effectEnd);

    expect(prefillEffect).toContain("draftPromptRequest.text");
    expect(prefillEffect).toContain("requestAnimationFrame(applyDraft)");
    expect(prefillEffect).toContain("cancelAnimationFrame(frameId)");
    expect(prefillEffect).toContain("dispatchEvent(new Event(\"input\"");
    expect(prefillEffect).toContain("onDraftPromptConsumed(draftPromptRequest.id)");
    expect(prefillEffect).not.toContain("onSubmitMessage");
    expect(prefillEffect).not.toContain("runAgent");
  });
});
