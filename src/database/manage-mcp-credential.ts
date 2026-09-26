import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { z } from "zod";

import { loadConfig } from "../config";
import {
  proposalCredentialInputSchema,
  proposalCredentialScopeSchema,
} from "../domain/proposals";
import { ProposalRepository } from "./proposal-repository";

const uuidSchema = z.string().uuid();

export type CredentialCommand =
  | {
      action: "create";
      administratorId: string;
      actorUserId: string;
      defaultOwnerId: string;
      label: string;
      scopes: z.infer<typeof proposalCredentialScopeSchema>[];
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
    throw new Error("Expected exactly one action: create or revoke");
  const administratorId = uuidSchema.parse(parsed.values["administrator-id"]);
  if (action === "revoke")
    return {
      action,
      administratorId,
      credentialId: uuidSchema.parse(parsed.values["credential-id"]),
    };
  if (action !== "create") throw new Error("Expected create or revoke");
  const scopes = z
    .array(proposalCredentialScopeSchema)
    .min(1)
    .max(6)
    .parse(parsed.values.scope);
  return {
    action,
    administratorId,
    actorUserId: uuidSchema.parse(parsed.values["actor-user-id"]),
    defaultOwnerId: uuidSchema.parse(parsed.values["default-owner-id"]),
    label: z.string().trim().min(1).max(200).parse(parsed.values.label),
    scopes,
  };
};

export const generateCredentialSecret = () => {
  const token = `folio_mcp_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
};

const run = async () => {
  const command = parseCredentialCommand(process.argv.slice(2));
  const config = loadConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    const repository = new ProposalRepository(
      pool,
      config.databaseSchema,
      config.gstRegistered,
    );
    if (command.action === "revoke") {
      await repository.revokeCredential(
        command.administratorId,
        command.credentialId,
      );
      process.stdout.write("MCP credential revoked.\n");
      return;
    }
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
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch(() => {
    process.stderr.write("MCP credential operation failed.\n");
    process.exitCode = 1;
  });
}
