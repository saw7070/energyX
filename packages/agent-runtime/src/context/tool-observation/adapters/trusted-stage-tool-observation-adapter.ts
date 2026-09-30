import { asRecord, BaseToolObservationAdapter } from "./base-tool-observation-adapter.js";

/** Projects a server-injected stage tool without classifying it as browser MCP. */
export class TrustedStageToolObservationAdapter extends BaseToolObservationAdapter {
  readonly resultType: string;

  constructor(readonly toolName: string) {
    super();
    this.resultType = `trusted-stage-${toolName}`;
  }

  protected project(raw: unknown): unknown {
    return asRecord(raw);
  }
}
