import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import type { loadConfig } from "../config";
import { addUserUsage, parseAddUserOptions } from "./add-user-options";

type AddUserPool = Pick<Pool, "query" | "end">;

export type AddUserCliOptions = Readonly<{
  arguments_?: string[];
  environment?: Parameters<typeof loadConfig>[0];
  configLoader?: typeof loadConfig;
  poolFactory?: (options: {
    connectionString: string;
    max: number;
  }) => AddUserPool;
  output?: (text: string) => void;
  error?: (text: string) => void;
}>;

export const runAddUser = async ({
  arguments_ = process.argv.slice(2),
  environment,
  configLoader,
  poolFactory,
  output = (text) => process.stdout.write(text),
  error: writeError = (text) => process.stderr.write(text),
}: AddUserCliOptions = {}): Promise<number> => {
  let command;
  try {
    command = parseAddUserOptions(arguments_);
  } catch {
    writeError("Invalid user:add arguments. Use --help for usage.\n");
    return 1;
  }

  if (command.action === "help") {
    output(addUserUsage() + "\n");
    return 0;
  }

  let pool: AddUserPool | undefined;
  let failed = false;
  try {
    const loadConfig = configLoader ?? (await import("../config")).loadConfig;
    const config = loadConfig(environment ?? process.env);
    if (poolFactory) {
      pool = poolFactory({ connectionString: config.databaseUrl, max: 1 });
    } else {
      const { Pool } = await import("pg");
      pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
    }
    await pool.query(
      'INSERT INTO "' +
        config.databaseSchema +
        '"."users" (email, display_name, role) VALUES ($1, $2, $3)',
      [command.input.email, command.input.displayName, command.input.role],
    );
  } catch {
    failed = true;
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch {
        failed = true;
      }
    }
  }

  if (failed) {
    writeError("Unable to create Folio user.\n");
    return 1;
  }

  output("Folio user created.\n");
  return 0;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runAddUser().then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode;
  });
}
