/**
 * The site energy report, shared by the web app and the API: the wording, the pure model that turns readings into a
 * `SiteReport`, and the helpers around it. Everything here is plain TypeScript — no React, no DOM, no fetching — so
 * the server can build a report on a schedule and the browser can build the same one from the same readings.
 *
 * The React document is deliberately NOT re-exported here, so importing the model never pulls react-dom/server into a
 * browser bundle. Import it from "@datafoundry/site-report/site-report-document" instead.
 */
export * from "./locale.js";
export * from "./analysis-types.js";
export * from "./analysis-messages.js";
export * from "./analysis-model.js";
export * from "./analysis-scope.js";
export * from "./report-period.js";
export * from "./site-report-snapshot.js";
export * from "./site-report-messages.js";
export * from "./site-report-model-messages.js";
export * from "./site-report-model.js";
export * from "./site-report-styles.js";
export * from "./wrap-label.js";
