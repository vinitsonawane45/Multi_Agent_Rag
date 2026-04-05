import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.VITE_PROXY_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": { target: api, changeOrigin: true },
      "/chat": { target: api, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      "/ingest": { target: api, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
    },
  },
});
