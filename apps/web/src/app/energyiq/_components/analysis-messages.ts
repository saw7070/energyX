/**
 * Wording shared by the Analysis page and its pure helpers (analysis-model, day picker, type hints, peak donut), in
 * every language. It moved to @datafoundry/site-report so the server can word a report the same way; `rich`, the one
 * helper that returns React nodes, moved with the other React code and is re-exported here as before.
 * The page's own sections keep their wording in analysis-story-messages.ts and analysis-view-messages.ts.
 */
export * from "@datafoundry/site-report/analysis-messages";
export { rich } from "@datafoundry/site-report/rich";
