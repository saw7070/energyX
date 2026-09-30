import { Suspense } from "react";
import { ReportChatLoading, ReportChatPage } from "../_components/report-chat-page";
export default function Page() { return <Suspense fallback={<ReportChatLoading />}><ReportChatPage /></Suspense>; }