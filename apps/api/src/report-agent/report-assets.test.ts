import {expect,it} from "vitest";
import {assertSelfContainedReport} from "./report-assets.js";
it("rejects charts that only load from the report's sibling folder",()=>{
 for(const html of ['<img src="charts/evidence.svg">','<script src=app.js></script>',"<link rel='stylesheet' href='style.css'>",'<svg><image href="chart.svg"/></svg>','<style>body{background:url(bg.png)}</style>'])expect(()=>assertSelfContainedReport(html)).toThrow("ASSET_DEPENDENCY");
});
it("accepts embedded charts and local SVG references without blocking ordinary navigation links",()=>{
 expect(()=>assertSelfContainedReport('<svg><use href="#shape"/></svg><img src="data:image/png;base64,abc"><style>.x{fill:url(#gradient)}</style><a href="https://example.com">Source</a>')).not.toThrow();
});
