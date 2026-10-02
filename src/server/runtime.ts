import { S3Client } from "@aws-sdk/client-s3";
import { setResponseHeader } from "@tanstack/react-start/server";
import { Pool } from "pg";

import { AuthService, createGoogleOidcOperations } from "../auth/service";
import { loadAuthConfig, loadConfig } from "../config";
import { AuthRepository } from "../database/auth-repository";
import { BankRepository } from "../database/bank-repository";
import { ProposalRepository } from "../database/proposal-repository";
import { FolioRepository } from "../database/repository";
import { TaxReviewRepository } from "../database/tax-review-repository";
import { RecurringBillRepository } from "../database/recurring-bill-repository";
import { DocumentService } from "../documents/service";
import { S3ObjectStorage } from "../documents/storage";

let singleton: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const config = loadConfig(process.env);
  const authConfig = loadAuthConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
  const repository = new FolioRepository(
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
  const authRepository = new AuthRepository(pool, config.databaseSchema);
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
  const taxReviewRepository = new TaxReviewRepository(
    pool,
    config.databaseSchema,
  );
  const recurringBillRepository = new RecurringBillRepository(
    pool,
    config.databaseSchema,
  );
  const auth = new AuthService(
    authRepository,
    authConfig,
    createGoogleOidcOperations(authConfig),
  );
  return {
    config,
    authConfig,
    repository,
    bankRepository,
    proposalRepository,
    taxReviewRepository,
    recurringBillRepository,
    documents,
    auth,
  };
}

export function runtime() {
  setResponseHeader("cache-control", "private, no-store, max-age=0");
  setResponseHeader("pragma", "no-cache");
  return (singleton ??= createRuntime());
}
