import { devtools } from "@tanstack/devtools-vite";
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

const buildRequire = createRequire(import.meta.url);
const pdfjsRequire = createRequire(
  buildRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
);

export default defineConfig({
  server: { host: "127.0.0.1", port: 43230 },
  plugins: [
    devtools(),
    nitroV2Plugin({
      preset: "node-server",
      compatibilityDate: "2026-09-15",
      externals: {
        traceInclude: [
          buildRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
          buildRequire.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
          pdfjsRequire.resolve("@napi-rs/canvas"),
        ],
      },
    }),
    tanstackStart(),
    viteReact(),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
