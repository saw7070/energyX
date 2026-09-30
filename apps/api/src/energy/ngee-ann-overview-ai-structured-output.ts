import type { PublicStructuredOutputOptions } from "@mastra/core/agent";

import { NGEE_ANN_SECTION_IDS } from "./ngee-ann-section-pack.js";

type StructuredEnvelope = Record<string, unknown>;

export const NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "warn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sectionId", "status", "candidates"],
    properties: {
      sectionId: { type: "string", enum: [...NGEE_ANN_SECTION_IDS] },
      status: { type: "string", enum: ["available", "empty"] },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidenceRefs"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 480 },
          evidenceRefs: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
        },
      },
      candidates: {
        type: "array",
        minItems: 0,
        maxItems: 12,
        items: { type: "object" },
      },
      limitation: { type: "string", minLength: 1, maxLength: 320 },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

export const NGEE_ANN_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "warn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "findings"],
    properties: {
      status: { type: "string", enum: ["available", "empty"] },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidenceRefs"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: 600 },
          evidenceRefs: {
            type: "array", minItems: 1, uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
        },
      },
      findings: { type: "array", minItems: 0, maxItems: 12, items: { type: "object" } },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;
