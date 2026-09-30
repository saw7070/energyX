"use client";
import { Suspense } from "react";
import { ReportProjectGate } from "../_components/report-project-gate";
import { KeyPoints } from "../_components/key-points";
export default function Page(){return <Suspense fallback={<p>Loading key points…</p>}><ReportProjectGate>{id=><KeyPoints key={id} projectId={id}/>}</ReportProjectGate></Suspense>;}
