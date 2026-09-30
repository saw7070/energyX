export type InsightMethodScope = "builtin" | "user" | "workspace";

export type InsightMethodRole = "core-method" | "expert-direction";

/**
 * Immutable identity of the exact Skill/config resource content used by one run.
 * semanticVersion is descriptive; resourceRevision and contentSha256 fence reuse.
 */
export type InsightMethodRevisionRef = {
  skillId: string;
  semanticVersion: string;
  resourceId: string;
  resourceRevision: number;
  contentSha256: string;
  scope: InsightMethodScope;
  workspaceId: string;
  userId: string;
  role: InsightMethodRole;
};

type AutonomousInsightOriginBase = {
  coreMethod: InsightMethodRevisionRef;
};

export type AutonomousInsightOrigin =
  | (AutonomousInsightOriginBase & {
    kind: "ai-discovery";
    directionMethods: readonly [];
  })
  | (AutonomousInsightOriginBase & {
    kind: "expert-sop";
    directionMethods: readonly [InsightMethodRevisionRef, ...InsightMethodRevisionRef[]];
  })
  | (AutonomousInsightOriginBase & {
    kind: "hybrid";
    directionMethods: readonly [InsightMethodRevisionRef, ...InsightMethodRevisionRef[]];
    novelContribution: string;
  });

export type InsightMethodExecutionTrace = {
  approvedMethods: readonly InsightMethodRevisionRef[];
  loadedMethods: readonly InsightMethodRevisionRef[];
};

export type AutonomousInsightOriginValidationInput = InsightMethodExecutionTrace & {
  origin: unknown;
};

export type AutonomousInsightArtifactReuseInput = {
  requestedMethods: readonly InsightMethodRevisionRef[];
  artifactMethods: readonly InsightMethodRevisionRef[];
};

const NON_EMPTY = /\S/;
const SHA256 = /^[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === "string" && NON_EMPTY.test(value)
);

export const insightMethodRevisionRefIsValid = (
  value: unknown,
): value is InsightMethodRevisionRef => {
  if (!isRecord(value)) {
    return false;
  }
  return isNonEmptyString(value.skillId)
    && isNonEmptyString(value.semanticVersion)
    && isNonEmptyString(value.resourceId)
    && Number.isSafeInteger(value.resourceRevision)
    && (value.resourceRevision as number) > 0
    && typeof value.contentSha256 === "string"
    && SHA256.test(value.contentSha256)
    && (value.scope === "builtin" || value.scope === "user" || value.scope === "workspace")
    && isNonEmptyString(value.workspaceId)
    && isNonEmptyString(value.userId)
    && (value.role === "core-method" || value.role === "expert-direction");
};

export const sameInsightMethodRevision = (
  left: InsightMethodRevisionRef,
  right: InsightMethodRevisionRef,
): boolean => (
  left.skillId === right.skillId
  && left.semanticVersion === right.semanticVersion
  && left.resourceId === right.resourceId
  && left.resourceRevision === right.resourceRevision
  && left.contentSha256 === right.contentSha256
  && left.scope === right.scope
  && left.workspaceId === right.workspaceId
  && left.userId === right.userId
  && left.role === right.role
);

const containsExactMethod = (
  methods: readonly InsightMethodRevisionRef[],
  expected: InsightMethodRevisionRef,
) => methods.some((method) => sameInsightMethodRevision(method, expected));

const containsDuplicateMethods = (
  methods: readonly InsightMethodRevisionRef[],
) => methods.some((method, index) => (
  methods.slice(index + 1).some((candidate) => sameInsightMethodRevision(method, candidate))
));

const validMethodSet = (
  methods: readonly InsightMethodRevisionRef[],
) => methods.every(insightMethodRevisionRefIsValid) && !containsDuplicateMethods(methods);

export const autonomousInsightOriginIsValid = (
  input: AutonomousInsightOriginValidationInput,
): boolean => {
  const { origin, approvedMethods, loadedMethods } = input;
  if (!isRecord(origin)
    || !insightMethodRevisionRefIsValid(origin.coreMethod)
    || origin.coreMethod.role !== "core-method"
    || !Array.isArray(origin.directionMethods)
    || !validMethodSet(approvedMethods)
    || !validMethodSet(loadedMethods)) {
    return false;
  }

  const directionMethods = origin.directionMethods;
  if (!directionMethods.every(insightMethodRevisionRefIsValid)
    || directionMethods.some((method) => method.role !== "expert-direction")
    || containsDuplicateMethods(directionMethods)) {
    return false;
  }

  const referencedMethods = [origin.coreMethod, ...directionMethods];
  if (!referencedMethods.every((method) => (
    containsExactMethod(approvedMethods, method) && containsExactMethod(loadedMethods, method)
  ))) {
    return false;
  }

  if (origin.kind === "ai-discovery") {
    return directionMethods.length === 0;
  }
  if (origin.kind === "expert-sop") {
    return directionMethods.length > 0;
  }
  if (origin.kind === "hybrid") {
    return directionMethods.length > 0 && isNonEmptyString(origin.novelContribution);
  }
  return false;
};

export const canReuseAutonomousInsightArtifact = ({
  requestedMethods,
  artifactMethods,
}: AutonomousInsightArtifactReuseInput): boolean => {
  if (requestedMethods.length !== artifactMethods.length
    || !validMethodSet(requestedMethods)
    || !validMethodSet(artifactMethods)) {
    return false;
  }
  return requestedMethods.every((method) => containsExactMethod(artifactMethods, method));
};
