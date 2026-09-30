import React from "react";

import type { NgeeAnnEnergyCompositionViewModel } from "./ngee-ann-overview-view-model";

type CircuitRow = NgeeAnnEnergyCompositionViewModel["circuits"]["rows"][number];

export function NgeeAnnCircuitRanking({
  view,
}: {
  view: NgeeAnnEnergyCompositionViewModel["circuits"];
}) {
  return (
    <section
      aria-labelledby="ngee-ann-circuit-ranking-title"
      className="border-b border-border px-5 py-6 lg:px-7 lg:py-7"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Circuit evidence</p>
          <h3 id="ngee-ann-circuit-ranking-title" className="mt-1 text-lg font-semibold tracking-[-0.015em] text-foreground">
            Top Circuit Ranking
          </h3>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">
            Published component Circuits ranked by current Snapshot energy, so the first equipment checks are visible without opening technical Evidence.
          </p>
        </div>
        {view.status === "available" ? (
          <span className="shrink-0 rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-muted">
            {view.rows.length} published Circuit rows
          </span>
        ) : null}
      </div>

      {view.status !== "available" ? (
        <div className="mt-5 rounded-lg border border-border bg-surface-subtle px-4 py-3" role="status">
          <p className="text-sm font-semibold text-foreground">Circuit ranking unavailable</p>
          <p className="mt-1 text-sm leading-6 text-muted">{view.reason}</p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs leading-5 text-muted">
            This uses the server-published rank. Share and movement are validated against the official Project total and previous window; no client-side “Top 10 average” is inferred.
          </p>
          <div className="mt-4 hidden overflow-hidden rounded-xl border border-border lg:block">
            <table className="w-full table-fixed border-collapse text-left">
              <caption className="sr-only">
                Published component Circuit ranking by current Snapshot energy
              </caption>
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[31%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[15%]" />
                <col className="w-[11%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead className="bg-surface-subtle text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th scope="col" className="px-3 py-3">Rank</th>
                  <th scope="col" className="px-3 py-3">Circuit</th>
                  <th scope="col" className="px-3 py-3">Level</th>
                  <th scope="col" className="px-3 py-3">Category</th>
                  <th scope="col" className="px-3 py-3">Consumption</th>
                  <th scope="col" className="px-3 py-3">Share of Project</th>
                  <th scope="col" className="px-3 py-3">Validated movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {view.rows.map((row) => (
                  <CircuitTableRow key={row.meterNodeId} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 lg:hidden">
            {view.rows.map((row) => (
              <CircuitCard key={row.meterNodeId} row={row} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CircuitTableRow({ row }: { row: CircuitRow }) {
  return (
    <tr data-circuit-rank={row.rank} className="align-top">
      <td className="px-3 py-3.5">
        <RankBadge rank={row.rank} />
      </td>
      <th scope="row" className="break-words px-3 py-3.5 text-sm font-semibold leading-5 text-foreground">
        {row.name}
      </th>
      <td className="break-words px-3 py-3.5 text-sm text-muted">{row.levelName}</td>
      <td className="break-words px-3 py-3.5 text-sm text-muted">{row.category}</td>
      <td className="px-3 py-3.5 text-sm font-semibold tabular-nums text-foreground">{row.currentUsageKwh} kWh</td>
      <td className="px-3 py-3.5 text-sm font-semibold tabular-nums text-foreground">{row.projectShare}</td>
      <td className="px-3 py-3.5 text-sm tabular-nums text-foreground">
        <Movement row={row} />
      </td>
    </tr>
  );
}

function CircuitCard({ row }: { row: CircuitRow }) {
  return (
    <article data-circuit-rank={row.rank} className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <RankBadge rank={row.rank} />
        <div className="min-w-0">
          <h4 className="break-words text-sm font-semibold leading-5 text-foreground">{row.name}</h4>
          <p className="mt-1 text-xs text-muted">{row.levelName} · {row.category}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <div>
          <dt className="text-muted">Consumption</dt>
          <dd className="mt-1 font-semibold tabular-nums text-foreground">{row.currentUsageKwh} kWh</dd>
        </div>
        <div>
          <dt className="text-muted">Share of Project</dt>
          <dd className="mt-1 font-semibold tabular-nums text-foreground">{row.projectShare}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">Validated movement</dt>
          <dd className="mt-1 tabular-nums text-foreground"><Movement row={row} /></dd>
        </div>
      </dl>
    </article>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className={[
      "inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
      rank <= 3 ? "bg-primary text-white" : "bg-surface-subtle text-foreground",
    ].join(" ")}>{rank}</span>
  );
}

function Movement({ row }: { row: CircuitRow }) {
  if (row.movement.status !== "available") {
    return <span className="text-muted">Unavailable</span>;
  }
  return (
    <span>
      <span className="font-semibold">{row.changePct}</span>
      <span className="mt-0.5 block text-xs text-muted">{row.changeKwh}</span>
    </span>
  );
}
