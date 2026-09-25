import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FolioRepository } from "./repository";

const schema = "folio_t28_verify";
const databaseUrl =
  "postgres://folio_test:folio_test_postgres_password@127.0.0.1:55432/folio_test";
const table = (name: string) => `"${schema}"."${name}"`;

const sourceArtifactsTable = table("source_artifacts");
const transactionArtifactsTable = table("transaction_artifacts");
const transactionsTable = table("transactions");
const usersTable = table("users");

let pool: Pool;
let claimPool: Pool;
let actorId: string;
let repository: FolioRepository;
const artifactIds: string[] = [];
const transactionIds: string[] = [];

const insertArtifact = async (state: "pending" | "available") => {
  const id = randomUUID();
  const checksum = createHash("sha256").update(id).digest("base64");
  await pool.query(
    `INSERT INTO ${sourceArtifactsTable} (id, owner_id, created_by_id, artifact_profile, object_key, version_id, filename, media_type, byte_size, checksum_sha256, state, confirmed_at)
     VALUES ($1,$2,$2,'manual_invoice_pdf_v1',$3,$4,'synthetic.pdf','application/pdf',1,$5,$6,$7)`,
    [
      id,
      actorId,
      `tests/bill-t42/${id}`,
      state === "available" ? `synthetic-version-${id}` : null,
      checksum,
      state,
      state === "available" ? new Date() : null,
    ],
  );
  artifactIds.push(id);
  return id;
};

const insertManualTransaction = async () => {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO ${transactionsTable} (id, owner_id, created_by_id, updated_by_id, source_system, kind, status, metadata)
     VALUES ($1,$2,$2,$2,'manual','supplier_expense','draft','{}')`,
    [id, actorId],
  );
  transactionIds.push(id);
  return id;
};

const waitForClaimLock = async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT wait_event_type FROM pg_stat_activity
       WHERE application_name='bill-t42-claim' AND wait_event_type='Lock'`,
    );
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Artifact deletion claim did not wait on the link lock");
};

describe("artifact deletion against disposable PostgreSQL", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    claimPool = new Pool({
      connectionString: databaseUrl,
      application_name: "bill-t42-claim",
      max: 2,
    });
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== "folio_test")
      throw new Error("PostgreSQL integration tests require folio_test");
    actorId = randomUUID();
    await pool.query(
      `INSERT INTO ${usersTable} (id, email, role) VALUES ($1,$2,'administrator')`,
      [actorId, `synthetic-${actorId}@example.invalid`],
    );
    repository = new FolioRepository(claimPool, schema, false);
  });

  afterEach(async () => {
    if (transactionIds.length) {
      await pool.query(
        `DELETE FROM ${transactionArtifactsTable} WHERE transaction_id=ANY($1::uuid[])`,
        [transactionIds],
      );
      await pool.query(
        `DELETE FROM ${transactionsTable} WHERE id=ANY($1::uuid[])`,
        [transactionIds],
      );
      transactionIds.length = 0;
    }
    if (artifactIds.length) {
      await pool.query(
        `DELETE FROM ${sourceArtifactsTable} WHERE id=ANY($1::uuid[])`,
        [artifactIds],
      );
      artifactIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM ${usersTable} WHERE id=$1`, [actorId]);
    await Promise.all([pool.end(), claimPool.end()]);
  });

  it.each(["pending", "available"] as const)(
    "claims and finalizes an unlinked %s artifact",
    async (state) => {
      const artifactId = await insertArtifact(state);
      const claimed = await repository.claimArtifactDeletion(artifactId);
      expect(claimed).toMatchObject({ id: artifactId, state: "deleting" });

      await repository.deleteClaimedArtifact(artifactId, claimed!.objectKey);
      await expect(repository.getArtifact(artifactId)).resolves.toBeNull();
    },
  );

  it("sees a committed link after waiting for its row-share lock", async () => {
    const artifactId = await insertArtifact("available");
    const transactionId = await insertManualTransaction();
    const linkClient: PoolClient = await pool.connect();
    try {
      await linkClient.query("BEGIN");
      await linkClient.query(
        `INSERT INTO ${transactionArtifactsTable} (transaction_id, source_artifact_id) VALUES ($1,$2)`,
        [transactionId, artifactId],
      );

      const claimExpectation = expect(
        repository.claimArtifactDeletion(artifactId),
      ).rejects.toThrow("referenced by a transaction or bank row");
      await waitForClaimLock();
      await linkClient.query("COMMIT");
      await claimExpectation;

      const persisted = await pool.query(
        `SELECT state, (SELECT count(*)::integer FROM ${transactionArtifactsTable} WHERE source_artifact_id=$1) AS link_count
         FROM ${sourceArtifactsTable} WHERE id=$1`,
        [artifactId],
      );
      expect(persisted.rows[0]).toMatchObject({
        state: "available",
        link_count: 1,
      });
    } catch (error) {
      await linkClient.query("ROLLBACK");
      throw error;
    } finally {
      linkClient.release();
    }
  });

  it("grants the configured application role source-artifact deletion", async () => {
    const privilege = await pool.query(
      "SELECT has_table_privilege(current_user, $1, 'DELETE') AS allowed",
      [`${schema}.source_artifacts`],
    );
    expect(privilege.rows[0]?.allowed).toBe(true);
  });
});
