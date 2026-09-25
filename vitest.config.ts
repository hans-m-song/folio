import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": src },
  },
  test: {
    name: "folio",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.postgres.test.ts"],
    environment: "node",
  },
});
