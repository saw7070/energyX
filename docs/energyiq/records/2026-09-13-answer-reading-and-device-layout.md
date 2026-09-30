# Answer reading and device layout

## Design direction

Applied the installed Anthropic frontend-design Skill. Preserve the existing font and palette: white #ffffff, pale surface #f2f4f0, ink #202322, green #176b59 and muted text #59635c. Reading clarity and the device heatmap provide the visual emphasis; no new decoration or brand system.

Layout: answer first, collapsed method information beneath it. Inside methods, group user choices, project defaults and built-in checks; align names and versions. Delivery evidence is a secondary disclosure, not a claim that the model applied every instruction.

Explorer: heatmap followed by device / energy used / readings columns. Preserve formulas, main/submeter role, total-inclusion relationship and detailed quality explanations in keyboard-operable disclosures. Missing/zero quality labels stay visible; no sum is introduced.

## Behavior and validation

- Streaming now follows cumulative answer changes only while follow-latest remains enabled. Reading older text disables following; the existing return-to-latest action restores it. Running 400ms/full-page immediate polling is unchanged.
- 4 focused files, 46 tests passed. New tests exercise following, scroll-away preservation, explicit resume and grouped collapsed method information. Existing missing/zero/virtual-input tests pass.
- Whole-web tsc still exits with unrelated existing test typing errors; no errors reported in the changed production components. Diff whitespace check passed.
- Real 3008 DB1: three columns, 218.77 kWh main power, 423.25 kWh light, and missing Director Room Power remains No data. Meter setup expands to show main/total and inclusion relationship. Desktop visual check and 480px no-page-overflow check completed; viewport reset.
- This browser account cannot access the Integration member streaming session. Therefore grouped methods and streaming scroll are component-tested here, and live member/provider visual acceptance remains with Integration. No claim of 390px or real-provider acceptance for this patch.

## Data and integration boundary

Integration follow-up: worker 9af84845 was applied as 50ffffe0. The `.next-reading`
production Web build passed and is serving local 3000. A real member/DeepSeek long
answer verified initial bottom following, then scrolling up with the mouse while
text continued growing: scrollTop stayed at 0. Clicking Scroll to latest message
restored a bottom distance of 0. After completion, Methods for this answer expanded
and Built-in checks was visible. Session c0d36d7a-98c5-4f34-819e-95f835ea5400;
evidence: outputs/report-integration-20260911/reading-check.json and reading-methods.png.
This closes the worker's outstanding member/streaming check; no production deployment.

Integration reverified production scheduled sync at Sep 13 00:54:07 SGT with latest raw record Sep 12 23:56:50 SGT. This does not establish complete coverage for every meter. Local snapshot still ends Sep 11; no local sync runs/state. Yesterday Sep 12 being empty locally is expected. No source data, API, date calculations, shared process, or deployment changed by this worker.
