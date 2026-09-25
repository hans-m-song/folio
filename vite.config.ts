import { devtools } from "@tanstack/devtools-vite";
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "127.0.0.1", port: 43230 },
  plugins: [
    devtools(),
    nitroV2Plugin({ preset: "node-server", compatibilityDate: "2026-09-15" }),
    tanstackStart(),
    viteReact(),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
