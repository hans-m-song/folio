import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": src },
  },
  test: {
    name: "folio-postgres",
    include: ["src/database/**/*.postgres.test.ts"],
    environment: "node",
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
