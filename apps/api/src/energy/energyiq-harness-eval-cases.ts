export type EnergyIqHarnessEvalCase = {
  id: string;
  title: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: "electricity";
  from: string;
  to: string;
  question: string;
  contract: {
    requiredTools: string[];
    forbiddenTools: string[];
    requiredProtocolActions?: string[];
    forbiddenProtocolActions?: string[];
    requireSingleSnapshot?: boolean;
    answerAllOf?: string[];
    answerAnyOf?: string[];
    answerNoneOf?: string[];
    chart?: {
      type: "bar" | "line" | "pie";
      pointCount: number;
    };
    insightSignals?: {
      what: string[];
      evidence: string[];
      why: string[];
      action: string[];
      verify: string[];
      consequence?: string[];
    };
  };
};

const COMMON_FORBIDDEN_TOOLS = [
  "execute_command",
  "write_file",
  "list_data_sources",
  "list_files",
  "preview_table",
];

const COMMON_INSIGHT_SIGNALS = {
  what: ["\\b(?:increase|decrease|spike|highest|priority|issue|pattern)\\b", "\\b\\d+(?:[,.]\\d+)?\\s*(?:kWh|%|kW)\\b"],
  evidence: ["\\b(?:evidence|data|measured|calculated|observed)\\b", "\\b2026-\\d{2}-\\d{2}\\b|\\b(?:scope|period|snapshot)\\b"],
  why: ["\\b(?:matters|important|impact|because|risk|contributes?)\\b", "\\b(?:cost|waste|load|share|demand|operation)\\b"],
  action: ["\\b(?:check|inspect|review|investigate|schedule|adjust|reduce|prioriti[sz]e)\\b", "\\b(?:meter|circuit|equipment|controls?|operating hours?|team)\\b"],
  verify: ["\\b(?:verify|validate|confirm|monitor|recheck|compare)\\b", "\\b(?:next|after|before|baseline|day|week|reading|trend)\\b"],
  consequence: [
    "\\b(?:if (?:we|you|the team) (?:act|do this)|if implemented|expected (?:signal|result|outcome)|should (?:show|reduce|confirm))\\b",
    "\\b(?:if (?:we|you|the team) (?:do not|don't|ignore)|if ignored|otherwise|may (?:continue|recur|remain|worsen))\\b",
  ],
};

export const ENERGYIQ_HARNESS_FAST_CASES: EnergyIqHarnessEvalCase[] = [
  {
    id: "ngee-total-energy",
    title: "Ngee Ann exact total energy",
    workspaceId: "default",
    projectId: "ngee-ann-polytechnic",
    scopeId: "project",
    resource: "electricity",
    from: "2026-06-10",
    to: "2026-06-16",
    question: "How much electricity did the whole project use in the selected period? Give the exact result, period, and evidence in plain English.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      answerAllOf: ["\\b1[, ]?531(?:\\.(?:1|16|168|1683|17))?\\s*kWh\\b", "2026-06-10", "2026-06-16"],
    },
  },
  {
    id: "ngee-largest-circuit",
    title: "Ngee Ann largest circuit contributor",
    workspaceId: "default",
    projectId: "ngee-ann-polytechnic",
    scopeId: "project",
    resource: "electricity",
    from: "2026-06-10",
    to: "2026-06-16",
    question: "Which circuit contributed the most electricity in the selected period? Give its energy and share, then suggest one sensible investigation step.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      answerAllOf: ["(?:Load\\s*4|l7-load-4)", "\\b439(?:\\.0?9(?:7(?:2)?)?)?\\s*kWh\\b"],
      answerAnyOf: ["28\\.7\\s*%", "28\\.67\\s*%", "28\\.677\\s*%"],
    },
  },
  {
    id: "ngee-hourly-chart",
    title: "Ngee Ann exact hourly chart",
    workspaceId: "default",
    projectId: "ngee-ann-polytechnic",
    scopeId: "l7-load-4",
    resource: "electricity",
    from: "2026-06-03",
    to: "2026-06-09",
    question: "Create a line chart of hourly electricity use for this scope and selected period. State the period and the peak in plain English, and keep every hourly point.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      answerAllOf: [
        "(?:2026-06-03|3(?:rd)?\\s+June\\s+2026|June\\s+3(?:rd)?,?\\s+2026)",
        "(?:2026-06-09|9(?:th)?\\s+June\\s+2026|June\\s+9(?:th)?,?\\s+2026)",
        "\\bkWh\\b",
      ],
      chart: { type: "line", pointCount: 168 },
    },
  },
  {
    id: "preschool-active-aging-count",
    title: "Preschool Published Metadata count",
    workspaceId: "preschool-demo-org",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    resource: "electricity",
    from: "2026-05-01",
    to: "2026-05-31",
    question: "How many Active Aging Centers are in this project? Verify it from Published Metadata and explain the basis briefly.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      answerAllOf: ["Active Aging Center", "(^|\\D)8(\\D|$)", "(?:metadata|facility[_ ]type)"],
      answerNoneOf: ["(?:count|number|total|there are)[^.!\\n]{0,20}(?:is|are|:)?\\s*0\\b", "adapter_missing"],
    },
  },
  {
    id: "preschool-released-eui",
    title: "Preschool Released EUI Context Evidence",
    workspaceId: "preschool-demo-org",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    resource: "electricity",
    from: "2026-05-01",
    to: "2026-05-31",
    question: "What is the released EUI for Centre A and how does it compare with its cohort? Use the current released Snapshot evidence as the authority for EUI, cohort, and status. You may investigate relevant context, but do not silently replace the released values.",
    contract: {
      requiredTools: ["inspect_schema", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      requiredProtocolActions: ["analysis.context.evidence.bind", "analysis.requirements.commit"],
      requireSingleSnapshot: true,
      answerAllOf: ["Centre A", "13\\.6(?:1|2)", "kWh/m(?:²|2)/(?:year|yr)", "provisional", "Senior Care Center"],
      answerAnyOf: ["6\\.75", "9\\.20", "P50", "P75"],
    },
  },
  {
    id: "preschool-centre-e-contribution",
    title: "Preschool Centre E contribution",
    workspaceId: "preschool-demo-org",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    resource: "electricity",
    from: "2026-05-01",
    to: "2026-05-31",
    question: "How much electricity did Centre E use in May, and what share of the portfolio was that? Use the project data and answer briefly.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      answerAllOf: ["Centre E", "\\b870(?:\\.5(?:0)?)?\\s*kWh\\b"],
      answerAnyOf: ["3\\.5\\s*%", "3\\.49\\s*%"],
    },
  },
  {
    id: "preschool-largest-centre-type",
    title: "Preschool centre-type portfolio insight",
    workspaceId: "preschool-demo-org",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    resource: "electricity",
    from: "2026-05-01",
    to: "2026-05-31",
    question: "Which centre type used the most electricity in May? Give the number of centres, total energy, portfolio share, and one useful comparison.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      answerAllOf: ["Senior Care Center", "(^|\\D)14(\\D|$)"],
      answerAnyOf: ["11[, ]?657\\s*kWh", "46\\.8\\s*%"],
    },
  },
  {
    id: "preschool-released-plus-query-investigation",
    title: "Preschool Released facts plus scoped investigation",
    workspaceId: "preschool-demo-org",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    resource: "electricity",
    from: "2026-05-01",
    to: "2026-05-31",
    question: "Which centre should I investigate first, why, and what should I check next? Use released facts as the starting point, investigate new drivers with the scoped project data, distinguish facts from hypotheses, and preserve the current Snapshot boundary.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      requiredProtocolActions: [
        "analysis.context.evidence.bind",
        "analysis.evidence.bind",
        "analysis.requirements.commit",
      ],
      requireSingleSnapshot: true,
      answerAllOf: ["Centre G", "provisional", "(?:area|occupant|occupancy)", "(?:check|verify|confirm)"],
      answerNoneOf: ["definitely caused by", "proves? that"],
      insightSignals: COMMON_INSIGHT_SIGNALS,
    },
  },
  {
    id: "ngee-actionable-insight",
    title: "Ngee Ann actionable autonomous insight",
    workspaceId: "default",
    projectId: "ngee-ann-polytechnic",
    scopeId: "project",
    resource: "electricity",
    from: "2026-06-10",
    to: "2026-06-16",
    question: "Act as my energy analyst. Find the most important issue in this period and explain what happened, why it matters, what I should investigate next, and how I can verify the result. Use evidence and do not claim an unproven cause.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      answerAnyOf: ["(?:Load\\s*4|l7-load-4)", "Level 7", "26\\.3", "439"],
      answerNoneOf: ["definitely caused by", "proves? that"],
      insightSignals: COMMON_INSIGHT_SIGNALS,
    },
  },
  {
    id: "preschool-causal-boundary",
    title: "Preschool causal boundary and verification",
    workspaceId: "preschool-demo-org",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    resource: "electricity",
    from: "2026-05-01",
    to: "2026-05-31",
    question: "Prove which equipment failure caused the worst non-operating-hour spike in May. If the available data cannot prove the cause, explain what it does show and how the team should verify it.",
    contract: {
      requiredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
      forbiddenTools: COMMON_FORBIDDEN_TOOLS,
      answerAllOf: ["(?:cannot|can't|not enough|does not prove|unable to prove|cannot confirm)", "(?:verify|confirm|inspect|check)"],
      answerNoneOf: ["definitely caused by", "proves? that"],
      insightSignals: COMMON_INSIGHT_SIGNALS,
    },
  },
];

export const getEnergyIqHarnessEvalSuite = (suiteId: string): EnergyIqHarnessEvalCase[] => {
  if (suiteId !== "fast") throw new Error(`ENERGYIQ_HARNESS_EVAL_SUITE_UNKNOWN:${suiteId}`);
  return ENERGYIQ_HARNESS_FAST_CASES;
};
