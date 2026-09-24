import { REVIEW_LIMITS } from "../review/validate";

const suggestion = {
  type: "object",
  additionalProperties: false,
  required: ["from", "options", "note"],
  properties: {
    from: { type: "string", minLength: 1, maxLength: REVIEW_LIMITS.from },
    occurrence: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    options: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: REVIEW_LIMITS.option },
    },
    note: { type: "string", minLength: 1, maxLength: REVIEW_LIMITS.note },
  },
} as const;

/** The provider-neutral schema embedded in every analysis prompt. */
export const agentResponseSchema = {
  // Claude Code's --json-schema accepts draft-07; the keywords below are shared
  // with the provider-neutral prompt schema.
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["title", "level1", "level2"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: REVIEW_LIMITS.title },
    level1: { type: "array", maxItems: REVIEW_LIMITS.suggestionsPerLevel, items: suggestion },
    level2: { type: "array", maxItems: REVIEW_LIMITS.suggestionsPerLevel, items: suggestion },
  },
} as const;
