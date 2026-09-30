/** @vitest-environment happy-dom */
import React, { act, useState, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReportFilePreview, type PreviewFile } from "./report-file-preview";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const file: PreviewFile = {
  id: "one",
  title: "Office report",
  filename: "office.html",
  mimeType: "text/html",
  load: async () => ({
    content: "<h1>Office</h1><script>window.test=1</script>",
  }),
};
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open report</button>
      {open && <ReportFilePreview file={file} onClose={() => setOpen(false)} />}
    </>
  );
}
async function click(label: string) {
  await act(async () => {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label,
    )!;
    button.focus();
    button.click();
  });
}
it("opens in the right pane, switches source, expands and returns to the same file on Escape", async () => {
  await act(async () => root.render(<Harness />));
  await click("Open report");
  expect(container.querySelector("aside")).not.toBeNull();
  await click("Source");
  expect(container.querySelector("pre")?.textContent).toContain(
    "<h1>Office</h1>",
  );
  await click("Preview");
  await click("Expand");
  expect(container.querySelector("dialog[open]")).not.toBeNull();
  await act(async () =>
    container
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true })),
  );
  expect(
    container.querySelector("dialog")?.getAttribute("aria-modal"),
  ).toBeNull();
  expect(
    container.querySelector("aside iframe")?.getAttribute("srcdoc"),
  ).toContain("Office");
  await click("Close");
  expect(container.querySelector("aside")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Open report");
});
it("downloads HTML with its CSP and an HTML filename", async () => {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const anchor = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("office.html");
    });
  await act(async () => root.render(<Harness />));
  await click("Open report");
  await click("Download");
  expect(anchor).toHaveBeenCalledOnce();
  const blob = create.mock.calls[0]![0] as Blob;
  expect(await blob.text()).toContain("connect-src 'none'");
});
it("aborts an old file load so it cannot replace the new preview", async () => {
  let resolve: (value: { content: string }) => void = () => {};
  let signal: AbortSignal | undefined;
  await act(async () =>
    root.render(
      <ReportFilePreview
        file={{
          ...file,
          load: (s) => {
            signal = s;
            return new Promise((r) => {
              resolve = r;
            });
          },
        }}
        onClose={() => {}}
      />,
    ),
  );
  await act(async () =>
    root.render(
      <ReportFilePreview
        file={{
          ...file,
          id: "two",
          load: async () => ({ content: "New report" }),
        }}
        onClose={() => {}}
      />,
    ),
  );
  await act(async () => resolve({ content: "Old report" }));
  expect(signal?.aborted).toBe(true);
  expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain(
    "New report",
  );
  expect(
    container.querySelector("iframe")?.getAttribute("srcdoc"),
  ).not.toContain("Old report");
});

it("hides Markdown frontmatter in Preview while preserving complete Source", async () => {
  const content =
    "---\nname: office-method\ndescription: Analyze office loads\n---\n# Office analysis\n\nUse this method.";
  await act(async () =>
    root.render(
      <ReportFilePreview
        file={{
          ...file,
          mimeType: "text/markdown",
          load: async () => ({ content }),
        }}
        onClose={() => {}}
      />,
    ),
  );
  expect(container.textContent).toContain("Office analysis");
  expect(container.textContent).not.toContain("name: office-method");
  await click("Source");
  expect(container.querySelector("pre")?.textContent).toBe(content);
});

it("preserves the same action form, feedback and report across tabs, expansion and breakpoints", async () => {
  let width = 1440;
  const queries: Array<{ media: string; update: () => void }> = [];
  vi.spyOn(window, "matchMedia").mockImplementation(
    (media) =>
      ({
        get matches() {
          return media.includes("min-width") ? width >= 1100 : width <= 767;
        },
        media,
        addEventListener: (_type: string, update: () => void) =>
          queries.push({ media, update }),
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  const mounts = vi.fn(),
    unmounts = vi.fn();
  function StatefulAction() {
    const [draft, setDraft] = useState("");
    const [feedback, setFeedback] = useState(false);
    useEffect(() => {
      mounts();
      return unmounts;
    }, []);
    return (
      <>
        <textarea
          aria-label="Action draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button onClick={() => setFeedback(true)}>Open feedback</button>
        {feedback && (
          <iframe title="Selected feedback" srcDoc="<p>Observed results</p>" />
        )}
      </>
    );
  }
  await act(async () =>
    root.render(
      <ReportFilePreview
        file={file}
        actions={<StatefulAction />}
        onClose={() => {}}
      />,
    ),
  );
  const reportFrame = container.querySelector(
    'iframe[title="HTML report preview"]',
  );
  const dialogNode = container.querySelector("dialog");
  await click("Actions");
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, "Retain my unsent plan");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Open feedback");
  const feedbackFrame = container.querySelector(
    'iframe[title="Selected feedback"]',
  );
  await click("Expand");
  expect(container.querySelector('[data-layout="split"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Report"][hidden]')).toBeNull();
  expect(container.querySelector('[aria-label="Actions"][hidden]')).toBeNull();
  await act(async () => {
    width = 390;
    queries.forEach((q) => q.update());
  });
  expect(container.querySelector('[data-layout="tabs"]')).not.toBeNull();
  await click("Report");
  expect(textarea.closest("section")?.hidden).toBe(true);
  await click("Actions");
  expect(textarea.value).toBe("Retain my unsent plan");
  await act(async () => {
    width = 1440;
    queries.forEach((q) => q.update());
  });
  await click("Exit fullscreen");
  expect(container.querySelector("dialog")).toBe(dialogNode);
  expect(container.querySelector("textarea")).toBe(textarea);
  expect(container.querySelector('iframe[title="Selected feedback"]')).toBe(
    feedbackFrame,
  );
  expect(container.querySelector('iframe[title="HTML report preview"]')).toBe(
    reportFrame,
  );
  expect(mounts).toHaveBeenCalledOnce();
  expect(unmounts).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Read report");
});

it("supports predictable keyboard tab selection without changing labels", async () => {
  await act(async () =>
    root.render(
      <ReportFilePreview
        file={file}
        actions={<input aria-label="Action input" />}
        onClose={() => {}}
      />,
    ),
  );
  const report = container.querySelector<HTMLButtonElement>(
    '[role="tab"][aria-controls$="-report"]',
  )!;
  const actions = container.querySelector<HTMLButtonElement>(
    '[role="tab"][aria-controls$="-actions"]',
  )!;
  await act(async () =>
    report.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    ),
  );
  expect(actions.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(actions);
  await act(async () =>
    actions.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    ),
  );
  expect(report.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(report);
  expect(actions.textContent).toBe("Actions");
  expect(report.textContent).toBe("Report");
});

it("keeps the action side selected when a focused split pane becomes narrow", async () => {
  let width = 1440;
  const listeners: Array<() => void> = [];
  vi.spyOn(window, "matchMedia").mockImplementation(
    (media) =>
      ({
        get matches() {
          return media.includes("min-width") ? width >= 1100 : width <= 767;
        },
        media,
        addEventListener: (_: string, callback: () => void) =>
          listeners.push(callback),
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  await act(async () =>
    root.render(
      <ReportFilePreview
        file={file}
        actions={<textarea aria-label="Plan" />}
        onClose={() => {}}
      />,
    ),
  );
  await click("Expand");
  await act(async () => container.querySelector("textarea")!.focus());
  await act(async () => {
    width = 900;
    listeners.forEach((listener) => listener());
  });
  expect(
    container
      .querySelector('[aria-controls$="-actions"]')
      ?.getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    container
      .querySelector('section[aria-label="Actions"]')
      ?.hasAttribute("hidden"),
  ).toBe(false);
});
