import React from "react";
import ReactDOM from "react-dom/client";
import { NapShareApp } from "@/NapShareApp";
import "@/styles/globals.css";

/** Standalone HTML export: NP Energy Analysis page only (no other routes or mock projects). */
ReactDOM.createRoot(document.getElementById("root")!).render(<NapShareApp />);
