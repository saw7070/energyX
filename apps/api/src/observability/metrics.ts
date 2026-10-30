import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

/**
 * A small Prometheus registry: counters and histograms the API updates as it works, plus collectors that read a value
 * at scrape time. Rendered in the text exposition format (version 0.0.4) on GET /metrics.
 */
export type MetricLabels = Record<string, string>;
export type MetricSample = { labels?: MetricLabels; value: number; suffix?: string };
export type MetricFamily = { name: string; help: string; type: "counter" | "gauge" | "histogram"; samples: MetricSample[] };

export type Counter = { inc(labels?: MetricLabels, by?: number): void };
export type Histogram = { observe(labels: MetricLabels, value: number): void };

const escapeLabel = (value: string): string => value.replace(/\\/gu, "\\\\").replace(/\n/gu, "\\n").replace(/"/gu, '\\"');

const labelKey = (labels: MetricLabels = {}): string =>
  Object.keys(labels).sort().map((key) => `${key}="${escapeLabel(labels[key] ?? "")}"`).join(",");

const formatValue = (value: number): string =>
  Number.isNaN(value) ? "NaN" : value === Infinity ? "+Inf" : value === -Infinity ? "-Inf" : String(value);

export const renderMetricFamilies = (families: MetricFamily[]): string => {
  const lines: string[] = [];
  for (const family of families) {
    lines.push(`# HELP ${family.name} ${family.help.replace(/\\/gu, "\\\\").replace(/\n/gu, "\\n")}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);
    for (const sample of family.samples) {
      const labels = labelKey(sample.labels);
      lines.push(`${family.name}${sample.suffix ?? ""}${labels ? `{${labels}}` : ""} ${formatValue(sample.value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
};

export const createMetricsRegistry = () => {
  const families: Array<() => MetricFamily> = [];
  const collectors: Array<() => MetricFamily[]> = [];

  const counter = (name: string, help: string): Counter => {
    const values = new Map<string, { labels: MetricLabels; value: number }>();
    families.push(() => ({ name, help, type: "counter", samples: [...values.values()].map(({ labels, value }) => ({ labels, value })) }));
    return {
      inc(labels = {}, by = 1) {
        const key = labelKey(labels);
        const current = values.get(key);
        if (current) current.value += by;
        else values.set(key, { labels, value: by });
      },
    };
  };

  const histogram = (name: string, help: string, buckets: number[]): Histogram => {
    const sorted = [...buckets].sort((a, b) => a - b);
    const series = new Map<string, { labels: MetricLabels; counts: number[]; sum: number; count: number }>();
    families.push(() => ({
      name, help, type: "histogram",
      samples: [...series.values()].flatMap(({ labels, counts, sum, count }) => [
        ...sorted.map((bound, index) => ({ labels: { ...labels, le: String(bound) }, value: counts[index] ?? 0, suffix: "_bucket" })),
        { labels: { ...labels, le: "+Inf" }, value: count, suffix: "_bucket" },
        { labels, value: sum, suffix: "_sum" },
        { labels, value: count, suffix: "_count" },
      ]),
    }));
    return {
      observe(labels, value) {
        const key = labelKey(labels);
        let entry = series.get(key);
        if (!entry) {
          entry = { labels, counts: sorted.map(() => 0), sum: 0, count: 0 };
          series.set(key, entry);
        }
        // Prometheus buckets are cumulative: an observation counts in every bucket whose bound it fits under.
        sorted.forEach((bound, index) => { if (value <= bound) entry.counts[index] = (entry.counts[index] ?? 0) + 1; });
        entry.sum += value;
        entry.count += 1;
      },
    };
  };

  const allFamilies = (): MetricFamily[] => [
    ...families.map((family) => family()),
    ...collectors.flatMap((collector) => {
      try {
        return collector();
      } catch {
        // One broken collector must not cost the rest of the scrape.
        return [];
      }
    }),
  ];

  return {
    counter,
    histogram,
    /** Values read at scrape time, such as memory or the background jobs' state. */
    collect: (collector: () => MetricFamily[]): void => { collectors.push(collector); },
    families: allFamilies,
    render: (): string => renderMetricFamilies(allFamilies()),
  };
};

export type MetricsRegistry = ReturnType<typeof createMetricsRegistry>;

/** The API process's registry, served on GET /metrics. */
export const metrics = createMetricsRegistry();

const KNOWN_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const httpRequests = metrics.counter("energyx_http_requests_total", "HTTP requests served, by method and status class.");
const httpDuration = metrics.histogram(
  "energyx_http_request_duration_seconds",
  "Time from receiving a request to finishing its response, by method. Streams count until they end.",
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
);

export const observeHttpRequest = (method: string | undefined, status: number, durationMs: number): void => {
  const normalized = method && KNOWN_METHODS.has(method) ? method : "OTHER";
  const statusClass = status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : "unknown";
  httpRequests.inc({ method: normalized, status_class: statusClass });
  httpDuration.observe({ method: normalized }, durationMs / 1000);
};

let eventLoopDelay: IntervalHistogram | undefined;
const EVENT_LOOP_RESOLUTION_MS = 20;

/** Start measuring event-loop lag; until then the lag metrics are absent. */
export const startProcessMetrics = (): void => {
  if (eventLoopDelay) return;
  eventLoopDelay = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  eventLoopDelay.enable();
};

export const stopProcessMetrics = (): void => {
  eventLoopDelay?.disable();
  eventLoopDelay = undefined;
};

const processStartSeconds = Math.round((Date.now() - process.uptime() * 1000) / 1000);

metrics.collect(() => {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const families: MetricFamily[] = [
    { name: "process_resident_memory_bytes", help: "Resident memory size in bytes.", type: "gauge", samples: [{ value: memory.rss }] },
    { name: "nodejs_heap_used_bytes", help: "V8 heap in use, in bytes.", type: "gauge", samples: [{ value: memory.heapUsed }] },
    { name: "nodejs_heap_total_bytes", help: "V8 heap reserved, in bytes.", type: "gauge", samples: [{ value: memory.heapTotal }] },
    { name: "nodejs_external_memory_bytes", help: "Memory held outside the V8 heap (buffers), in bytes.", type: "gauge", samples: [{ value: memory.external }] },
    { name: "process_cpu_seconds_total", help: "User and system CPU time spent, in seconds.", type: "counter", samples: [{ value: (cpu.user + cpu.system) / 1e6 }] },
    { name: "process_start_time_seconds", help: "When the process started, in seconds since the Unix epoch.", type: "gauge", samples: [{ value: processStartSeconds }] },
    { name: "process_uptime_seconds", help: "How long the process has been running, in seconds.", type: "gauge", samples: [{ value: Math.round(process.uptime()) }] },
  ];
  if (eventLoopDelay && eventLoopDelay.count > 0) {
    // Since the previous scrape: a busy loop shows as a high p99 or max even when the mean looks fine. The histogram
    // records the whole sampling interval, so an idle loop reads ~20 ms; report only the delay beyond it.
    const seconds = (nanoseconds: number) => Math.max(0, nanoseconds / 1e6 - EVENT_LOOP_RESOLUTION_MS) / 1000;
    families.push(
      { name: "nodejs_eventloop_lag_mean_seconds", help: "Mean event-loop delay since the last scrape.", type: "gauge", samples: [{ value: seconds(eventLoopDelay.mean) }] },
      { name: "nodejs_eventloop_lag_p99_seconds", help: "99th percentile event-loop delay since the last scrape.", type: "gauge", samples: [{ value: seconds(eventLoopDelay.percentile(99)) }] },
      { name: "nodejs_eventloop_lag_max_seconds", help: "Longest event-loop delay since the last scrape.", type: "gauge", samples: [{ value: seconds(eventLoopDelay.max) }] },
    );
    eventLoopDelay.reset();
  }
  return families;
});
