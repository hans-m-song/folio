import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { z } from "zod";

import { loadConfig } from "../config";
import { OperationCleanupError } from "../domain/errors";
import {
  expandCredentialScopes,
  generateCredentialSecret,
  proposalCredentialInputSchema,
  proposalCredentialIssuanceScopeSchema,
} from "../domain/proposals";
import { writeDatabaseCliFailure } from "./cli-errors";
import { ProposalRepository } from "./proposal-repository";
import {
  writeServerSuccess,
  type DiagnosticWriters,
  type LogWriter,
} from "../server/error-handling";

const uuidSchema = z.string().uuid();

export type CredentialCommand =
  | { action: "scopes" }
  | {
      action: "create";
      administratorId: string;
      actorUserId: string;
      defaultOwnerId: string;
      label: string;
      scopes: z.infer<typeof proposalCredentialIssuanceScopeSchema>[];
    }
  | {
      action: "revoke";
      administratorId: string;
      credentialId: string;
    };

export const parseCredentialCommand = (
  arguments_: string[],
): CredentialCommand => {
  const parsed = parseArgs({
    args: arguments_,
    allowPositionals: true,
    strict: true,
    options: {
      "administrator-id": { type: "string" },
      "actor-user-id": { type: "string" },
      "default-owner-id": { type: "string" },
      "credential-id": { type: "string" },
      label: { type: "string" },
      scope: { type: "string", multiple: true },
    },
  });
  const action = parsed.positionals[0];
  if (parsed.positionals.length !== 1)
    throw new Error("Expected exactly one action: scopes, create, or revoke");
  if (action === "scopes") return { action };
  const administratorId = uuidSchema.parse(parsed.values["administrator-id"]);
  if (action === "revoke")
    return {
      action,
      administratorId,
      credentialId: uuidSchema.parse(parsed.values["credential-id"]),
    };
  if (action !== "create")
    throw new Error("Expected scopes, create, or revoke");
  const scopePatterns = z.array(z.string()).min(1).parse(parsed.values.scope);
  const scopes = expandCredentialScopes(scopePatterns);
  return {
    action,
    administratorId,
    actorUserId: uuidSchema.parse(parsed.values["actor-user-id"]),
    defaultOwnerId: uuidSchema.parse(parsed.values["default-owner-id"]),
    label: z.string().trim().min(1).max(200).parse(parsed.values.label),
    scopes,
  };
};

const scopeDescriptions: Record<
  z.infer<typeof proposalCredentialIssuanceScopeSchema>,
  string
> = {
  "bank_rows:read": "Read imported bank activity metadata",
  "transactions:search": "Search transactions in every status",
  "transactions:draft": "Create and edit this credential's drafts",
  "transactions:categorize": "Categorize any transaction",
  "bank_matches:suggest": "Suggest existing matches for bank rows",
  "artifacts:read": "Read artifact metadata, not file contents",
  "artifacts:upload": "Upload artifacts for human review",
};

export const credentialScopeHelp = () =>
  proposalCredentialIssuanceScopeSchema.options
    .map((scope) => `${scope}\t${scopeDescriptions[scope]}`)
    .join("\n");

export { generateCredentialSecret } from "../domain/proposals";

type CredentialRepository = Pick<
  ProposalRepository,
  "createCredential" | "revokeCredential"
>;

export type ManageCredentialCliOptions = Readonly<{
  arguments_?: string[];
  environment?: Parameters<typeof loadConfig>[0];
  configLoader?: typeof loadConfig;
  poolFactory?: (options: { connectionString: string; max: number }) => Pool;
  repositoryFactory?: (
    pool: Pool,
    schema: string,
    gstRegistered: boolean,
  ) => CredentialRepository;
  secretGenerator?: typeof generateCredentialSecret;
  output?: (text: string) => void;
  error?: LogWriter;
  successWriters?: DiagnosticWriters;
}>;

export const runManageMcpCredential = async ({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  configLoader = loadConfig,
  poolFactory = (options) => new Pool(options),
  repositoryFactory = (pool, schema, gstRegistered) =>
    new ProposalRepository(pool, schema, gstRegistered),
  secretGenerator = generateCredentialSecret,
  output = (text) => process.stdout.write(text),
  error: writeError = (line) => process.stderr.write(`${line}\n`),
  successWriters,
}: ManageCredentialCliOptions = {}): Promise<number> => {
  let stage = "arguments";
  let mutation = false;
  let ids: {
    actorId?: string;
    userId?: string;
    credentialId?: string;
  } = {};
  let pool: Pool | undefined;
  let failure: { error: unknown; stage: string } | undefined;
  try {
    const command = parseCredentialCommand(arguments_);
    if (command.action === "scopes") {
      output(`${credentialScopeHelp()}\n`);
      return 0;
    }
    if (command.action === "revoke")
      ids = {
        actorId: command.administratorId,
        credentialId: command.credentialId,
      };
    else
      ids = {
        actorId: command.administratorId,
        userId: command.actorUserId,
      };
    stage = "configuration";
    const config = configLoader(environment);
    pool = poolFactory({ connectionString: config.databaseUrl, max: 1 });
    const repository = repositoryFactory(
      pool,
      config.databaseSchema,
      config.gstRegistered,
    );
    if (command.action === "revoke") {
      stage = "revoke";
      mutation = true;
      await repository.revokeCredential(
        command.administratorId,
        command.credentialId,
      );
      writeServerSuccess(
        {
          operation: "mcp_credential_revoke",
          stage,
          mutation,
          ids,
        },
        successWriters,
      );
      output("MCP credential revoked.\n");
    } else {
      stage = "create";
      const secret = secretGenerator();
      const input = proposalCredentialInputSchema.parse({
        label: command.label,
        tokenHash: secret.tokenHash,
        actorUserId: command.actorUserId,
        defaultOwnerId: command.defaultOwnerId,
        scopes: command.scopes,
      });
      mutation = true;
      const credential = await repository.createCredential(
        command.administratorId,
        input,
      );
      ids = { ...ids, credentialId: credential.id };
      mutation = true;
      writeServerSuccess(
        {
          operation: "mcp_credential_create",
          stage,
          mutation,
          ids,
          metadata: { count: command.scopes.length },
        },
        successWriters,
      );
      output(
        `Credential ID: ${credential.id}\nToken (shown once): ${secret.token}\nStore this token securely; Folio cannot display it again.\n`,
      );
    }
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
  if (failure) {
    writeDatabaseCliFailure(
      failure.error,
      {
        operation: "mcp_credential",
        stage: failure.stage,
        mutation,
        ids,
      },
      writeError,
    );
    return 1;
  }
  return 0;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runManageMcpCredential().then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode;
  });
}
