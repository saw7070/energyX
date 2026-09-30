"use client";
import {Suspense} from "react";
import {ReportProjectGate} from "../_components/report-project-gate";
import {ProjectActions} from "../_components/project-actions";
import {useMessages} from "../_components/energyiq-locale";
import {actionsPageMessages} from "../_components/project-actions-messages";
export default function Page(){const t=useMessages(actionsPageMessages);return <Suspense fallback={<p>{t("loading")}</p>}><ReportProjectGate>{id=><ProjectActions key={id} projectId={id}/>}</ReportProjectGate></Suspense>;}
