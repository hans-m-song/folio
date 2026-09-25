import { describe, expect, it } from "vitest";

import { transactionKindLabels, transactionSourceLabels } from "./types";

describe("transaction display vocabulary", () => {
  it("provides human labels for every persisted kind and source", () => {
    expect(transactionKindLabels.supplier_expense).toBe("Supplier expense");
    expect(transactionKindLabels.processing_fee).toBe("Processing fee");
    expect(transactionKindLabels.owner_contribution).toBe("Owner contribution");
    expect(transactionKindLabels.owner_loan).toBe("Owner loan to business");
    expect(Object.keys(transactionKindLabels)).toHaveLength(10);
    expect(transactionSourceLabels).toEqual({
      manual: "Manual entry",
      stripe: "Stripe import",
    });
  });
});
