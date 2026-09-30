"use client";
import type { EnergyProjectSetupDto } from "../../../lib/config-api";
import { useMessages } from "./energyiq-locale";
import { projectSetupMessages } from "./report-project-setup-messages";
import { projectMeterName } from "./project-meter-name";
import { ReportMarkdown } from "./report-file-preview";
import styles from "./report-workbench.module.css";

function ReferenceValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const t = useMessages(projectSetupMessages);
  if (value === null || value === undefined) return <span>{t("notSpecified")}</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (depth >= 3) return <span>{t("detailsOmitted")}</span>;
  const entries = Object.entries(value);
  return <ul>{entries.slice(0, 10).map(([key, item]) => <li key={key}>{!Array.isArray(value) && <strong>{key.replace(/_/g, " ")}: </strong>}<ReferenceValue value={item} depth={depth + 1} /></li>)}{entries.length > 10 && <li>{t("entriesOmitted")}</li>}</ul>;
}

export function ProjectConfigurationSummary({ setup, contextNotes, expanded = false }: { setup: EnergyProjectSetupDto; contextNotes?: string; expanded?: boolean }) {
  const t = useMessages(projectSetupMessages);
  const document = setup.draft.document;
  if (!document) return <p>{t("detailsUnavailable")}</p>;
  const nodes = document.nodes ?? [];
  const meters = document.meter_mapping?.rows ?? [];
  const virtualMeters = document.meter_mapping?.virtual_meters ?? [];
  const nodeNames = new Map(nodes.map(node => [node.id, node.name]));
  const meterNames = new Map(meters.map(meter => [meter.id, projectMeterName(meter)]));
  const tierNames = new Map((document.tiers ?? []).map(tier => [tier.id, tier.alias]));
  const visited = new Set<string>();
  function tree(parentId?: string, depth = 0): React.ReactNode {
    return nodes.filter(node => node.parent_id === parentId || (!parentId && !node.parent_id)).sort((a, b) => a.sort_order - b.sort_order).map(node => {
      if (visited.has(node.id)) return null;
      visited.add(node.id);
      return <li key={node.id}><strong>{node.name}</strong>{tierNames.get(node.tier_definition_id) && <> · {tierNames.get(node.tier_definition_id)}</>}{node.area_sqm != null && <> · {node.area_sqm} m²</>}{node.occupant_count != null && <> · {t("occupants", { count: node.occupant_count })}</>}{depth < 12 && <ul>{tree(node.id, depth + 1)}</ul>}</li>;
    });
  }
  const hierarchy = tree();
  const remaining = nodes.filter(node => !visited.has(node.id));
  return <details open={expanded || undefined} className={styles.configurationSummary}>
    <summary>{t("viewConfiguration")}</summary>
    <div style={expanded ? { maxHeight: "none", overflow: "visible" } : undefined}>
      <h3>{t("savedDraft", { revision: setup.draft.revision })}</h3>
      <p>{t("draftNote")}</p>
      <p><strong>{document.project.name}</strong> · {document.project.timezone}</p>
      <h4>{t("hierarchy", { count: nodes.length })}</h4>
      {nodes.length ? <ul>{hierarchy}{remaining.length > 0 && <li>{t("otherEntries")}<ul>{remaining.map(node => <li key={node.id}>{node.name}</li>)}</ul></li>}</ul> : <p>{t("noHierarchy")}</p>}
      <h4>{t("meterOwnership", { count: meters.length })}</h4>
      {meters.length ? <div className={styles.configurationTable}><table><thead><tr><th>{t("meter")}</th><th>{t("assignedLocation")}</th><th>{t("resourceCategory")}</th><th>{t("aggregation")}</th></tr></thead><tbody>{meters.map(meter => <tr key={meter.id}><td>{projectMeterName(meter)}</td><td>{nodeNames.get(meter.scope_id) ?? t("unassignedLocation")}</td><td>{meter.resource} / {meter.category}</td><td>{meter.aggregation_usage} · {meter.meter_role} · {meter.coverage}</td></tr>)}</tbody></table></div> : <p>{t("noMeters")}</p>}
      <h4>{t("virtualMeters", { count: virtualMeters.length })}</h4>
      {virtualMeters.length ? <ul>{virtualMeters.map(meter => <li key={meter.id}><strong>{projectMeterName(meter)}</strong> · {nodeNames.get(meter.scope_id) ?? t("unknownLocation")}<p>{meter.terms.length ? meter.terms.map((term, index) => `${term.coefficient === -1 ? "− " : index ? "+ " : ""}${meterNames.get(term.mapping_row_id) ?? t("unknownMeter")}`).join(" ") : t("noCalculation")}</p></li>)}</ul> : <p>{t("noVirtualMeters")}</p>}
      {nodes.some(node => node.metadata && Object.keys(node.metadata).length) && <><h4>{t("additionalInfo")}</h4><p>{t("additionalInfoNote")}</p>{nodes.filter(node => node.metadata && Object.keys(node.metadata).length).map(node => <section key={node.id}><strong>{node.name}</strong><ReferenceValue value={node.metadata} /></section>)}</>}
      {contextNotes && <><h4>{t("analysisContext")}</h4><ReportMarkdown>{contextNotes}</ReportMarkdown></>}
    </div>
  </details>;
}

