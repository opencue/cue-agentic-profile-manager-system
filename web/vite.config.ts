import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy /api/* to the local Bun dashboard server during dev so the
    // app fetches real data instead of hitting Vite's dev server.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7891",
        changeOrigin: true,
        // When the dashboard server isn't running, vite's default proxy
        // emits an HTML 500 page. The fetcher's `res.json()` then throws
        // a confusing "non-JSON" error. Override with a JSON envelope so
        // the UI can render a helpful CTA pointing at how to start it.
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            const message = `dashboard-server-unreachable: ${err.message}`;
            try {
              res.writeHead(503, { "Content-Type": "application/json" });
            } catch { /* headers already sent */ }
            res.end(JSON.stringify({ ok: false, error: message }));
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    // Smaller chunks help the Bun static server stay snappy on cold start.
    chunkSizeWarningLimit: 600,
  },
});
