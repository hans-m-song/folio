import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  AppError,
  OperationCleanupError,
  type AppErrorCode,
} from "../domain/errors";
import { localAdministratorEmail } from "../auth/local";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
  role: "administrator" | "member";
}

export interface LoginAttempt {
  nonce: string;
  codeVerifier: string;
  returnPath: string;
  expiresAt: Date;
}

type AuthenticationRejectionCode = Extract<
  AppErrorCode,
  "AUTH_SUBJECT_MISMATCH" | "AUTH_USER_NOT_ELIGIBLE"
>;

export class AuthenticationRejectedError extends AppError {
  constructor(
    code: AuthenticationRejectionCode = "AUTH_USER_NOT_ELIGIBLE",
    stage = "user_eligibility",
    userId?: string,
  ) {
    super({ code, stage, userId });
    this.name = "AuthenticationRejectedError";
  }
}

const cleanupFailure = (
  primaryError: unknown,
  cleanupError: unknown,
  stage: string,
  hasPrimaryError: boolean,
): Error =>
  hasPrimaryError
    ? new OperationCleanupError(primaryError, cleanupError, stage)
    : new AppError({ code: "AUTH_CLEANUP_FAILED", stage, cause: cleanupError });

const mapUser = (row: QueryResultRow): AuthenticatedUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  role: row.role,
});

export class AuthRepository {
  private readonly usersTable: string;
  private readonly attemptsTable: string;
  private readonly sessionsTable: string;

  constructor(
    private readonly pool: Pool,
    schema: string,
  ) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("Invalid Folio database schema");
    this.usersTable = `"${schema}"."users"`;
    this.attemptsTable = `"${schema}"."auth_attempts"`;
    this.sessionsTable = `"${schema}"."auth_sessions"`;
  }

  async createLoginAttempt(
    stateHash: string,
    attempt: LoginAttempt,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.attemptsTable} (state_hash, nonce, code_verifier, return_path, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [
        stateHash,
        attempt.nonce,
        attempt.codeVerifier,
        attempt.returnPath,
        attempt.expiresAt,
      ],
    );
  }

  async consumeLoginAttempt(
    stateHash: string,
    now: Date,
  ): Promise<LoginAttempt | null> {
    const result = await this.pool.query(
      `DELETE FROM ${this.attemptsTable} WHERE state_hash = $1 RETURNING nonce, code_verifier, return_path, expires_at`,
      [stateHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.expires_at <= now)
      throw new AppError({
        code: "AUTH_STATE_EXPIRED",
        stage: "state_expiration",
      });
    return {
      nonce: row.nonce,
      codeVerifier: row.code_verifier,
      returnPath: row.return_path,
      expiresAt: row.expires_at,
    };
  }

  async createSessionForIdentity(input: {
    email: string;
    subject: string;
    displayName?: string;
    tokenHash: string;
    rotatedTokenHash: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<AuthenticatedUser> {
    return this.withTransaction(async (client) => {
      const user = await this.lockEligibleUser(client, input.email);
      await this.bindSubject(client, user, input.subject);
      const shouldBackfillDisplayName =
        Boolean(input.displayName) &&
        (typeof user.display_name !== "string" ||
          user.display_name.trim() === "");
      if (shouldBackfillDisplayName) {
        await client.query(
          `UPDATE ${this.usersTable} SET display_name = $2 WHERE id = $1`,
          [user.id, input.displayName],
        );
        user.display_name = input.displayName;
      }
      await this.storeSession(client, user.id, input);
      return mapUser(user);
    });
  }

  async createSessionForLocalUser(input: {
    tokenHash: string;
    rotatedTokenHash: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<AuthenticatedUser> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `SELECT id, email, display_name, role FROM ${this.usersTable} WHERE lower(email) = lower($1) AND active = true AND role = 'administrator' FOR UPDATE`,
        [localAdministratorEmail],
      );
      const user = result.rows[0];
      if (!user) throw new AuthenticationRejectedError();
      await this.storeSession(client, user.id, input);
      return mapUser(user);
    });
  }

  async getActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthenticatedUser | null> {
    const result = await this.pool.query(
      `SELECT users.id, users.email, users.display_name, users.role FROM ${this.sessionsTable} sessions JOIN ${this.usersTable} users ON users.id = sessions.user_id WHERE sessions.token_hash = $1 AND sessions.revoked_at IS NULL AND sessions.expires_at > $2 AND users.active = true AND users.role IN ('administrator', 'member')`,
      [tokenHash, now],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.sessionsTable} SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, now],
    );
  }

  private async lockEligibleUser(
    client: PoolClient,
    email: string,
  ): Promise<QueryResultRow> {
    const result = await client.query(
      `SELECT id, email, display_name, google_subject, role FROM ${this.usersTable} WHERE lower(email) = lower($1) AND active = true AND role IN ('administrator', 'member') FOR UPDATE`,
      [email],
    );
    if (!result.rows[0]) throw new AuthenticationRejectedError();
    return result.rows[0];
  }

  private async bindSubject(
    client: PoolClient,
    user: QueryResultRow,
    subject: string,
  ): Promise<void> {
    if (user.google_subject && user.google_subject !== subject)
      throw new AuthenticationRejectedError(
        "AUTH_SUBJECT_MISMATCH",
        "subject_binding",
        user.id,
      );
    const existing = await client.query(
      `SELECT id FROM ${this.usersTable} WHERE google_subject = $1 FOR UPDATE`,
      [subject],
    );
    if (existing.rows[0] && existing.rows[0].id !== user.id)
      throw new AuthenticationRejectedError(
        "AUTH_SUBJECT_MISMATCH",
        "subject_binding",
        user.id,
      );
    if (!user.google_subject) {
      await client.query(
        `UPDATE ${this.usersTable} SET google_subject = $2 WHERE id = $1 AND google_subject IS NULL`,
        [user.id, subject],
      );
    }
  }

  private async storeSession(
    client: PoolClient,
    userId: string,
    input: {
      tokenHash: string;
      rotatedTokenHash: string | null;
      expiresAt: Date;
      now: Date;
    },
  ): Promise<void> {
    if (input.rotatedTokenHash) {
      await client.query(
        `UPDATE ${this.sessionsTable} SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`,
        [input.rotatedTokenHash, input.now],
      );
    }
    await client.query(
      `INSERT INTO ${this.sessionsTable} (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [input.tokenHash, userId, input.expiresAt],
    );
  }

  private async withTransaction<T>(
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let result!: T;
    let operationFailed = false;
    let failure: unknown;
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      result = await action(client);
      await client.query("COMMIT");
    } catch (error) {
      operationFailed = true;
      failure = error;
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          failure = cleanupFailure(
            failure,
            rollbackError,
            "transaction_rollback",
            true,
          );
        }
      }
    } finally {
      try {
        client.release();
      } catch (releaseError) {
        failure = cleanupFailure(
          failure,
          releaseError,
          "client_release",
          operationFailed,
        );
        operationFailed = true;
      }
    }

    if (operationFailed) throw failure;
    return result;
  }
}
