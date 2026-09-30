import {
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AiFindingPresentation,
  type AiPresentationBlock,
  type AiPresentationDisplayIntent,
  type AiPresentationValueItem,
} from "@datafoundry/contracts";

export {
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AiFindingPresentation,
  type AiPresentationBlock,
  type AiPresentationDisplayIntent,
  type AiPresentationValueItem,
};

export const AI_FINDING_PRESENTATION_PROMPT = [
  "For each Finding, use zero or more presentation v1 blocks only when clearer; no theme or primary-block quota; never emit executable HTML/JS/CSS/React.",
  "Set optional prominence:'primary' on every block essential to initial reading and 'supporting' only on secondary detail. Any number may be primary; omission means primary.",
  "Block types: metric(label,value); comparison/ranking/share/distribution(items); trend(points); heatmap(xLabels,yLabels,values); table(columns,rows); callout(tone,text). Use the key type, never shape. Optional fields: title,unit,context,prominence. Every quantitative block must cite that Finding's evidenceRefs/evidenceSqlIndexes and preserve metric, label, unit and meaning.",
].join("\n");

export function aiFindingPresentationEvidenceText(presentation: AiFindingPresentation | null | undefined): string {
  if (!presentation) return "";
  return presentation.blocks.flatMap((block) => {
    switch (block.type) {
      case "metric":
        return [block.label, block.value, block.unit, block.context];
      case "comparison":
      case "ranking":
      case "share":
      case "distribution":
        return [block.title, block.unit, ...block.items.flatMap((item) => [item.label, item.value])];
      case "trend":
        return [block.title, block.unit, ...block.points.flatMap((point) => [point.label, point.value])];
      case "heatmap":
        return [block.title, block.unit, ...block.xLabels, ...block.yLabels, ...block.values.flat()];
      case "table":
        return [block.title, ...block.columns, ...block.rows.flat()];
      case "callout":
        return [block.text];
    }
  }).filter((part): part is string | number => typeof part === "number" || Boolean(part)).join(" ");
}
