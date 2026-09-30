import type { ModelRequestSnapshotRecorder } from "@datafoundry/agent-runtime";
import type { MetadataStore } from "@datafoundry/metadata";

/** Binds the runtime capture to the exact server-owned actor/Session/Run in the existing metadata store. */
export const createMetadataModelRequestSnapshotRecorder = (input: {
  metadataStore: MetadataStore;
  runId: string;
  sessionId: string;
  userId: string;
}): ModelRequestSnapshotRecorder => ({
  record: (capture) => {
    const snapshot = input.metadataStore.modelRequestSnapshots.create({
      user_id: input.userId,
      session_id: input.sessionId,
      run_id: input.runId,
      step_number: capture.stepNumber,
      retry_count: capture.retryCount,
      context_package_id: capture.contextPackage.packageId,
      context_package_revision: capture.contextPackage.revision,
      payload: capture,
    });
    return {
      snapshotId: snapshot.id,
      contentSha256: snapshot.content_sha256,
      payloadAvailability: snapshot.payload_availability,
    };
  },
});
