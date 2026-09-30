"use client";
import { Suspense } from "react";
import { ReportProjectGate } from "../_components/report-project-gate";
import { ReportLibraryLoading, ReportLibraryView } from "../_components/report-library";
export default function Page() { return <Suspense fallback={<ReportLibraryLoading />}><ReportProjectGate workbench>{(projectId) => <ReportLibraryView projectId={projectId} view="reports" />}</ReportProjectGate></Suspense>; }