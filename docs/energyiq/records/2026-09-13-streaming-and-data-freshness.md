# Streaming and data freshness verification

## Cause and change

The report harness collected each provider SSE response completely before returning
it to Pi, and forwarded only lifecycle/tool events to the product. User-facing text
was saved on completion. This was not incremental answer delivery.

The bridge now forwards bounded byte chunks through stdio to the network-isolated
worker. Pi's visible text deltas become cumulative `answer_progress` events, bounded
to 30,000 characters and throttled at 250ms. Thinking and internal review text are
not emitted. The UI renders the selected running Run's latest text, then replaces it
with the persisted final answer. Progress events are omitted from Activity details.
Active text polling is 400ms; queued tasks retain slower polling. Worker protocol
readiness rejects images without streaming support; deploy the image with the API.

## Evidence

- Eight real Docker harness tests passed, including text arriving before the provider
  finishes, tools, review, cancellation and concurrent workers.
- Real DeepSeek Flash / ordinary member Run bd18c472-faba-46a6-9956-f396f2452737
  succeeded in about 9 seconds; three progress updates were observed while running.
- The real browser observed 1,104 characters while Stop generating was still visible,
  followed by a 2,226-character final answer. This initial browser check used the
  2-second UI polling interval; the subsequent 400ms change reduces the refresh delay.
  The rebuilt `.next-stream-final` browser repeated the check: 203 characters were
  visible before completion and grew to 2,314. The chat component suite passed 36 tests.
- S2 simplified method selection, dates, chart grouping and quality disclosure;
  59 focused UI tests passed. Integrated 390px method selection had no horizontal
  overflow. This is targeted UX improvement, not acceptance of a complete new design.

## September 12 data: production versus local

Read-only production inspection found the scheduled Tuya sync succeeded at
2026-09-12T16:54:07Z (September 13, 00:54 Singapore). Its request watermark is
2026-09-12T16:00:00Z, and published source records extend to
2026-09-12T15:56:50Z (September 12, 23:56 Singapore).

The local validation database has no sync run/state records; its source records
end September 11. Its product page reports latest readings at September 11 23:45.
Thus local Yesterday (September 12) is genuinely empty. Do not display zero usage,
silently move the window, or describe the production scheduler as broken from that
local result. The two environments do not automatically share their databases.

Source timestamp and sync success do not establish 100% interval coverage. A direct
read-only production DuckDB attempt could not establish a connection; local trial
credentials also do not authenticate production. No production settings, credentials,
data or services were changed. Complete per-meter September 12 quality is not claimed.

Evidence scripts/results are under Integration outputs/report-integration-20260911:
check-sync.py, stream-tests.log, stream-live.json, stream-browser.json and
controls-{desktop,mobile}.png. Do not commit credentials or generated runtime data.
