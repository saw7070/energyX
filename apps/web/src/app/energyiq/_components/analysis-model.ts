/**
 * Pure calculations for the Analysis page, kept separate so every number on the page is testable. They now live in
 * @datafoundry/site-report, where the server can run them too; this file keeps the path every page imports from.
 */
export * from "@datafoundry/site-report/analysis-model";
