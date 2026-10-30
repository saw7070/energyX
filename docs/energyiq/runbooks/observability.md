# Observability: logs, health, metrics and alerts

How to tell, without logging in to the app, whether the EnergyX API is healthy, what it did, and who needs to act. Everything here runs inside the API process (`energyiq-datafoundry-api.service`, 127.0.0.1:8787); the code is in `apps/api/src/observability/`.

| | What | Where |
|---|---|---|
| **Logs** | One line per event on stdout, JSON in production | journald: `journalctl -u energyiq-datafoundry-api.service` |
| **Request IDs** | Every request has an `X-Request-Id`, logged by nginx, the web app's proxy and the API | Response header `X-Request-Id`; log field `request_id` |
| **Liveness** | `GET /healthz`: the process answers | Public through nginx |
| **Readiness** | `GET /ready`: database, storage, disk and background jobs | Public through nginx (pass/fail only); full detail on the host |
| **Metrics** | `GET /metrics`: Prometheus text | Only on the host, or with `ENERGYX_METRICS_TOKEN` |
| **Alerts** | Slack/Teams message when a background job fails or recovers, on a crash, or when startup finds a dependency missing | `ENERGYX_OPS_ALERT_WEBHOOK_URL` |

## Settings

All optional; put them in the API's environment (`.env` or a systemd drop-in) and restart the API.

| Variable | Default | Meaning |
|---|---|---|
| `ENERGYX_LOG_LEVEL` | `info` | Least severe level written: `debug`, `info`, `warn`, `error`, `silent`. `debug` adds an access line for every health probe and metrics scrape. |
| `ENERGYX_LOG_FORMAT` | `json` in production, `pretty` elsewhere | Force `json` or `pretty`. |
| `ENERGYX_OPS_ALERT_WEBHOOK_URL` | off | Slack or Microsoft Teams incoming-webhook URL. It is a secret: keep it out of Git and tickets. |
| `ENERGYX_OPS_ALERT_MIN_INTERVAL_MINUTES` | `60` | At most one alert per job (or per kind of alert) in this many minutes. |
| `ENERGYX_METRICS_TOKEN` | none | Lets callers that are not on the host read `/metrics` and `/ready`'s detail with `Authorization: Bearer <token>`. |
| `ENERGYX_MIN_FREE_DISK_MB` | `1024` | `/ready` answers 503 when the disk holding `STORAGE_ROOT_DIR` has less free space. |

## Logs

In production each line is one JSON object: `time`, `level`, `msg`, then the event's fields. `component` says which part of the API wrote it (`http`, `startup`, `tuya-sync`, `live-sync`, `live-readings`, `alert-email`, `target-alert`, `report-email`, `report-agent`, `process`, ...). Lines written while serving a request carry its `request_id`.

```json
{"time":"2026-10-30T02:00:04.118Z","level":"info","msg":"request","component":"http","request_id":"7f3c9a0e5b2d41c6a8e2f0b1c3d4e5f6","method":"GET","path":"/api/v1/energy/projects/tuya-office/overview","status":200,"duration_ms":84.2,"user_id":"u_8c1d","workspace_id":"ws_hima","client_ip":"203.0.113.9"}
{"time":"2026-10-30T01:00:41.902Z","level":"error","msg":"failed","component":"tuya-sync","project_id":"tuya-office","passes":0,"code":"ENERGYIQ_TUYA_API_ERROR:1114","detail":"Error: ENERGYIQ_TUYA_API_ERROR:1114 ..."}
```

- **Access log**: one `msg: "request"` line per request with method, path (never the query string), status, `duration_ms`, `user_id` and `workspace_id` once signed in, `client_ip` and `request_id`. `aborted: true` means the browser went away first (a closed tab during a stream). Probes and metrics scrapes are logged at `debug`.
- **Request failures**: an unexpected error that becomes HTTP 500 is logged as `msg: "request failed"` at `error` with the stack, under the same `request_id`.
- **Never logged**: passwords, tokens, cookies, API keys, `Authorization` headers, request bodies and query strings. Fields with such names are written as `[REDACTED]`, and bearer tokens, JWTs, URL passwords, query strings and webhook URLs are removed from any text, including error messages and stacks.

Reading them on the server:

```bash
journalctl -u energyiq-datafoundry-api.service -o cat --since "1 hour ago" | jq 'select(.level == "error")'
journalctl -u energyiq-datafoundry-api.service -o cat | grep '"request_id":"<id from the X-Request-Id header>"'
journalctl -u energyiq-datafoundry-api.service -o cat | jq 'select(.component == "tuya-sync")'
```

### Request IDs end to end

nginx makes the ID (`$request_id`, see `deploy/nginx.datafoundry.conf.example`), the web app's `/api/v1` proxy forwards it (or makes one when it is missing), and the API logs and echoes it. A caller's own `X-Request-Id` is kept only when it is a short safe token (8–64 of `A-Z a-z 0-9 . _ : -`). When a user reports a problem, ask for the `X-Request-Id` of the failing call (browser devtools → Network → response headers). To have nginx log the same ID:

```nginx
log_format energyx '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent '
                   '"$http_referer" "$http_user_agent" rt=$request_time request_id=$request_id';
access_log /var/log/nginx/energyx.access.log energyx;
```

### Shipping logs off the server

The API writes to stdout only; systemd stores it in journald. Keep a local window in `/etc/systemd/journald.conf` (for example `SystemMaxUse=2G`, `MaxRetentionSec=30day`) and ship to central storage with any journald-aware agent. With [Vector](https://vector.dev):

```toml
[sources.energyx_api]
type = "journald"
include_units = ["energyiq-datafoundry-api.service"]

[transforms.energyx_api_json]
type = "remap"
inputs = ["energyx_api"]
source = '''
parsed, err = parse_json(.message)
if err == null { . = merge(., parsed) }
'''

[sinks.central]
type = "http"            # or loki, elasticsearch, aws_cloudwatch_logs, datadog_logs ...
inputs = ["energyx_api_json"]
uri = "https://logs.example.com/ingest"
encoding.codec = "json"
```

Fluent Bit (`[INPUT] Name systemd, Systemd_Filter _SYSTEMD_UNIT=energyiq-datafoundry-api.service` with a JSON parser) and Promtail (`journal` scrape config) work the same way. Alert on `level == "error"` there if you want paging beyond the built-in alerts below.

## Health: /healthz and /ready

- `GET /healthz` answers 200 whenever the process is up. Use it for liveness and for the deploy smoke check (`scripts/energyiq/deploy-release.mjs --smoke-url http://127.0.0.1:8787/healthz`).
- `GET /ready` checks, each with a 2-second timeout (results are reused for 2 seconds):

| Check | Critical | Fails when | Code |
|---|---|---|---|
| `metadata_db` | yes | The metadata SQLite database does not answer a query | `METADATA_DB_UNAVAILABLE` |
| `storage_writable` | yes | A small file cannot be written in `STORAGE_ROOT_DIR` (missing volume, read-only, permissions, disk full) | `STORAGE_NOT_WRITABLE` |
| `disk_space` | yes | Free space on that disk is below `ENERGYX_MIN_FREE_DISK_MB` | `DISK_SPACE_LOW` |
| `background_jobs` | no | A job has not woken within its interval (`JOBS_STALLED`) or its latest run for some site failed (`JOBS_FAILING`) | |

  - `200 {"status":"ready"}`: everything passes.
  - `200 {"status":"degraded"}`: still serving, but a background job needs a look (see the job table below).
  - `503 {"status":"not_ready"}`: a critical check failed; the details say which. The backup script (`--health-url .../ready`) and `restart-overview.ps1` wait for 200.

  Through nginx `/ready` shows only each check's status. On the host (`curl -s http://127.0.0.1:8787/ready | jq`) or with the metrics token it also shows codes, free MB, and per job its last success, last failure and which sites are failing.

## Metrics: /metrics

Prometheus text format. Answered only to a direct connection on the host (`curl http://127.0.0.1:8787/metrics`) or with `Authorization: Bearer $ENERGYX_METRICS_TOKEN`; requests that came through nginx or the web app get 403, and nginx does not route `/metrics` to the API at all.

| Metric | Meaning |
|---|---|
| `energyx_http_requests_total{method,status_class}` | Requests served (`status_class` = `2xx` ... `5xx`) |
| `energyx_http_request_duration_seconds{method}` | Latency histogram (streams count until they end) |
| `energyx_job_runs_total{job}`, `energyx_job_failures_total{job}` | Background job runs and failures (per site for site-by-site jobs) |
| `energyx_job_last_success_timestamp_seconds{job}`, `energyx_job_last_run_timestamp_seconds{job}` | When the job last succeeded / finished a run |
| `energyx_job_failing{job}`, `energyx_job_stalled{job}` | 1 while failing / stalled |
| `energyx_ops_alerts_total{result}` | Operator alerts `sent`, `failed`, `suppressed` (rate limit) or `dropped` |
| `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `process_cpu_seconds_total`, `process_uptime_seconds` | Process resources |
| `nodejs_eventloop_lag_{mean,p99,max}_seconds` | Event-loop delay since the previous scrape; sustained p99 above ~0.5 s means requests are queueing |

A Prometheus (or Grafana Agent) on the same host:

```yaml
scrape_configs:
  - job_name: energyx-api
    static_configs: [{ targets: ["127.0.0.1:8787"] }]
```

Useful rules: `energyx_job_stalled == 1`; `rate(energyx_http_requests_total{status_class="5xx"}[5m]) > 0.1`; `time() - energyx_job_last_success_timestamp_seconds{job="tuya-sync"} > 26*3600`.

## Operator alerts

Set `ENERGYX_OPS_ALERT_WEBHOOK_URL` to a Slack incoming webhook (Slack app → Incoming Webhooks) or a Microsoft Teams incoming webhook / Workflows "post to a channel when a webhook request is received" URL; both receive `{"text": "..."}`. The API logs `operator alerts are off` at startup when it is not set. Alerts are sent in the background with a 5-second timeout: a slow or broken webhook never holds up a job, and a failed post is logged (`component: "ops-alert"`, without the URL) and counted in `energyx_ops_alerts_total{result="failed"}`.

Each message starts `EnergyX <host name>:`.

| Message | Meaning | What to do |
|---|---|---|
| `Background job <job> failed (<site>): <code>.` | A run of that job failed for that site (or as a whole). Repeats at most once an hour per job while it keeps failing. | Read the log under `component <job>`; `/ready` on the host lists every failing site. Tuya codes containing `1114` mean Tuya refused the server's IP. |
| `Background job <job> recovered (<site>).` | Every site that had failed has since succeeded. Sent only after a failure alert. | Nothing. |
| `API process crashed (uncaughtException / unhandledRejection): <code>.` | An error nothing caught; the process logged it and exited with code 1. | Check that systemd restarted it (`systemctl status energyiq-datafoundry-api.service`) and read the stack in the log (`msg: "process crashed; exiting"`). File a bug. |
| `Unhandled promise rejection in the API: <code>.` | Only when Node runs with `--unhandled-rejections=warn`; the process keeps running. | File a bug with the logged stack. |
| `API started but is not ready: <check> (<code>).` | A critical `/ready` check failed right after startup; the API answers 503 until fixed. | Fix the dependency (mount the storage volume, free disk space, check database permissions). |
| `The advisor cannot run on this server. ...` | The advisor is switched on but Docker or its worker image is missing. | Follow the fix in the message, or see Admin → System health. |

A failing site stops counting as failing after 48 hours without another attempt (for example a site that was deleted), without a recovery message.

### Background jobs

All run on timers inside the API process. A job is only watched while it is switched on.

| Job | What it does | Wakes | Stalled after |
|---|---|---|---|
| `tuya-sync` | Daily sync for the server-configured Tuya site (`ENERGYIQ_TUYA_SYNC_ENABLED=true`) | Daily at `ENERGYIQ_TUYA_SYNC_LOCAL_HOUR` (Singapore), each catch-up pass | 26 h |
| `live-sync` | Daily sync for sites connected in the app (Facility → Live connection) | Hourly, each sync pass | 3 h |
| `live-readings` | Current meter readings for Overview's live power | Every 15 min | 1 h |
| `alert-email` | Emails about stopped or offline meters and failed syncs (`ENERGYIQ_ALERT_EMAILS_ENABLED=true` with SMTP) | Every 15 min | 1 h |
| `target-alert` | Daily budget and overnight-use checks per site | Hourly | 3 h |
| `report-email` | Scheduled portfolio report emails | Every 15 min | 1 h |
| `report-agent` | Advisor report scheduling, site reports and action checks (`ENERGYIQ_REPORT_AGENT_ENABLED=true`) | Every 30 s | 10 min |

A stalled job usually means its timer died or a run is hung; restarting the API restarts every job. Persisted state (sync watermarks, sent-email records, queued reports) carries over a restart.

## Error tracking (Sentry / OpenTelemetry)

Not installed yet. The seam is `setErrorReporter()` in `apps/api/src/observability/error-reporting.ts`: request failures (HTTP 500) and process crashes are passed to the reporter with their `request_id`, and the crash handler waits up to 2 seconds for the reporter's `flush()` before exiting. To add Sentry, initialise the SDK in `apps/api/src/index.ts` after `.env` is loaded and call `setErrorReporter({ capture: (error, context) => Sentry.captureException(error, { extra: context }), flush: (ms) => Sentry.flush(ms).then(() => undefined) })`. For OpenTelemetry tracing, start the SDK in the same place; the request context (`apps/api/src/observability/request-context.ts`) is where a trace ID would join the request ID in every log line.
