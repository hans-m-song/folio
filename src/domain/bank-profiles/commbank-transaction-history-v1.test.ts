import { describe, expect, it } from "vitest";

import { parseCommBankTransactionHistoryCsv } from "./commbank-transaction-history-v1";

describe("CommBank transaction history CSV", () => {
  it("parses every headerless row and retains exact source strings", () => {
    const preview = parseCommBankTransactionHistoryCsv(
      '13/08/2026,-35.19,"COFFEE, SHOP VALUE DATE 12/08/2026 USD 22.50 CARD XX1234",113.88\n14/08/2026,+100.00,TRANSFER,213.88\n',
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({
      sourceRow: 1,
      postedDate: "2026-08-13",
      amountAud: "-35.1900",
      description: "COFFEE, SHOP VALUE DATE 12/08/2026 USD 22.50 CARD XX1234",
      metadata: {
        postedDate: "13/08/2026",
        amountAud: "-35.19",
        runningBalance: "113.88",
        valueDate: "2026-08-12",
        foreignCurrency: "USD",
        foreignAmount: "22.50",
        cardSuffix: "1234",
      },
    });
    expect(preview.rows[0]?.metadata).not.toHaveProperty(
      "counterpartySuggestion",
    );
    expect(preview.earliestDate).toBe("2026-08-13");
    expect(preview.latestDate).toBe("2026-08-14");
  });

  it("returns safe row and field errors while retaining valid rows", () => {
    const preview = parseCommBankTransactionHistoryCsv(
      "31/02/2026,0,BAD,1.00\n01/03/2026,-1.25,VALID,99.75\n02/03/2026,2.00,TOO,100.00,EXTRA\n",
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, field: "postedDate" }),
        expect.objectContaining({ row: 1, field: "amountAud" }),
        expect.objectContaining({ row: 3, field: "row" }),
      ]),
    );
  });

  it("rejects malformed quoting without exposing row contents", () => {
    const preview = parseCommBankTransactionHistoryCsv(
      '01/01/2026,-1.00,"UNFINISHED,99.00',
    );
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toEqual([
      {
        row: 1,
        field: "row",
        code: "malformed_csv",
        message: "Malformed CSV quoting",
      },
    ]);
  });

  it("reports empty files and bare carriage returns safely", () => {
    expect(parseCommBankTransactionHistoryCsv("").errors).toEqual([
      expect.objectContaining({ row: 1, code: "empty_csv" }),
    ]);
    expect(
      parseCommBankTransactionHistoryCsv("01/01/2026,-1.00,BAD\rVALUE,9.00")
        .errors,
    ).toEqual([expect.objectContaining({ row: 1, code: "malformed_csv" })]);
  });

  it("accepts blank descriptions and never extracts unmasked cards or AUD as foreign", () => {
    const preview = parseCommBankTransactionHistoryCsv(
      "01/01/2026,-1.00,,9.00\n02/01/2026,-1.00,CARD 1234 AUD 2.00,8.00\n",
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]?.description).toBe("");
    expect(preview.rows[1]?.metadata).not.toHaveProperty("cardSuffix");
    expect(preview.rows[1]?.metadata).not.toHaveProperty("foreignCurrency");
  });
});
