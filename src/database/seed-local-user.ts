import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { localAdministratorEmail } from "../auth/local";
import { loadAuthConfig, loadConfig } from "../config";
import { AppError, OperationCleanupError } from "../domain/errors";
import { writeDatabaseCliFailure } from "./cli-errors";
import {
  writeServerSuccess,
  type DiagnosticWriters,
} from "../server/error-handling";

type SeedLocalUserPool = Pick<Pool, "query" | "end">;

export type SeedLocalUserOptions = Readonly<{
  environment?: Parameters<typeof loadConfig>[0];
  poolFactory?: (options: {
    connectionString: string;
    max: number;
  }) => SeedLocalUserPool;
  configLoader?: typeof loadConfig;
  authConfigLoader?: typeof loadAuthConfig;
  output?: (text: string) => void;
  error?: (line: string) => void;
  successWriters?: DiagnosticWriters;
}>;

export const runSeedLocalUser = async ({
  environment = process.env,
  poolFactory = (options) => new Pool(options),
  configLoader = loadConfig,
  authConfigLoader = loadAuthConfig,
  output = (text) => process.stdout.write(text),
  error: writeError = (line) => process.stderr.write(`${line}\n`),
  successWriters,
}: SeedLocalUserOptions = {}): Promise<number> => {
  let stage = "configuration";
  let mutation = false;
  let pool: SeedLocalUserPool | undefined;
  let failure: { error: unknown; stage: string } | undefined;
  try {
    const config = configLoader(environment);
    const authConfig = authConfigLoader(environment);
    if (authConfig.authMode !== "local" || authConfig.nodeEnv === "production")
      throw new AppError({ code: "INPUT_INVALID", stage: "configuration" });

    stage = "database";
    pool = poolFactory({ connectionString: config.databaseUrl, max: 1 });
    stage = "seed";
    mutation = true;
    await pool.query(
      `INSERT INTO "${config.databaseSchema}"."users" AS target (email, display_name, google_subject, role, active) VALUES ($1, $2, NULL, 'administrator', true) ON CONFLICT (lower(email)) DO UPDATE SET display_name = COALESCE(NULLIF(target.display_name, ''), EXCLUDED.display_name), google_subject = NULL, role = 'administrator', active = true`,
      [localAdministratorEmail, "Local development administrator"],
    );
    writeServerSuccess(
      {
        operation: "seed_local_user",
        stage,
        mutation,
        metadata: { count: 1 },
      },
      successWriters,
    );
    output("Local development account ready.\n");
  } catch (error) {
    failure = { error, stage };
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        failure = failure
          ? {
              error: new OperationCleanupError(failure.error, error, "close"),
              stage: failure.stage,
            }
          : { error, stage: "close" };
      }
    }
  }

  if (!failure) return 0;
  writeDatabaseCliFailure(
    failure.error,
    { operation: "seed_local_user", stage: failure.stage, mutation },
    writeError,
  );
  return 1;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runSeedLocalUser().then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode;
  });
}
