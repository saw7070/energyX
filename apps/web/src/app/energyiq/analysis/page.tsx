"use client";
import { Suspense } from "react";
import { ReportProjectGate } from "../_components/report-project-gate";
import { AnalysisView } from "../_components/analysis-view";
import { analysisMessages } from "../_components/analysis-messages";
import { useMessages } from "../_components/energyiq-locale";

function Loading() { const t = useMessages(analysisMessages); return <p className="p-6">{t("page.loading")}</p>; }

export default function Page() { return <Suspense fallback={<Loading />}><ReportProjectGate workbench>{projectId => <AnalysisView key={projectId} projectId={projectId} />}</ReportProjectGate></Suspense>; }
