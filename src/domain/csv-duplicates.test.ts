import { describe, expect, it } from "vitest";

import {
  commBankDuplicateIdentities,
  csvDuplicateRowLimit,
  stripeDuplicateIdentities,
} from "./csv-duplicates";

describe("CSV duplicate row identities", () => {
  it("uses Stripe balance transaction references", () => {
    expect(
      stripeDuplicateIdentities([
        {
          reference: "txn_synthetic",
          occurredAt: "2026-09-01T00:00:00.000Z",
          availableAt: null,
          sourceCurrency: "AUD",
          sourceGross: "10.0000",
          sourceFee: "0.3000",
          sourceNet: "9.7000",
          reportingCategory: "charge",
          description: null,
        },
      ]),
    ).toEqual({
      rowCount: 1,
      rowIdentityLimitReached: false,
      identities: [{ kind: "stripe_reference", reference: "txn_synthetic" }],
    });
  });

  it("uses the parsed CommBank movement and running balance", () => {
    expect(
      commBankDuplicateIdentities([
        {
          sourceRow: 4,
          postedDate: "2026-09-01",
          amountAud: "-10.0000",
          description: "Synthetic movement",
          metadata: {
            sourceRow: 4,
            postedDate: "01/09/2026",
            amountAud: "-10.00",
            description: "Synthetic movement",
            runningBalance: "90.00",
          },
        },
      ]),
    ).toMatchObject({
      identities: [
        {
          kind: "commbank_row",
          rowIndex: 0,
          postedDate: "2026-09-01",
          amountAud: "-10.0000",
          description: "Synthetic movement",
          runningBalance: "90.00",
        },
      ],
    });
  });

  it("bounds identities while reporting the full parsed row count", () => {
    const rows = Array.from(
      { length: csvDuplicateRowLimit + 1 },
      (_, index) => ({
        reference: `txn_${index}`,
        occurredAt: "2026-09-01T00:00:00.000Z",
        availableAt: null,
        sourceCurrency: "AUD",
        sourceGross: "1.0000",
        sourceFee: "0.0000",
        sourceNet: "1.0000",
        reportingCategory: "charge",
        description: null,
      }),
    );
    const result = stripeDuplicateIdentities(rows);

    expect(result.rowCount).toBe(csvDuplicateRowLimit + 1);
    expect(result.identities).toHaveLength(csvDuplicateRowLimit);
    expect(result.rowIdentityLimitReached).toBe(true);
  });
});
