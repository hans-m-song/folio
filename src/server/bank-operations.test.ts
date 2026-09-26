import { beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({
  authConfig: { sessionCookieName: "folio_session" },
  auth: { session: vi.fn() },
  repository: {
    getArtifact: vi.fn(),
    findCsvDuplicateWarnings: vi.fn(),
  },
  documents: { readReviewText: vi.fn() },
  config: { reportingTimezone: "Australia/Brisbane" },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: vi.fn().mockReturnValue("opaque-session"),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse(value: unknown): unknown } | undefined;
    const builder = {
      validator(schema: { parse(value: unknown): unknown }) {
        validator = schema;
        return builder;
      },
      handler(callback: (input: { data: unknown }) => Promise<unknown>) {
        return (input: { data?: unknown } = {}) =>
          callback({ data: validator?.parse(input.data) });
      },
    };
    return builder;
  },
}));

vi.mock("./runtime", () => ({ runtime: () => current }));

import { getCsvDuplicateWarnings } from "./bank-operations";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "synthetic@example.test",
  displayName: null,
  role: "member" as const,
};
const artifactId = "22222222-2222-4222-8222-222222222222";

describe("CSV duplicate warning operation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current.auth.session.mockResolvedValue(actor);
    current.repository.findCsvDuplicateWarnings.mockResolvedValue({
      artifactId,
      warnings: [],
    });
  });

  it("parses pinned Stripe rows into server-derived identities", async () => {
    current.repository.getArtifact.mockResolvedValue({
      artifactProfile: "stripe_balance_itemised_csv_v1",
    });
    current.documents.readReviewText.mockResolvedValue({
      text: "balance_transaction_id,created,available_on,currency,gross,fee,net,reporting_category,description\ntxn_1,2026-09-01T00:00:00Z,,aud,10,0.3,9.7,charge,Sale",
    });

    await getCsvDuplicateWarnings({ data: { artifactId } });

    expect(current.documents.readReviewText).toHaveBeenCalledWith(
      actor.id,
      artifactId,
      "stripe_balance_itemised_csv_v1",
    );
    expect(current.repository.findCsvDuplicateWarnings).toHaveBeenCalledWith(
      actor.id,
      artifactId,
      "stripe_balance_itemised_csv_v1",
      {
        rowCount: 1,
        rowIdentityLimitReached: false,
        identities: [{ kind: "stripe_reference", reference: "txn_1" }],
      },
    );
  });

  it("parses pinned CommBank rows into movement identities", async () => {
    current.repository.getArtifact.mockResolvedValue({
      artifactProfile: "commbank_transaction_history_csv_v1",
    });
    current.documents.readReviewText.mockResolvedValue({
      text: "01/09/2026,-10.00,Synthetic movement,90.00",
    });

    await getCsvDuplicateWarnings({ data: { artifactId } });

    expect(current.repository.findCsvDuplicateWarnings).toHaveBeenCalledWith(
      actor.id,
      artifactId,
      "commbank_transaction_history_csv_v1",
      {
        rowCount: 1,
        rowIdentityLimitReached: false,
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
      },
    );
  });
});
