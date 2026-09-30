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
    outDir: "dist-eliteiot-export",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "eliteiot-export.entry.html")
    }
  }
});
