// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { BankProposalSuggestion } from "../database/proposal-repository";
import { BankProposalSuggestions } from "./bank-proposal-suggestions";

afterEach(() => cleanup());

const suggestion = (
  overrides: Partial<BankProposalSuggestion> = {},
): BankProposalSuggestion => ({
  submissionId: "11111111-1111-4111-8111-111111111111",
  kind: "draft_transaction",
  note: "Check the invoice before recording.",
  observedBankRevision: "1",
  createdAt: "2026-09-26T00:00:00.000Z",
  actionability: "actionable",
  transaction: {
    id: "22222222-2222-4222-8222-222222222222",
    status: "draft",
    kind: "supplier_expense",
    counterparty: "Example supplier",
    reference: null,
    documentCurrency: "USD",
    documentAmount: "35.19",
    settlementCurrency: "AUD",
    settlementAmount: "49.90",
  },
  ...overrides,
});

describe("bank proposal suggestions", () => {
  it("opens a draft editor with the selected bank row but offers no automatic match", () => {
    const bankId = "33333333-3333-4333-8333-333333333333";
    render(
      <BankProposalSuggestions
        bankTransactionId={bankId}
        suggestions={[suggestion()]}
      />,
    );

    expect(screen.getByText("Suggested draft")).toBeTruthy();
    expect(
      screen.getByText("Check the invoice before recording."),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Review draft" }).getAttribute("href"),
    ).toBe(
      `/transactions/22222222-2222-4222-8222-222222222222/edit?bank=${bankId}`,
    );
    expect(screen.queryByRole("button", { name: /match/i })).toBeNull();
  });

  it("shows existing matches for review and omits void drafts", () => {
    render(
      <BankProposalSuggestions
        bankTransactionId="33333333-3333-4333-8333-333333333333"
        suggestions={[
          suggestion({
            kind: "existing_match",
            transaction: {
              ...suggestion().transaction,
              status: "recorded",
            },
          }),
          suggestion({
            submissionId: "44444444-4444-4444-8444-444444444444",
            actionability: "void",
            transaction: { ...suggestion().transaction, status: "void" },
          }),
        ]}
      />,
    );

    expect(
      screen.getAllByRole("link", { name: "Review transaction" }),
    ).toHaveLength(1);
    expect(screen.queryByText("Suggested draft")).toBeNull();
  });

  it("warns when a suggestion is stale or its bank row is resolved", () => {
    render(
      <BankProposalSuggestions
        bankTransactionId="33333333-3333-4333-8333-333333333333"
        suggestions={[
          suggestion({ actionability: "stale" }),
          suggestion({
            submissionId: "44444444-4444-4444-8444-444444444444",
            actionability: "resolved",
            kind: "existing_match",
            transaction: {
              ...suggestion().transaction,
              status: "recorded",
            },
          }),
        ]}
      />,
    );

    expect(
      screen.getByText(/bank row changed after this suggestion/),
    ).toBeTruthy();
    expect(screen.getByText(/bank row is already resolved/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /match/i })).toBeNull();
  });
});
