import { createHash } from "node:crypto";

import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

import { loadConfig } from "../config";
import { BankRepository } from "../database/bank-repository";
import { ProposalRepository } from "../database/proposal-repository";
import { FolioRepository } from "../database/repository";
import {
  commBankDuplicateIdentities,
  stripeDuplicateIdentities,
} from "../domain/csv-duplicates";
import { parseCommBankTransactionHistoryCsv } from "../domain/bank-profiles/commbank-transaction-history-v1";
import { parseStripeBalanceCsv } from "../domain/stripe-csv";
import { DocumentService } from "../documents/service";
import { S3ObjectStorage } from "../documents/storage";
import type { McpCredentialVerifier, McpPrincipal } from "./server";
import { createMcpToolRegistrar } from "./tools";

type CredentialLookup = Pick<ProposalRepository, "credentialForTokenHash">;

export const createMcpCredentialVerifier =
  (repository: CredentialLookup): McpCredentialVerifier =>
  async (token) => {
    if (!token) return undefined;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const credential = await repository.credentialForTokenHash(tokenHash);
    if (!credential) return undefined;
    const principal: McpPrincipal = {
      credentialId: credential.id,
      actorUserId: credential.actorUserId,
      defaultOwnerId: credential.defaultOwnerId,
      scopes: credential.scopes,
    };
    return principal;
  };

export const createMcpRuntime = (
  environment: Record<string, string | undefined>,
) => {
  const config = loadConfig(environment);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
  const repository = new FolioRepository(
    pool,
    config.databaseSchema,
    config.gstRegistered,
  );
  const bankRepository = new BankRepository(
    pool,
    config.databaseSchema,
    config.gstRegistered,
  );
  const proposalRepository = new ProposalRepository(
    pool,
    config.databaseSchema,
    config.gstRegistered,
  );
  const internalStorageClient = new S3Client({
    region: config.s3Region,
    ...(config.s3InternalEndpoint
      ? { endpoint: config.s3InternalEndpoint, forcePathStyle: true }
      : {}),
  });
  const publicPresignClient = config.s3PublicEndpoint
    ? new S3Client({
        region: config.s3Region,
        endpoint: config.s3PublicEndpoint,
        forcePathStyle: true,
      })
    : internalStorageClient;
  const storage = new S3ObjectStorage(
    internalStorageClient,
    publicPresignClient,
  );
  const documents = new DocumentService(repository, storage, {
    bucket: config.s3Bucket,
    prefix: config.s3KeyPrefix,
    maxUploadBytes: config.maxUploadBytes,
  });

  const getCsvDuplicateWarnings = async (
    actorId: string,
    artifactId: string,
  ) => {
    const artifact = await repository.getArtifact(artifactId);
    const profile = artifact?.artifactProfile;
    if (
      profile !== "stripe_balance_itemised_csv_v1" &&
      profile !== "commbank_transaction_history_csv_v1"
    )
      throw new Error("Reviewable CSV artifact not found");
    const object = await documents.readReviewText(actorId, artifactId, profile);
    const identities =
      profile === "stripe_balance_itemised_csv_v1"
        ? stripeDuplicateIdentities(
            parseStripeBalanceCsv(object.text, {
              reportingTimezone: config.reportingTimezone,
            }),
          )
        : commBankDuplicateIdentities(
            parseCommBankTransactionHistoryCsv(object.text).rows,
          );
    return repository.findCsvDuplicateWarnings(
      actorId,
      artifactId,
      profile,
      identities,
    );
  };

  return {
    config,
    verifyCredential: createMcpCredentialVerifier(proposalRepository),
    registerTools: createMcpToolRegistrar({
      config,
      repository,
      bankRepository,
      proposalRepository,
      documents,
      getCsvDuplicateWarnings,
    }),
    close: async () => {
      try {
        await pool.end();
      } finally {
        internalStorageClient.destroy();
        if (publicPresignClient !== internalStorageClient)
          publicPresignClient.destroy();
      }
    },
  };
};
