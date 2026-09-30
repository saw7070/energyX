import {
  applyInsightFindingFeedback,
  approveInsightMethodProposal,
  canonicalInsightMethodSetJson,
  insightMethodRevisionRefIsValid,
  publishApprovedInsightMethodProposal,
  resolveCurrentAdditionalAiInsightMethodSet,
  submitInsightMethodProposalForReview,
  type AdditionalAiInsightMethodResource,
  type InsightFindingFeedbackRating,
  type InsightFindingFeedbackRecord,
  type InsightMethodProposal,
  type InsightMethodPromotionStatus,
  type InsightMethodRevisionRef,
} from "@datafoundry/contracts";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type EnergyIqInsightFindingFeedbackRecord = InsightFindingFeedbackRecord & { id: string };

export type EnergyIqInsightFindingCommentRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  artifactId: string;
  artifactIdentityHash: string;
  artifactIdentityRevision: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  findingId: string;
  actorId: string;
  text: string;
  createdAt: string;
};

export type EnergyIqInsightMethodProposalAudit = {
  revision: number;
  fromStatus: InsightMethodPromotionStatus | null;
  toStatus: InsightMethodPromotionStatus;
  actorId: string;
  recordedAt: string;
};

export type EnergyIqInsightMethodProposalRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  artifactId: string;
  artifactIdentityHash: string;
  artifactIdentityRevision: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  findingId: string;
  createdBy: string;
  title: string;
  guidance: string;
  status: InsightMethodPromotionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  audit: readonly EnergyIqInsightMethodProposalAudit[];
  reviewSubmission?: { actorId: string; submittedAt: string };
  approval?: { actorId: string; approvedAt: string };
  publication?: { actorId: string; publishedAt: string; method: InsightMethodRevisionRef };
};

export const initializeEnergyIqInsightMethodGovernanceSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_feedback (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      artifact_identity_hash TEXT NOT NULL,
      artifact_identity_revision TEXT NOT NULL,
      data_snapshot_id TEXT NOT NULL,
      project_release_id TEXT NOT NULL,
      analysis_period_from TEXT NOT NULL,
      analysis_period_to TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('useful', 'not-useful')),
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (artifact_id, finding_id, actor_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (artifact_id) REFERENCES energyiq_overview_ai_artifacts(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_additional_feedback_finding
      ON energyiq_additional_insight_feedback(workspace_id, project_id, artifact_id, finding_id);

    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_comments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      artifact_identity_hash TEXT NOT NULL,
      artifact_identity_revision TEXT NOT NULL,
      data_snapshot_id TEXT NOT NULL,
      project_release_id TEXT NOT NULL,
      analysis_period_from TEXT NOT NULL,
      analysis_period_to TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, actor_id, idempotency_key),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (artifact_id) REFERENCES energyiq_overview_ai_artifacts(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_additional_comments_finding
      ON energyiq_additional_insight_comments(workspace_id, project_id, artifact_id, finding_id, created_at, id);

    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_feedback_history (
      feedback_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      from_rating TEXT,
      to_rating TEXT NOT NULL CHECK (to_rating IN ('useful', 'not-useful')),
      actor_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (feedback_id, revision),
      FOREIGN KEY (feedback_id) REFERENCES energyiq_additional_insight_feedback(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS energyiq_insight_method_proposals (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      artifact_identity_hash TEXT NOT NULL,
      artifact_identity_revision TEXT NOT NULL,
      data_snapshot_id TEXT NOT NULL,
      project_release_id TEXT NOT NULL,
      analysis_period_from TEXT NOT NULL,
      analysis_period_to TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      title TEXT NOT NULL,
      guidance TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('provisional', 'in-review', 'approved', 'published', 'rejected', 'superseded')),
      revision INTEGER NOT NULL,
      review_actor_id TEXT,
      review_submitted_at TEXT,
      approval_actor_id TEXT,
      approved_at TEXT,
      publication_actor_id TEXT,
      published_at TEXT,
      published_method_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, created_by, idempotency_key),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (artifact_id) REFERENCES energyiq_overview_ai_artifacts(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_method_proposals_workspace
      ON energyiq_insight_method_proposals(workspace_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS energyiq_insight_method_proposal_audit (
      proposal_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (proposal_id, revision),
      FOREIGN KEY (proposal_id) REFERENCES energyiq_insight_method_proposals(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
  `);
};

export class EnergyIqInsightMethodGovernanceStore {
  constructor(private readonly db: DatabaseSync) {}

  appendFindingComment(input: {
    expectedWorkspaceId: string;
    expectedProjectId: string;
    artifactId: string;
    findingId: string;
    actorId: string;
    idempotencyKey: string;
    text: string;
    now?: string;
  }): EnergyIqInsightFindingCommentRecord {
    const source = this.requireStoredAdditionalFinding(input.artifactId, input.findingId).source;
    requireExpectedSource(source, input);
    requireCommentText(input);
    const current = this.db.prepare(`
      SELECT * FROM energyiq_additional_insight_comments
      WHERE workspace_id = ? AND actor_id = ? AND idempotency_key = ?
    `).get(source.workspaceId, input.actorId, input.idempotencyKey.trim());
    if (isRecord(current)) {
      const existing = this.mapComment(current);
      if (existing.projectId !== source.projectId
        || existing.artifactId !== source.artifactId
        || existing.findingId !== source.findingId
        || existing.text !== input.text.trim()) {
        throw new Error("ENERGYIQ_ADDITIONAL_COMMENT_IDEMPOTENCY_CONFLICT");
      }
      return existing;
    }
    const createdAt = input.now ?? new Date().toISOString();
    const id = `insight-comment-${hash([
      source.workspaceId,
      input.actorId,
      input.idempotencyKey.trim(),
    ].join("\u0000")).slice(0, 24)}`;
    this.db.prepare(`
      INSERT INTO energyiq_additional_insight_comments (
        id, workspace_id, project_id, scope_id, artifact_id, artifact_identity_hash,
        artifact_identity_revision, data_snapshot_id, project_release_id,
        analysis_period_from, analysis_period_to, finding_id, actor_id,
        idempotency_key, text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      source.workspaceId,
      source.projectId,
      source.scopeId,
      source.artifactId,
      source.artifactIdentityHash,
      source.artifactIdentityRevision,
      source.dataSnapshotId,
      source.projectReleaseId,
      source.analysisPeriod.from,
      source.analysisPeriod.to,
      source.findingId,
      input.actorId,
      input.idempotencyKey.trim(),
      input.text.trim(),
      createdAt,
    );
    return this.getCommentById(id);
  }

  listFindingComments(input: {
    expectedWorkspaceId: string;
    expectedProjectId: string;
    artifactId: string;
    findingId: string;
  }): EnergyIqInsightFindingCommentRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_additional_insight_comments
      WHERE workspace_id = ? AND project_id = ? AND artifact_id = ? AND finding_id = ?
      ORDER BY created_at, id
    `).all(
      input.expectedWorkspaceId,
      input.expectedProjectId,
      input.artifactId,
      input.findingId,
    ).map((row) => this.mapComment(requireRecord(row)));
  }

  recordFeedback(input: {
    expectedWorkspaceId: string;
    expectedProjectId: string;
    artifactId: string;
    findingId: string;
    actorId: string;
    rating: InsightFindingFeedbackRating;
    expectedRevision: number;
    now?: string;
  }): EnergyIqInsightFindingFeedbackRecord {
    const source = this.requireAdditionalFinding(input.artifactId, input.findingId);
    requireExpectedSource(source, input);
    const now = input.now ?? new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.findFeedback({
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        artifactId: source.artifactId,
        findingId: source.findingId,
        actorId: input.actorId,
      });
      const next = applyInsightFindingFeedback(current, {
        ...source,
        actorId: input.actorId,
        rating: input.rating,
        expectedRevision: input.expectedRevision,
        recordedAt: now,
      });
      if (current === next) {
        this.db.exec("COMMIT");
        return current;
      }
      const id = current?.id ?? `insight-feedback-${hash([
        source.artifactId,
        source.findingId,
        input.actorId,
      ].join("\u0000")).slice(0, 24)}`;
      this.db.prepare(`
        INSERT INTO energyiq_additional_insight_feedback (
          id, workspace_id, project_id, scope_id, artifact_id, artifact_identity_hash,
          artifact_identity_revision, data_snapshot_id, project_release_id,
          analysis_period_from, analysis_period_to, finding_id, actor_id, rating,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id, finding_id, actor_id) DO UPDATE SET
          rating = excluded.rating,
          revision = excluded.revision,
          updated_at = excluded.updated_at
        WHERE energyiq_additional_insight_feedback.revision = ?
      `).run(
        id,
        source.workspaceId,
        source.projectId,
        source.scopeId,
        source.artifactId,
        source.artifactIdentityHash,
        source.artifactIdentityRevision,
        source.dataSnapshotId,
        source.projectReleaseId,
        source.analysisPeriod.from,
        source.analysisPeriod.to,
        source.findingId,
        input.actorId,
        next.rating,
        next.revision,
        next.createdAt,
        next.updatedAt,
        current?.revision ?? next.revision,
      );
      const audit = next.history.at(-1)!;
      this.db.prepare(`
        INSERT INTO energyiq_additional_insight_feedback_history (
          feedback_id, revision, from_rating, to_rating, actor_id, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, audit.revision, audit.fromRating, audit.toRating, audit.actorId, audit.recordedAt);
      const stored = this.getFeedbackById(id);
      this.db.exec("COMMIT");
      return stored;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  findFeedback(input: {
    workspaceId: string;
    projectId: string;
    artifactId: string;
    findingId: string;
    actorId: string;
  }): EnergyIqInsightFindingFeedbackRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_additional_insight_feedback
      WHERE workspace_id = ? AND project_id = ? AND artifact_id = ? AND finding_id = ? AND actor_id = ?
    `).get(input.workspaceId, input.projectId, input.artifactId, input.findingId, input.actorId);
    return isRecord(row) ? this.mapFeedback(row) : undefined;
  }

  findVisibleFeedback(input: {
    workspaceId: string;
    projectId: string;
    artifactId: string;
    findingId: string;
    actorId: string;
  }): EnergyIqInsightFindingFeedbackRecord | undefined {
    const source = this.requireAdditionalFinding(input.artifactId, input.findingId);
    requireExpectedSource(source, {
      expectedWorkspaceId: input.workspaceId,
      expectedProjectId: input.projectId,
    });
    return this.findFeedback(input);
  }

  feedbackSummary(input: { workspaceId: string; artifactId: string; findingId: string }): {
    useful: number;
    notUseful: number;
  } {
    const rows = this.db.prepare(`
      SELECT rating, COUNT(*) AS count FROM energyiq_additional_insight_feedback
      WHERE workspace_id = ? AND artifact_id = ? AND finding_id = ? GROUP BY rating
    `).all(input.workspaceId, input.artifactId, input.findingId);
    let useful = 0;
    let notUseful = 0;
    for (const row of rows) {
      if (!isRecord(row) || typeof row.count !== "number") continue;
      if (row.rating === "useful") useful = row.count;
      if (row.rating === "not-useful") notUseful = row.count;
    }
    return { useful, notUseful };
  }

  createProposal(input: {
    expectedWorkspaceId: string;
    expectedProjectId: string;
    artifactId: string;
    findingId: string;
    actorId: string;
    idempotencyKey: string;
    title: string;
    guidance: string;
    now?: string;
  }): EnergyIqInsightMethodProposalRecord {
    const source = this.requireAdditionalFinding(input.artifactId, input.findingId);
    requireExpectedSource(source, input);
    requireProposalText(input);
    const current = this.db.prepare(`
      SELECT * FROM energyiq_insight_method_proposals
      WHERE workspace_id = ? AND created_by = ? AND idempotency_key = ?
    `).get(source.workspaceId, input.actorId, input.idempotencyKey);
    if (isRecord(current)) {
      const existing = this.mapProposal(current);
      if (existing.artifactId !== input.artifactId
        || existing.findingId !== input.findingId
        || existing.title !== input.title.trim()
        || existing.guidance !== input.guidance.trim()) {
        throw new Error("ENERGYIQ_INSIGHT_METHOD_PROPOSAL_IDEMPOTENCY_CONFLICT");
      }
      return existing;
    }
    const now = input.now ?? new Date().toISOString();
    const id = `insight-method-proposal-${hash([
      source.workspaceId,
      input.actorId,
      input.idempotencyKey,
    ].join("\u0000")).slice(0, 24)}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO energyiq_insight_method_proposals (
          id, workspace_id, project_id, scope_id, artifact_id, artifact_identity_hash,
          artifact_identity_revision, data_snapshot_id, project_release_id,
          analysis_period_from, analysis_period_to, finding_id, created_by,
          idempotency_key, title, guidance, status, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisional', 1, ?, ?)
      `).run(
        id, source.workspaceId, source.projectId, source.scopeId, source.artifactId,
        source.artifactIdentityHash, source.artifactIdentityRevision, source.dataSnapshotId,
        source.projectReleaseId, source.analysisPeriod.from, source.analysisPeriod.to,
        source.findingId, input.actorId, input.idempotencyKey.trim(), input.title.trim(),
        input.guidance.trim(), now, now,
      );
      this.insertProposalAudit(id, 1, null, "provisional", input.actorId, now);
      const stored = this.getProposal({
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        proposalId: id,
      });
      this.db.exec("COMMIT");
      return stored;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  submitProposal(input: ProposalMutation): EnergyIqInsightMethodProposalRecord {
    return this.transition(input, (proposal, now) => submitInsightMethodProposalForReview(proposal, {
      actorId: input.actorId,
      submittedAt: now,
    }));
  }

  approveProposal(input: ProposalMutation): EnergyIqInsightMethodProposalRecord {
    return this.transition(input, (proposal, now) => approveInsightMethodProposal(proposal, {
      actorId: input.actorId,
      approvedAt: now,
    }));
  }

  publishProposal(input: ProposalMutation): EnergyIqInsightMethodProposalRecord {
    const current = this.getProposal(input);
    const method: InsightMethodRevisionRef = {
      skillId: `workspace-insight-method:${current.id}`,
      semanticVersion: "1.0.0",
      resourceId: `insight-method-proposal:${current.id}`,
      resourceRevision: 1,
      contentSha256: hash(current.guidance),
      scope: "workspace",
      workspaceId: current.workspaceId,
      userId: current.createdBy,
      role: "expert-direction",
    };
    return this.transition(input, (proposal, now) => publishApprovedInsightMethodProposal(proposal, {
      actorId: input.actorId,
      publishedAt: now,
      method,
    }));
  }

  getProposal(input: { workspaceId: string; projectId: string; proposalId: string }): EnergyIqInsightMethodProposalRecord {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_insight_method_proposals WHERE workspace_id = ? AND project_id = ? AND id = ?
    `).get(input.workspaceId, input.projectId, input.proposalId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_INSIGHT_METHOD_PROPOSAL_NOT_FOUND");
    return this.mapProposal(row);
  }

  listProposals(input: { workspaceId: string; projectId?: string }): EnergyIqInsightMethodProposalRecord[] {
    const rows = input.projectId
      ? this.db.prepare(`
          SELECT * FROM energyiq_insight_method_proposals
          WHERE workspace_id = ? AND project_id = ? ORDER BY created_at, id
        `).all(input.workspaceId, input.projectId)
      : this.db.prepare(`
          SELECT * FROM energyiq_insight_method_proposals WHERE workspace_id = ? ORDER BY created_at, id
        `).all(input.workspaceId);
    return rows.map((row) => this.mapProposal(requireRecord(row)));
  }

  listPublishedWorkspaceMethodResources(input: { workspaceId: string }): AdditionalAiInsightMethodResource[] {
    return this.db.prepare(`
      SELECT published_method_json, guidance FROM energyiq_insight_method_proposals
      WHERE workspace_id = ? AND status = 'published' ORDER BY published_at, id
    `).all(input.workspaceId).map((row) => {
      const record = requireRecord(row);
      const method = parseJson(record.published_method_json);
      const content = requiredString(record, "guidance");
      if (!insightMethodRevisionRefIsValid(method)
        || method.scope !== "workspace"
        || method.workspaceId !== input.workspaceId
        || method.role !== "expert-direction"
        || hash(content) !== method.contentSha256) {
        throw new Error("ENERGYIQ_PUBLISHED_INSIGHT_METHOD_INVALID");
      }
      return { method, content };
    });
  }

  private transition(
    input: ProposalMutation,
    apply: (proposal: InsightMethodProposal, now: string) => InsightMethodProposal,
  ): EnergyIqInsightMethodProposalRecord {
    const current = this.getProposal(input);
    if (current.artifactIdentityRevision !== "additional-insights-v24") {
      throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
    }
    if (current.revision !== input.expectedRevision) {
      throw new Error("ENERGYIQ_INSIGHT_METHOD_PROPOSAL_REVISION_CONFLICT");
    }
    const now = input.now ?? new Date().toISOString();
    const next = apply(toContractProposal(current), now);
    const revision = current.revision + 1;
    const publication = next.publication;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`
        UPDATE energyiq_insight_method_proposals SET
          status = ?, revision = ?, review_actor_id = ?, review_submitted_at = ?,
          approval_actor_id = ?, approved_at = ?, publication_actor_id = ?,
          published_at = ?, published_method_json = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ?
      `).run(
        next.status,
        revision,
        next.reviewSubmission?.actorId ?? null,
        next.reviewSubmission?.submittedAt ?? null,
        next.approval?.actorId ?? null,
        next.approval?.approvedAt ?? null,
        publication?.actorId ?? null,
        publication?.publishedAt ?? null,
        publication ? JSON.stringify(publication.method) : null,
        now,
        current.workspaceId,
        current.id,
        current.revision,
      );
      if (result.changes !== 1) throw new Error("ENERGYIQ_INSIGHT_METHOD_PROPOSAL_REVISION_CONFLICT");
      this.insertProposalAudit(current.id, revision, current.status, next.status, input.actorId, now);
      const stored = this.getProposal(input);
      this.db.exec("COMMIT");
      return stored;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private requireAdditionalFinding(artifactId: string, findingId: string): AdditionalFindingIdentity {
    const stored = this.requireStoredAdditionalFinding(artifactId, findingId);
    const { source, identity } = stored;
    const currentMethodSet = resolveCurrentAdditionalAiInsightMethodSet(
      source.workspaceId,
      this.listPublishedWorkspaceMethodResources({ workspaceId: source.workspaceId }),
    );
    const canonicalMethods = canonicalInsightMethodSetJson(currentMethodSet.methods);
    const currentFingerprint = canonicalMethods === null
      ? null
      : `sha256:${hash(canonicalMethods)}`;
    if (identity.methodSetId !== currentMethodSet.id
      || identity.methodSetRevision !== currentMethodSet.revision
      || identity.methodSetFingerprint !== currentFingerprint) {
      throw new Error("ENERGYIQ_ADDITIONAL_ARTIFACT_NOT_CURRENT");
    }
    return source;
  }

  private requireStoredAdditionalFinding(
    artifactId: string,
    findingId: string,
  ): { source: AdditionalFindingIdentity; identity: Record<string, unknown> } {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_overview_ai_artifacts WHERE id = ?
    `).get(artifactId);
    if (!isRecord(row)
      || row.status !== "available"
      || typeof row.identity_json !== "string"
      || typeof row.result_json !== "string") {
      throw new Error("ENERGYIQ_ADDITIONAL_ARTIFACT_NOT_FOUND");
    }
    const identity = parseJson(row.identity_json);
    const result = parseJson(row.result_json);
    const workspaceId = requiredString(row, "workspace_id");
    const projectId = requiredString(row, "project_id");
    const scopeId = requiredString(row, "scope_id");
    const dataSnapshotId = requiredString(row, "data_snapshot_id");
    const projectReleaseId = requiredString(row, "project_release_id");
    if (!isRecord(identity)
      || identity.artifactKind !== "autonomous-insights"
      || identity.identityContractRevision !== "additional-insights-v24"
      || identity.outputContractRevision !== "energyiq-additional-ai-insights-v2"
      || identity.validatorRevision !== "additional-insights-acceptance-v17"
      || identity.workflowRevision !== "additional-insights-discover-accept-publish-v21"
      || identity.investigatorPromptRevision !== "additional-insights-discovery-v12"
      || identity.workspaceId !== workspaceId
      || identity.projectId !== projectId
      || identity.scopeId !== scopeId
      || identity.dataSnapshotId !== dataSnapshotId
      || identity.projectReleaseId !== projectReleaseId
      || !nonEmptyStringValue(identity.methodSetId)
      || !nonEmptyStringValue(identity.methodSetRevision)
      || typeof identity.methodSetFingerprint !== "string"
      || !/^sha256:[0-9a-f]{64}$/u.test(identity.methodSetFingerprint)) {
      throw new Error("ENERGYIQ_ADDITIONAL_ARTIFACT_NOT_FOUND");
    }
    if (!isRecord(result)
      || result.artifactKind !== "autonomous-insights"
      || result.status !== "available"
      || !isRecord(result.contract)
      || result.contract.revision !== identity.outputContractRevision
      || !isRecord(result.binding)
      || result.binding.workspaceId !== identity.workspaceId
      || result.binding.projectId !== identity.projectId
      || result.binding.scopeId !== identity.scopeId
      || result.binding.dataSnapshotId !== identity.dataSnapshotId
      || result.binding.projectReleaseId !== identity.projectReleaseId
      || !Array.isArray(result.findings)
      || !result.findings.some((finding) => isRecord(finding) && finding.id === findingId)
      || !isRecord(result.binding.analysisPeriod)
      || result.binding.analysisPeriod.from !== identity.analysisPeriodFrom
      || result.binding.analysisPeriod.to !== identity.analysisPeriodTo) {
      throw new Error("ENERGYIQ_ADDITIONAL_FINDING_NOT_FOUND");
    }
    return { identity, source: {
      workspaceId,
      projectId,
      scopeId,
      artifactId,
      artifactIdentityHash: `sha256:${requiredString(row, "identity_hash")}`,
      artifactIdentityRevision: requiredString(identity, "identityContractRevision"),
      dataSnapshotId,
      projectReleaseId,
      analysisPeriod: {
        from: requiredString(result.binding.analysisPeriod, "from"),
        to: requiredString(result.binding.analysisPeriod, "to"),
      },
      findingId,
    } };
  }

  private getFeedbackById(id: string): EnergyIqInsightFindingFeedbackRecord {
    const row = this.db.prepare("SELECT * FROM energyiq_additional_insight_feedback WHERE id = ?").get(id);
    return this.mapFeedback(requireRecord(row));
  }

  private getCommentById(id: string): EnergyIqInsightFindingCommentRecord {
    const row = this.db.prepare("SELECT * FROM energyiq_additional_insight_comments WHERE id = ?").get(id);
    return this.mapComment(requireRecord(row));
  }

  private mapComment(row: Record<string, unknown>): EnergyIqInsightFindingCommentRecord {
    return {
      id: requiredString(row, "id"),
      workspaceId: requiredString(row, "workspace_id"),
      projectId: requiredString(row, "project_id"),
      scopeId: requiredString(row, "scope_id"),
      artifactId: requiredString(row, "artifact_id"),
      artifactIdentityHash: requiredString(row, "artifact_identity_hash"),
      artifactIdentityRevision: requiredString(row, "artifact_identity_revision"),
      dataSnapshotId: requiredString(row, "data_snapshot_id"),
      projectReleaseId: requiredString(row, "project_release_id"),
      analysisPeriod: {
        from: requiredString(row, "analysis_period_from"),
        to: requiredString(row, "analysis_period_to"),
      },
      findingId: requiredString(row, "finding_id"),
      actorId: requiredString(row, "actor_id"),
      text: requiredString(row, "text"),
      createdAt: requiredString(row, "created_at"),
    };
  }

  private mapFeedback(row: Record<string, unknown>): EnergyIqInsightFindingFeedbackRecord {
    const id = requiredString(row, "id");
    return {
      id,
      workspaceId: requiredString(row, "workspace_id"),
      projectId: requiredString(row, "project_id"),
      scopeId: requiredString(row, "scope_id"),
      artifactId: requiredString(row, "artifact_id"),
      artifactIdentityHash: requiredString(row, "artifact_identity_hash"),
      artifactIdentityRevision: requiredString(row, "artifact_identity_revision"),
      dataSnapshotId: requiredString(row, "data_snapshot_id"),
      projectReleaseId: requiredString(row, "project_release_id"),
      analysisPeriod: {
        from: requiredString(row, "analysis_period_from"),
        to: requiredString(row, "analysis_period_to"),
      },
      findingId: requiredString(row, "finding_id"),
      actorId: requiredString(row, "actor_id"),
      rating: requiredRating(row.rating),
      revision: requiredPositiveInteger(row.revision),
      createdAt: requiredString(row, "created_at"),
      updatedAt: requiredString(row, "updated_at"),
      history: this.db.prepare(`
        SELECT * FROM energyiq_additional_insight_feedback_history
        WHERE feedback_id = ? ORDER BY revision
      `).all(id).map((history) => {
        const item = requireRecord(history);
        return {
          revision: requiredPositiveInteger(item.revision),
          fromRating: item.from_rating === null ? null : requiredRating(item.from_rating),
          toRating: requiredRating(item.to_rating),
          actorId: requiredString(item, "actor_id"),
          recordedAt: requiredString(item, "recorded_at"),
        };
      }),
    };
  }

  private mapProposal(row: Record<string, unknown>): EnergyIqInsightMethodProposalRecord {
    const id = requiredString(row, "id");
    const reviewActor = optionalString(row.review_actor_id);
    const reviewAt = optionalString(row.review_submitted_at);
    const approvalActor = optionalString(row.approval_actor_id);
    const approvedAt = optionalString(row.approved_at);
    const publicationActor = optionalString(row.publication_actor_id);
    const publishedAt = optionalString(row.published_at);
    const method = parseJson(row.published_method_json);
    return {
      id,
      workspaceId: requiredString(row, "workspace_id"),
      projectId: requiredString(row, "project_id"),
      scopeId: requiredString(row, "scope_id"),
      artifactId: requiredString(row, "artifact_id"),
      artifactIdentityHash: requiredString(row, "artifact_identity_hash"),
      artifactIdentityRevision: requiredString(row, "artifact_identity_revision"),
      dataSnapshotId: requiredString(row, "data_snapshot_id"),
      projectReleaseId: requiredString(row, "project_release_id"),
      analysisPeriod: {
        from: requiredString(row, "analysis_period_from"),
        to: requiredString(row, "analysis_period_to"),
      },
      findingId: requiredString(row, "finding_id"),
      createdBy: requiredString(row, "created_by"),
      title: requiredString(row, "title"),
      guidance: requiredString(row, "guidance"),
      status: requiredPromotionStatus(row.status),
      revision: requiredPositiveInteger(row.revision),
      createdAt: requiredString(row, "created_at"),
      updatedAt: requiredString(row, "updated_at"),
      audit: this.db.prepare(`
        SELECT * FROM energyiq_insight_method_proposal_audit WHERE proposal_id = ? ORDER BY revision
      `).all(id).map(mapProposalAudit),
      ...(reviewActor && reviewAt ? { reviewSubmission: { actorId: reviewActor, submittedAt: reviewAt } } : {}),
      ...(approvalActor && approvedAt ? { approval: { actorId: approvalActor, approvedAt } } : {}),
      ...(publicationActor && publishedAt && insightMethodRevisionRefIsValid(method)
        ? { publication: { actorId: publicationActor, publishedAt, method } }
        : {}),
    };
  }

  private insertProposalAudit(
    proposalId: string,
    revision: number,
    fromStatus: InsightMethodPromotionStatus | null,
    toStatus: InsightMethodPromotionStatus,
    actorId: string,
    recordedAt: string,
  ): void {
    this.db.prepare(`
      INSERT INTO energyiq_insight_method_proposal_audit (
        proposal_id, revision, from_status, to_status, actor_id, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(proposalId, revision, fromStatus, toStatus, actorId, recordedAt);
  }
}

type AdditionalFindingIdentity = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  artifactId: string;
  artifactIdentityHash: string;
  artifactIdentityRevision: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  findingId: string;
};

type ProposalMutation = {
  workspaceId: string;
  projectId: string;
  proposalId: string;
  actorId: string;
  expectedRevision: number;
  now?: string;
};

const requireExpectedSource = (
  source: AdditionalFindingIdentity,
  expected: { expectedWorkspaceId: string; expectedProjectId: string },
): void => {
  if (source.workspaceId !== expected.expectedWorkspaceId || source.projectId !== expected.expectedProjectId) {
    throw new Error("ENERGYIQ_ADDITIONAL_FINDING_NOT_FOUND");
  }
};

const toContractProposal = (record: EnergyIqInsightMethodProposalRecord): InsightMethodProposal => ({
  id: record.id,
  target: {
    scope: "workspace",
    workspaceId: record.workspaceId,
    userId: record.createdBy,
  },
  source: { artifactId: record.artifactId, findingId: record.findingId },
  status: record.status,
  feedback: [],
  ...(record.reviewSubmission ? { reviewSubmission: record.reviewSubmission } : {}),
  ...(record.approval ? { approval: record.approval } : {}),
  ...(record.publication ? { publication: record.publication } : {}),
});

const requireProposalText = (input: {
  idempotencyKey: string;
  title: string;
  guidance: string;
}): void => {
  if (!nonEmpty(input.idempotencyKey) || input.idempotencyKey.length > 160
    || !nonEmpty(input.title) || input.title.length > 160
    || !nonEmpty(input.guidance) || input.guidance.length > 1_600
    || /(?:<\/?[a-z]|https?:\/\/|javascript:|```)/iu.test(input.title + input.guidance)) {
    throw new Error("ENERGYIQ_INSIGHT_METHOD_PROPOSAL_INVALID");
  }
};

const requireCommentText = (input: { idempotencyKey: string; text: string }): void => {
  if (!nonEmpty(input.idempotencyKey) || input.idempotencyKey.length > 160
    || !nonEmpty(input.text) || input.text.length > 2_000) {
    throw new Error("ENERGYIQ_ADDITIONAL_COMMENT_INVALID");
  }
};

const mapProposalAudit = (value: unknown): EnergyIqInsightMethodProposalAudit => {
  const row = requireRecord(value);
  return {
    revision: requiredPositiveInteger(row.revision),
    fromStatus: row.from_status === null ? null : requiredPromotionStatus(row.from_status),
    toStatus: requiredPromotionStatus(row.to_status),
    actorId: requiredString(row, "actor_id"),
    recordedAt: requiredString(row, "recorded_at"),
  };
};

const requiredPromotionStatus = (value: unknown): InsightMethodPromotionStatus => {
  if (value === "provisional" || value === "in-review" || value === "approved"
    || value === "published" || value === "rejected" || value === "superseded") return value;
  throw new Error("ENERGYIQ_INSIGHT_METHOD_PROPOSAL_INVALID");
};

const requiredRating = (value: unknown): InsightFindingFeedbackRating => {
  if (value === "useful" || value === "not-useful") return value;
  throw new Error("ENERGYIQ_ADDITIONAL_FEEDBACK_INVALID");
};

const requiredPositiveInteger = (value: unknown): number => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  throw new Error("ENERGYIQ_INSIGHT_METHOD_GOVERNANCE_RECORD_INVALID");
};

const requiredString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value === "string" && nonEmpty(value)) return value;
  throw new Error("ENERGYIQ_INSIGHT_METHOD_GOVERNANCE_RECORD_INVALID");
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && nonEmpty(value) ? value : undefined;

const nonEmptyStringValue = (value: unknown): value is string =>
  typeof value === "string" && nonEmpty(value);
const nonEmpty = (value: string): boolean => /\S/u.test(value);
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const requireRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error("ENERGYIQ_INSIGHT_METHOD_GOVERNANCE_RECORD_INVALID");
  return value;
};
const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};
