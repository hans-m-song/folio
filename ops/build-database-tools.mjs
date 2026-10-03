import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

await build({
  absWorkingDir: projectRoot,
  banner: {
    js: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
  },
  bundle: true,
  entryPoints: {
    migrate: "src/database/migrate.ts",
    "seed-local-user": "src/database/seed-local-user.ts",
  },
  external: ["pg-native"],
  format: "esm",
  outExtension: { ".js": ".mjs" },
  outdir: ".output/src/database",
  platform: "node",
  target: "node24",
});
