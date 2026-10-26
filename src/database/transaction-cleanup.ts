import type { Pool, PoolClient } from "pg";

import { OperationCleanupError } from "../domain/errors";

export const withDatabaseTransactionClient = async <Result>(
  pool: Pick<Pool, "connect">,
  operation: (
    client: PoolClient,
    markTransactionStarted: () => void,
  ) => Promise<Result>,
  normalizeError: (error: unknown) => unknown = (error) => error,
): Promise<Result> => {
  const client = await pool.connect();
  let transactionStarted = false;
  let operationFailed = false;
  let failure: unknown;
  let result!: Result;

  try {
    result = await operation(client, () => {
      transactionStarted = true;
    });
  } catch (error) {
    operationFailed = true;
    try {
      failure = normalizeError(error);
    } catch (normalizationError) {
      failure = new OperationCleanupError(
        error,
        normalizationError,
        "error_normalization",
      );
    }
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        failure = new OperationCleanupError(
          failure,
          rollbackError,
          "transaction_rollback",
        );
      }
    }
  }

  try {
    client.release();
  } catch (releaseError) {
    failure = operationFailed
      ? new OperationCleanupError(failure, releaseError, "client_release")
      : releaseError;
    operationFailed = true;
  }

  if (operationFailed) throw failure;
  return result;
};
