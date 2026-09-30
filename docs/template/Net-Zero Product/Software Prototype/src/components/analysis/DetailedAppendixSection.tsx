interface CircuitDetailRow {
  circuit: string;
  tag: string;
  dailyAvg: number;
  monthlyTotal: number;
  unit: string;
}

interface RawIntervalSummaryRow {
  metric: string;
  value: string;
}

interface EventLogRow {
  time: string;
  source: string;
  event: string;
  severity: string;
  status: string;
}

interface DetailedAppendixSectionProps {
  circuitDetails: CircuitDetailRow[];
  rawIntervalSummary: RawIntervalSummaryRow[];
  eventLogs: EventLogRow[];
}

export function DetailedAppendixSection({
  circuitDetails,
  rawIntervalSummary,
  eventLogs
}: DetailedAppendixSectionProps) {
  return (
    <div className="grid gap-4">
      <section className="panel p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">Circuit Detailed Table</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="bg-shell-700 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left">Circuit</th>
                <th className="px-3 py-2 text-left">Tag</th>
                <th className="px-3 py-2 text-right">Daily Avg</th>
                <th className="px-3 py-2 text-right">Monthly Total</th>
                <th className="px-3 py-2 text-left">Unit</th>
              </tr>
            </thead>
            <tbody>
              {circuitDetails.map((row) => (
                <tr key={`${row.circuit}-${row.tag}`} className="border-t border-shell-600">
                  <td className="px-3 py-2 text-slate-200">{row.circuit}</td>
                  <td className="px-3 py-2 text-slate-300">{row.tag}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{row.dailyAvg.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-slate-200">{row.monthlyTotal.toLocaleString()}</td>
                  <td className="px-3 py-2 text-slate-400">{row.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Raw Interval Data Summary</h3>
          <div className="space-y-2">
            {rawIntervalSummary.map((item) => (
              <div key={item.metric} className="flex items-center justify-between rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm">
                <span className="text-slate-400">{item.metric}</span>
                <span className="font-medium text-slate-200">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Alarm & Event Logs</h3>
          <div className="max-h-72 overflow-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="bg-shell-700 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2 text-left">Event</th>
                  <th className="px-3 py-2 text-left">Severity</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {eventLogs.map((item, index) => (
                  <tr key={`${item.time}-${item.source}-${index}`} className="border-t border-shell-600">
                    <td className="px-3 py-2 text-slate-200">{item.time}</td>
                    <td className="px-3 py-2 text-slate-300">{item.source}</td>
                    <td className="px-3 py-2 text-slate-300">{item.event}</td>
                    <td className="px-3 py-2 text-slate-300">{item.severity}</td>
                    <td className="px-3 py-2 text-slate-400">{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
