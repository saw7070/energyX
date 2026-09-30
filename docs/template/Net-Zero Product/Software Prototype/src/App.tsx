import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { AnalysisPage } from "@/pages/AnalysisPage";
import { BillingPage } from "@/pages/BillingPage";
import { DataPage } from "@/pages/DataPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { PortfolioPage } from "@/pages/PortfolioPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { UtilitiesPage } from "@/pages/UtilitiesPage";

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/dashboard" element={<OverviewPage />} />
        <Route path="/utilities" element={<Navigate to="/utilities/electricity" replace />} />
        <Route
          path="/utilities/electricity"
          element={
            <UtilitiesPage
              initialUtility="Electricity"
              title="Utilities / Electricity"
              subtitle="Electricity monitoring, trend analysis, and quality indicators."
              breadcrumbs={["Dashboard", "Utilities", "Electricity"]}
            />
          }
        />
        <Route
          path="/utilities/water"
          element={
            <UtilitiesPage
              initialUtility="Water"
              title="Utilities / Water"
              subtitle="Water monitoring, trend analysis, and quality indicators."
              breadcrumbs={["Dashboard", "Utilities", "Water"]}
            />
          }
        />
        <Route
          path="/utilities/gas"
          element={
            <UtilitiesPage
              initialUtility="Gas"
              title="Utilities / Gas"
              subtitle="Gas monitoring, trend analysis, and quality indicators."
              breadcrumbs={["Dashboard", "Utilities", "Gas"]}
            />
          }
        />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/billing" element={<Navigate to="/billing/bills" replace />} />
        <Route path="/billing/tenants" element={<BillingPage section="tenants" />} />
        <Route path="/billing/contracts" element={<BillingPage section="contracts" />} />
        <Route path="/billing/bills" element={<BillingPage section="bills" />} />
        <Route path="/data" element={<Navigate to="/data/devices" replace />} />
        <Route path="/data/devices" element={<DataPage section="devices" />} />
        <Route path="/data/gateways" element={<DataPage section="gateways" />} />
        <Route path="/data/messages" element={<DataPage section="messages" />} />
        <Route path="/data/logs" element={<DataPage section="logs" />} />
        <Route path="/data/alarms" element={<DataPage section="alarms" />} />
        <Route path="/project" element={<Navigate to="/project/configuration" replace />} />
        <Route path="/project/roles" element={<ProjectPage section="roles" />} />
        <Route path="/project/users" element={<ProjectPage section="users" />} />
        <Route path="/project/spaces" element={<ProjectPage section="spaces" />} />
        <Route path="/project/alarm-rules" element={<ProjectPage section="alarm-rules" />} />
        <Route path="/project/configuration" element={<ProjectPage section="configuration" />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/overview" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
