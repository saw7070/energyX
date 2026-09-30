# Explorer: one analysis window and separate recent-data status

## Product decision

The date strip controls the entire analysis: total energy, daily average, peak, coverage, charts and child consumption. Hourly/daily/weekly/monthly controls change aggregation only. The previous independent Yesterday query inside Trends is removed. A separate expandable average 24-hour profile uses complete hourly observations from the selected dates.

The historical current-28-day shortcut is retained as Latest 28 days so CSV projects retain their data-anchored entry point. Existing URL values remain compatible.

## Calculation rules

- Daily average uses days with 100% interval coverage and no quality events; display the number of eligible days. Missing days are never zero-filled. Period totals may include partial days, so the mean need not equal total divided by all selected days.
- A selected partial calendar week/month uses only selected dates as the coverage denominator.
- Actual hourly energy preserves zero versus absent values and uses kWh. Average hourly power uses kW and excludes incomplete hours.
- Sidebar status uses a separate last-three-ended-local-days request, independent of selected historical dates. Each day must have at least 97% coverage and no quality events for green. Gaps are amber. Source monitoring mode is returned by the authorized analysis API; the client does not access admin import APIs.
- File projects remain unmonitored/grey. Recent status is populated for visited scopes; unknown scopes stay grey. It is not a claim about device connectivity.

## Deliberate safety boundary

No red hardware alarm is inferred from zero energy or absent derived intervals. The current analysis response describes accepted intervals, not raw communication events. Confirming three days of absent raw readings versus unchanged cumulative readings requires a dedicated raw-source status signal. Until that exists, unavailable derived intervals produce amber with an explicit check-source message. This distinction is intentionally retained rather than falsely asserting a meter fault.

## Validation

- 22 focused Explorer model, URL and interaction tests passed.
- TypeScript project build and Next production build passed.
- Real API: Tuya reports api monitoring and the three-day SGT range; Preschool and Ngee Ann report file monitoring.
- Local browser verification passed: Last 7 days 16.47 kWh / daily average 2.35 kWh; Yesterday 2.35 kWh / peak 0.10 kW / 100% coverage. The hourly curve uses 12 September only. No page errors or horizontal overflow at 390 px. Evidence: outputs/report-integration-20260911/explorer-dates-browser.json and desktop/mobile screenshots.
- This change has not been deployed to production.
