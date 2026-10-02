import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { z } from "zod";

import { loadConfig } from "../config";
import {
  expandCredentialScopes,
  generateCredentialSecret,
  proposalCredentialInputSchema,
  proposalCredentialIssuanceScopeSchema,
} from "../domain/proposals";
import { formatDatabaseCliFailure } from "./cli-errors";
import { ProposalRepository } from "./proposal-repository";

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

const run = async () => {
  let stage = "arguments";
  try {
    const command = parseCredentialCommand(process.argv.slice(2));
    if (command.action === "scopes") {
      process.stdout.write(`${credentialScopeHelp()}\n`);
      return;
    }
    stage = "configuration";
    const config = loadConfig(process.env);
    const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
    try {
      const repository = new ProposalRepository(
        pool,
        config.databaseSchema,
        config.gstRegistered,
      );
      if (command.action === "revoke") {
        stage = "revoke";
        await repository.revokeCredential(
          command.administratorId,
          command.credentialId,
        );
        process.stdout.write("MCP credential revoked.\n");
        return;
      }
      stage = "create";
      const secret = generateCredentialSecret();
      const input = proposalCredentialInputSchema.parse({
        label: command.label,
        tokenHash: secret.tokenHash,
        actorUserId: command.actorUserId,
        defaultOwnerId: command.defaultOwnerId,
        scopes: command.scopes,
      });
      const credential = await repository.createCredential(
        command.administratorId,
        input,
      );
      process.stdout.write(
        `Credential ID: ${credential.id}\nToken (shown once): ${secret.token}\nStore this token securely; Folio cannot display it again.\n`,
      );
    } finally {
      await pool.end();
    }
  } catch (error) {
    process.stderr.write(
      `${formatDatabaseCliFailure("mcp_credential", stage, error)}\n`,
    );
    process.exitCode = 1;
  }
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void run();
}
