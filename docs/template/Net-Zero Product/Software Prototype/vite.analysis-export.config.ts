import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  build: {
    outDir: "dist-analysis-export",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "analysis-export.entry.html")
    }
  }
});
