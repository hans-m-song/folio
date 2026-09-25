import { describe, expect, it } from "vitest";

import {
  FolioDiagnosticError,
  formatStripeImportFilename,
  parseStripeBalanceCsv,
  StripeCsvValidationError,
} from "./stripe-csv";

const header =
  "balance_transaction_id,created,available_on,currency,gross,fee,net,reporting_category,description";

describe("Stripe Balance CSV", () => {
  it("formats the imported activity range in the reporting timezone", () => {
    expect(
      formatStripeImportFilename(
        [
          { occurredAt: "2026-09-02T13:59:59.000Z" },
          { occurredAt: "2026-08-31T14:00:00.000Z" },
        ],
        "Australia/Brisbane",
      ),
    ).toBe("Stripe-2026-09-01-2026-09-02.csv");
  });

  it("does not fabricate a range for an empty import", () => {
    expect(formatStripeImportFilename([], "Australia/Brisbane")).toBeNull();
  });

  it("parses the default Stripe Dashboard itemized export in the reporting timezone", () => {
    const rows = parseStripeBalanceCsv(
      `${header}\ntxn_1,2026-08-21 14:35:28,2026-08-25 10:00:00,aud,1340.00,23.08,1316.92,charge,Subscription creation\ntxn_2,2026-08-22 12:34:09,2026-08-22 12:34:09,aud,-9.38,0.94,-10.32,fee,Billing fee`,
      { reportingTimezone: "Australia/Brisbane" },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      occurredAt: "2026-08-21T04:35:28.000Z",
      availableAt: "2026-08-25T00:00:00.000Z",
      sourceGross: "1340.0000",
      sourceFee: "23.0800",
      sourceNet: "1316.9200",
    });
    expect(rows[1]).toMatchObject({
      sourceGross: "-9.3800",
      sourceFee: "0.9400",
      sourceNet: "-10.3200",
    });
  });

  it("accepts unambiguous UTC timestamp column aliases", () => {
    const utcHeader = header
      .replace("created", "created_utc")
      .replace("available_on", "available_on_utc");
    const [row] = parseStripeBalanceCsv(
      `${utcHeader}\ntxn_1,2026-08-21 14:35:28,2026-08-25 10:00:00,aud,10,0.3,9.7,charge,ok`,
    );
    expect(row).toMatchObject({
      occurredAt: "2026-08-21T14:35:28.000Z",
      availableAt: "2026-08-25T10:00:00.000Z",
    });
  });

  it("parses quoted itemised rows and preserves signs", () => {
    const [row] = parseStripeBalanceCsv(
      `${header}\ntxn_1,2026-09-01T00:00:00Z,2026-09-03T00:00:00Z,aud,10.00,0.30,9.70,charge,"Sale, online"\n`,
    );
    expect(row).toMatchObject({
      sourceGross: "10.0000",
      sourceFee: "0.3000",
      sourceNet: "9.7000",
    });
  });

  it("parses the supplied itemised sample in the reporting timezone", () => {
    const csv = `${header}
txn_charge,2026-09-01 14:00:00,2026-09-03 12:00:00,aud,100.00,3.20,96.80,charge,Sale
txn_refund,2026-09-02 09:15:00,2026-09-04 11:00:00,aud,-100.00,-5.00,-95.00,refund,Refund`;

    expect(parseStripeBalanceCsv(csv, "Australia/Brisbane")).toMatchObject([
      {
        reference: "txn_charge",
        occurredAt: "2026-09-01T04:00:00.000Z",
        availableAt: "2026-09-03T02:00:00.000Z",
        sourceGross: "100.0000",
        sourceFee: "3.2000",
        sourceNet: "96.8000",
      },
      {
        reference: "txn_refund",
        occurredAt: "2026-09-01T23:15:00.000Z",
        availableAt: "2026-09-04T01:00:00.000Z",
        sourceGross: "-100.0000",
        sourceFee: "-5.0000",
        sourceNet: "-95.0000",
      },
    ]);
  });

  it("accepts UTC timestamp aliases as UTC", () => {
    const utcHeader =
      "balance_transaction_id,created_utc,available_on_utc,currency,gross,fee,net,reporting_category,description";
    const [row] = parseStripeBalanceCsv(
      `${utcHeader}\ntxn_utc,2026-09-01 14:00:00,2026-09-03 12:00:00,aud,10,0,10,charge,UTC`,
      "Australia/Brisbane",
    );
    expect(row).toMatchObject({
      occurredAt: "2026-09-01T14:00:00.000Z",
      availableAt: "2026-09-03T12:00:00.000Z",
    });
  });

  it("identifies Stripe All activity exports as an unsupported report", () => {
    const csv =
      '"ID","Type","Source","Amount","Fee","Net","Currency","Created (UTC)","Available On (UTC)"\n"txn_1","refund","ch_1","-29.00","0.00","-29.00","aud","2026-01-21 07:21","2026-01-27 00:00"';
    expect(() => parseStripeBalanceCsv(csv)).toThrowError(
      expect.objectContaining({
        detail: { reason: "unsupported_all_activity_export" },
      }),
    );
  });

  it("throws a typed diagnostic with safe CSV detail", () => {
    let error: unknown;
    try {
      parseStripeBalanceCsv(
        `${header}\ntxn_1,2026-09-01,,aud,not-a-number,0,0,charge,secret description`,
        "Australia/Brisbane",
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(FolioDiagnosticError);
    expect(error).toBeInstanceOf(StripeCsvValidationError);
    expect(error).toMatchObject({
      code: "STRIPE_CSV_INVALID",
      diagnostic: {
        category: "validation",
        code: "STRIPE_CSV_INVALID",
        retryable: false,
        detail: { reason: "invalid_amount", rowNumber: 2 },
      },
    });
    expect(JSON.stringify(error)).not.toContain("secret description");
  });

  it("rejects the complete import when any row is invalid", () => {
    const csv = `${header}\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,ok\ntxn_2,2026-09-01T00:00:00Z,,aud,10,0.3,8.7,charge,bad`;
    expect(() => parseStripeBalanceCsv(csv)).toThrow("Gross minus fee");
  });

  it("rejects duplicate references", () => {
    const csv = `${header}\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,a\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,b`;
    expect(() => parseStripeBalanceCsv(csv)).toThrow("Duplicate");
  });

  it("rejects duplicate headers and non-timestamp dates", () => {
    expect(() =>
      parseStripeBalanceCsv(
        `${header},description\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,a,a`,
      ),
    ).toThrow("headers must be non-empty and unique");
    expect(() =>
      parseStripeBalanceCsv(
        `${header}\ntxn_1,2026-09-01,,aud,10,0.3,9.7,charge,a`,
      ),
    ).toThrow("Invalid Stripe timestamp");
    expect(() =>
      parseStripeBalanceCsv(
        `${header}\ntxn_1,2026-02-30T00:00:00Z,,aud,10,0.3,9.7,charge,a`,
      ),
    ).toThrow("Invalid Stripe timestamp");
  });

  it("rejects malformed quote grammar", () => {
    expect(() =>
      parseStripeBalanceCsv(
        `${header}\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,bad"quote`,
      ),
    ).toThrow("Unexpected quote");
    expect(() =>
      parseStripeBalanceCsv(
        `${header}\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,"closed"tail`,
      ),
    ).toThrow("Unexpected character");
    expect(() => parseStripeBalanceCsv(`${header}\rbroken`)).toThrow(
      "Bare carriage return",
    );
  });
});
