import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./desk-src", import.meta.url)) },
  },
  build: {
    rollupOptions: { input: ["copilot.html", "copilot-admin.html"] },
    outDir: "dist",
  },
  server: {
    watch: { usePolling: true },
    fs: { deny: ["**/.env*", "**/.git/**", "**/business/**"] },
  },
});
