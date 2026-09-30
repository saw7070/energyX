export const AI_SLOT_HTML_ARTIFACT_CONTRACT = "energyiq-ai-slot-html-artifact@1" as const;

export type PreschoolHtmlAiSlotId =
  | "executive-summary"
  | "centre-benchmark"
  | "standby-wastage"
  | "operating-behaviour"
  | "planning-outlook"
  | "additional-insight";

export const PRESCHOOL_HTML_AI_SLOT_IDS: readonly PreschoolHtmlAiSlotId[] = [
  "executive-summary",
  "centre-benchmark",
  "standby-wastage",
  "operating-behaviour",
  "planning-outlook",
  "additional-insight",
];

export const AI_SLOT_HTML_LIMITS = {
  maxBytes: 96_000,
  minHeightPx: 160,
  maxHeightPx: 1_200,
} as const;

export type AiSlotHtmlArtifactIdentity = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  /** Present for current Report Editions; absent only for historical identities. */
  reportTimePolicyId?: string;
  reportTimePolicyRevision?: string;
  reportTimeContextFingerprint?: string;
  modelProfileId: string;
  modelProfileRevision: number;
  promptRevision: string;
  slotDefinitionRevision: string;
};

export type AiSlotHtmlArtifact = {
  contract: typeof AI_SLOT_HTML_ARTIFACT_CONTRACT;
  slotId: string;
  identity: AiSlotHtmlArtifactIdentity;
  evidenceRefs: string[];
  preferredHeightPx?: number;
  accessibleText: string;
  html: string;
};

export type AiSlotHtmlArtifactRejectionReason =
  | "AI_SLOT_HTML_MALFORMED"
  | "AI_SLOT_HTML_IDENTITY_MISMATCH"
  | "AI_SLOT_HTML_EVIDENCE_INVALID"
  | "AI_SLOT_HTML_UNSAFE"
  | "AI_SLOT_HTML_TOO_LARGE";

export type AiSlotHtmlArtifactAcceptance =
  | { accepted: true; artifact: AiSlotHtmlArtifact }
  | { accepted: false; reason: AiSlotHtmlArtifactRejectionReason };

export const acceptAiSlotHtmlArtifact = (input: {
  candidate: unknown;
  expected: { slotId: string; identity: AiSlotHtmlArtifactIdentity };
  allowedEvidenceRefs: readonly string[];
}): AiSlotHtmlArtifactAcceptance => {
  if (!isRecord(input.candidate)
    || input.candidate.contract !== AI_SLOT_HTML_ARTIFACT_CONTRACT
    || typeof input.candidate.slotId !== "string"
    || !isRecord(input.candidate.identity)
    || typeof input.candidate.html !== "string"
    || !input.candidate.html.trim()
    || !uniqueNonEmptyStrings(input.candidate.evidenceRefs)
    || (input.candidate.preferredHeightPx !== undefined
      && !validPreferredHeight(input.candidate.preferredHeightPx))) {
    return { accepted: false, reason: "AI_SLOT_HTML_MALFORMED" };
  }

  if (input.candidate.slotId !== input.expected.slotId
    || !sameIdentity(input.candidate.identity, input.expected.identity)) {
    return { accepted: false, reason: "AI_SLOT_HTML_IDENTITY_MISMATCH" };
  }
  const allowed = new Set(input.allowedEvidenceRefs);
  if (!input.candidate.evidenceRefs.every((ref) => allowed.has(ref))) {
    return { accepted: false, reason: "AI_SLOT_HTML_EVIDENCE_INVALID" };
  }
  if (new TextEncoder().encode(input.candidate.html).byteLength > AI_SLOT_HTML_LIMITS.maxBytes) {
    return { accepted: false, reason: "AI_SLOT_HTML_TOO_LARGE" };
  }
  if (!isStaticSandboxHtml(input.candidate.html)) {
    return { accepted: false, reason: "AI_SLOT_HTML_UNSAFE" };
  }

  const artifact = input.candidate as unknown as Omit<AiSlotHtmlArtifact, "accessibleText">;
  return {
    accepted: true,
    artifact: {
      ...artifact,
      accessibleText: stripAiSlotHtmlToAccessibleText(artifact.html),
    },
  };
};

export const isStaticSandboxHtml = (html: string): boolean => {
  const normalizedHtml = decodeCssEscapes(decodeHtmlEntities(html));
  if (!hasOnlyAllowedSlotMarkup(normalizedHtml)) return false;
  if (/<\s*\/?\s*(?:script|iframe|object|embed|form|input|textarea|select|option|meta|base|link|audio|video|source|a|button|img)\b/iu.test(normalizedHtml)) return false;
  // V1 rendering is host-styled. Model CSS can recolour, resize, move or clip
  // factual text in browser-dependent ways, so no model stylesheet or inline
  // style is accepted. Graphics are deferred; V1 accepts semantic HTML only.
  if (/<\s*\/?\s*style\b|\sstyle\s*=/iu.test(normalizedHtml)) return false;
  if (/<\s*\/?\s*(?:text|tspan|foreignObject)\b/iu.test(normalizedHtml)) return false;
  if (/(?:\shidden(?:\s|=|>)|\saria-hidden\s*=\s*(?:"true"|'true'|true)(?:\s|>))/iu.test(normalizedHtml)) return false;
  if (/\son[a-z][a-z0-9_-]*\s*=/iu.test(normalizedHtml)) return false;
  if (/\b(?:javascript|vbscript)\s*:/iu.test(normalizedHtml)) return false;
  if (/\bdata\s*:\s*text\/html/iu.test(normalizedHtml)) return false;
  if (/(?:@import|url\s*\()/iu.test(normalizedHtml)) return false;

  const resourceAttributes = normalizedHtml.matchAll(/\b(src|srcset|imagesrcset|href|xlink:href|action|formaction|poster|srcdoc)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu);
  for (const match of resourceAttributes) {
    const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (value.startsWith("#")) continue;
    if (/^data:image\//iu.test(value)) return false;
    return false;
  }
  return true;
};

const ALLOWED_SLOT_HTML_TAGS = new Set([
  "main", "article", "section", "div", "h1", "h2", "h3", "h4", "p", "strong", "em", "span", "small", "mark", "blockquote",
  "ul", "ol", "li", "dl", "dt", "dd", "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td",
  "figure", "figcaption", "details", "summary", "time", "br", "hr",
]);
const ALLOWED_SLOT_GLOBAL_ATTRIBUTES = new Set([
  "class", "data-fact-ids", "id",
]);
const ALLOWED_SLOT_TABLE_ATTRIBUTES = new Set(["colspan", "headers", "rowspan", "scope", "span"]);

const hasOnlyAllowedSlotMarkup = (html: string): boolean => {
  if (/<!--[\s\S]*?-->|<!\s*(?:doctype|\[cdata)|<\?/iu.test(html)) return false;
  const tagPattern = /<\s*(\/?)\s*([a-z][a-z0-9-]*)\b([^>]*)>/giu;
  for (const match of html.matchAll(tagPattern)) {
    const closing = match[1] === "/";
    const tag = match[2]!.toLocaleLowerCase();
    if (!ALLOWED_SLOT_HTML_TAGS.has(tag)) return false;
    if (closing) {
      if (match[3]!.trim().length > 0) return false;
      continue;
    }
    const attributes = parseSlotAttributes(match[3]!);
    if (!attributes || attributes.some((attribute) => !isAllowedSlotAttribute(tag, attribute))) return false;
  }
  return true;
};

const parseSlotAttributes = (source: string): string[] | undefined => {
  const names: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    if (source[cursor] === "/" && source.slice(cursor + 1).trim().length === 0) break;
    const name = /^[a-z_:][a-z0-9_.:-]*/iu.exec(source.slice(cursor));
    if (!name) return undefined;
    const normalizedName = name[0]!.toLocaleLowerCase();
    if (names.includes(normalizedName)) return undefined;
    names.push(normalizedName);
    cursor += name[0]!.length;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") continue;
    cursor += 1;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, cursor + 1);
      if (end < 0) return undefined;
      cursor = end + 1;
      continue;
    }
    const value = /^[^\s"'=<>`]+/u.exec(source.slice(cursor));
    if (!value) return undefined;
    cursor += value[0]!.length;
  }
  return names;
};

const isAllowedSlotAttribute = (tag: string, attribute: string): boolean => {
  if (ALLOWED_SLOT_GLOBAL_ATTRIBUTES.has(attribute)) return true;
  if (tag === "details" && attribute === "open") return true;
  if (tag === "time" && attribute === "datetime") return true;
  return ["col", "colgroup", "td", "th"].includes(tag) && ALLOWED_SLOT_TABLE_ATTRIBUTES.has(attribute);
};

const decodeHtmlEntities = (value: string): string => {
  let decoded = value;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decoded
      .replace(/&#x([0-9a-f]{1,6});/giu, (match, hex: string) => decodeCodePoint(match, Number.parseInt(hex, 16)))
      .replace(/&#([0-9]{1,7});/gu, (match, decimal: string) => decodeCodePoint(match, Number.parseInt(decimal, 10)))
      .replace(/&(amp|apos|colon|gt|lt|nbsp|quot);/giu, (match, name: string) => ({
        amp: "&",
        apos: "'",
        colon: ":",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: '"',
      }[name.toLowerCase()] ?? match));
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
};

const decodeCssEscapes = (value: string): string => value
  .replace(/\\([0-9a-f]{1,6})(?:[ \t\r\n\f])?/giu, (match, hex: string) => decodeCodePoint(match, Number.parseInt(hex, 16)))
  .replace(/\\([^\r\n\f])/gu, "$1");

const decodeCodePoint = (original: string, value: number): string => {
  try {
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value)
      : original;
  } catch {
    return original;
  }
};

export const stripAiSlotHtmlToAccessibleText = (html: string): string => {
  const attributes = [...html.matchAll(/\s(?:aria-label|alt|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)]
    .map((match) => match[1] ?? match[2] ?? "");
  return `${html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<\s*(?:style|script)\b[^>]*>[\s\S]*?<\/\s*(?:style|script)\s*>/giu, " ")
    .replace(/<[^>]*>/gu, " ")} ${attributes.join(" ")}`
    .replace(/&nbsp;/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
};

const sameIdentity = (
  candidate: Record<string, unknown>,
  expected: AiSlotHtmlArtifactIdentity,
): boolean => candidate.workspaceId === expected.workspaceId
  && candidate.projectId === expected.projectId
  && candidate.scopeId === expected.scopeId
  && candidate.dataSnapshotId === expected.dataSnapshotId
  && candidate.projectReleaseId === expected.projectReleaseId
  && candidate.reportTimePolicyId === expected.reportTimePolicyId
  && candidate.reportTimePolicyRevision === expected.reportTimePolicyRevision
  && candidate.reportTimeContextFingerprint === expected.reportTimeContextFingerprint
  && candidate.modelProfileId === expected.modelProfileId
  && candidate.modelProfileRevision === expected.modelProfileRevision
  && candidate.promptRevision === expected.promptRevision
  && candidate.slotDefinitionRevision === expected.slotDefinitionRevision
  && isRecord(candidate.analysisPeriod)
  && candidate.analysisPeriod.from === expected.analysisPeriod.from
  && candidate.analysisPeriod.to === expected.analysisPeriod.to;

const uniqueNonEmptyStrings = (value: unknown): value is string[] => Array.isArray(value)
  && value.length > 0
  && value.every((item) => typeof item === "string" && Boolean(item.trim()))
  && new Set(value).size === value.length;

const validPreferredHeight = (value: unknown): value is number => typeof value === "number"
  && Number.isInteger(value)
  && value >= AI_SLOT_HTML_LIMITS.minHeightPx
  && value <= AI_SLOT_HTML_LIMITS.maxHeightPx;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
