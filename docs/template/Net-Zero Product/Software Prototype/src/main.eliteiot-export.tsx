import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import App from "@/App";
import { AppProvider } from "@/context/AppContext";
import { ELITE_PROJECT_ID } from "@/mock/eliteiotEnergyAnalysisData";
import "@/styles/globals.css";

/** Standalone HTML export: full app shell, opens on Analysis with EliteIOT selected. */
function ExportBootstrap() {
  return (
    <MemoryRouter initialEntries={["/analysis"]}>
      <AppProvider
        initialProjectId={ELITE_PROJECT_ID}
        shareExport={{ lockNavigation: true, restrictProjectIds: [ELITE_PROJECT_ID] }}
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
