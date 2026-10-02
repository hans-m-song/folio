import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { requiredMigrationIds } from "./migrations";
import { createFolioSchema } from "./schema";

describe("recurring bill schema and migration", () => {
  it("exposes schedules and one-to-one occurrence links", () => {
    const schema = createFolioSchema("folio_test");

    expect(schema.recurringBillSchedules.id).toBeDefined();
    expect(schema.recurringBillSchedules.anchorDate).toBeDefined();
    expect(schema.recurringBillSchedules.descriptionMatchMode).toBeDefined();
    expect(schema.recurringBillSchedules.daysEarly).toBeDefined();
    expect(schema.recurringBillSchedules.daysLate).toBeDefined();
    expect(schema.recurringBillSchedules.responsibleUserId).toBeDefined();
    expect(schema.recurringBillLinks.scheduleId).toBeDefined();
    expect(schema.recurringBillLinks.expectedDate).toBeDefined();
    expect(schema.recurringBillLinks.transactionId).toBeDefined();
  });

  it("registers an additive migration with unique association constraints", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0017_folio_recurring_bills.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(requiredMigrationIds).toContain("0017_folio_recurring_bills");
    expect(migration.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(migration).toContain('"expected_amount" numeric(19,4)');
    expect(migration).toContain('"anchor_date" date NOT NULL');
    expect(migration).toContain("'monthly', 'annual'");
    expect(migration).toContain('PRIMARY KEY ("schedule_id", "expected_date")');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "recurring_bill_links_transaction_uidx"',
    );
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i);
  });

  it("registers additive rule defaults and bounded grace-window constraints", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../migrations/0018_folio_recurring_bill_rules.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(requiredMigrationIds).toContain("0018_folio_recurring_bill_rules");
    expect(migration).toContain(
      "\"description_match_mode\" text NOT NULL DEFAULT 'contains'",
    );
    expect(migration).toContain('"days_early" integer NOT NULL DEFAULT 3');
    expect(migration).toContain('"days_late" integer NOT NULL DEFAULT 3');
    expect(migration).toContain("IN ('contains', 'regex')");
    expect(migration.match(/BETWEEN 0 AND 365/g)).toHaveLength(2);
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i);
  });
});
