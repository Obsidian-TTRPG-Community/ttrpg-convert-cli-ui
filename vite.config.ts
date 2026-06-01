import { defineConfig } from "vite";

// Tauri expects a fixed dev port and uses ../dist for the built frontend.
export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: "es2021", outDir: "dist" },
});
