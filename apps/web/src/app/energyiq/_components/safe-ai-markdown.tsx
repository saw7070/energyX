import React from "react";
import ReactMarkdown from "react-markdown";

const SAFE_AI_MARKDOWN_ELEMENTS = ["p", "br", "strong", "em"] as const;

const normalizeHarmlessEmphasisWhitespace = (value: string): string => value
  .replace(/(^|[\s(\[{"'“‘])\*\*([^*\n]*?\S)\s+\*\*/gu, "$1**$2**")
  .replace(/(^|[\s(\[{"'“‘])_([^_\n]*?\S)\s+_/gu, "$1_$2_")
  .replaceAll(" **", "\u00a0**")
  .replaceAll(" _", "\u00a0_");

export function SafeAiMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={className} data-safe-ai-markdown="true">
      <ReactMarkdown
        allowedElements={[...SAFE_AI_MARKDOWN_ELEMENTS]}
        skipHtml
        unwrapDisallowed
        components={{
          p: ({ children: paragraph }) => <p className="mb-2 last:mb-0">{paragraph}</p>,
          strong: ({ children: emphasis }) => <strong className="font-semibold text-foreground">{emphasis}</strong>,
          em: ({ children: emphasis }) => <em className="italic text-foreground">{emphasis}</em>,
        }}
      >
        {normalizeHarmlessEmphasisWhitespace(children)}
      </ReactMarkdown>
    </div>
  );
}
