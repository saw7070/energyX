import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import App from "@/App";
import { AppProvider } from "@/context/AppContext";
import { NP_V2_PROJECT_ID } from "@/mock/napEnergyAnalysisDataV2";
import "@/styles/globals.css";

/** Standalone HTML export: full app shell, opens on Analysis with Ngee Ann Poly v2.0 selected. */
function ExportBootstrap() {
  return (
    <MemoryRouter initialEntries={["/analysis"]}>
      <AppProvider
        initialProjectId={NP_V2_PROJECT_ID}
        shareExport={{ lockNavigation: true, restrictProjectIds: [NP_V2_PROJECT_ID] }}
      >
        <App />
      </AppProvider>
    </MemoryRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ExportBootstrap />
  </React.StrictMode>
);
