import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = `http://127.0.0.1:${process.env.PORT || 8787}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    host: "127.0.0.1",
    proxy: { "/api": api, "/files": api },
  },
});
