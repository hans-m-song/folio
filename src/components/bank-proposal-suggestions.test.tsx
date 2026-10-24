// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

  it("keeps actionable recorded matches and omits recorded drafts and void suggestions", () => {
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
            transaction: { ...suggestion().transaction, status: "recorded" },
          }),
          suggestion({
            submissionId: "55555555-5555-4555-8555-555555555555",
            actionability: "void",
            transaction: { ...suggestion().transaction, status: "void" },
          }),
          suggestion({
            submissionId: "66666666-6666-4666-8666-666666666666",
            kind: "existing_match",
            actionability: "actionable",
            transaction: { ...suggestion().transaction, status: "void" },
          }),
        ]}
      />,
    );

    const reviewLink = screen.getByRole("link", { name: "Review transaction" });
    expect(reviewLink.getAttribute("href")).toBe(
      "/transactions/22222222-2222-4222-8222-222222222222",
    );
    expect(screen.getByText("Suggested match")).toBeTruthy();
    expect(screen.queryByText("Recorded transaction")).toBeNull();
  });

  it("opens an existing-match suggestion in the editor while its transaction is a draft", () => {
    const bankId = "33333333-3333-4333-8333-333333333333";
    const transactionId = "22222222-2222-4222-8222-222222222222";
    const editedIds: string[] = [];
    render(
      <BankProposalSuggestions
        bankTransactionId={bankId}
        suggestions={[
          suggestion({
            kind: "existing_match",
            transaction: {
              ...suggestion().transaction,
              status: "draft",
            },
          }),
        ]}
        onEditDraft={(id) => editedIds.push(id)}
      />,
    );

    expect(screen.getByText("Suggested draft")).toBeTruthy();
    expect(screen.queryByText("Suggested match")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit draft here" }));
    expect(editedIds).toEqual([transactionId]);
    expect(screen.queryByRole("button", { name: /match/i })).toBeNull();
  });

  it("uses the draft review URL for an existing-match suggestion without an editor callback", () => {
    const bankId = "33333333-3333-4333-8333-333333333333";
    render(
      <BankProposalSuggestions
        bankTransactionId={bankId}
        suggestions={[
          suggestion({
            kind: "existing_match",
            transaction: {
              ...suggestion().transaction,
              status: "draft",
            },
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Review draft" }).getAttribute("href"),
    ).toBe(
      `/transactions/22222222-2222-4222-8222-222222222222/edit?bank=${bankId}`,
    );
  });

  it("keeps draft existing matches visible when the bank row is stale or resolved", () => {
    render(
      <BankProposalSuggestions
        bankTransactionId="33333333-3333-4333-8333-333333333333"
        suggestions={[
          suggestion({
            kind: "existing_match",
            actionability: "stale",
            transaction: { ...suggestion().transaction, status: "draft" },
          }),
          suggestion({
            submissionId: "44444444-4444-4444-8444-444444444444",
            kind: "existing_match",
            actionability: "resolved",
            transaction: { ...suggestion().transaction, status: "draft" },
          }),
        ]}
      />,
    );

    expect(
      screen.getByText(/bank row changed after this suggestion/),
    ).toBeTruthy();
    expect(screen.getByText(/bank row is already resolved/)).toBeTruthy();
    expect(screen.getAllByText("Suggested draft")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /match/i })).toBeNull();
  });

  it("hides recorded suggestions on a resolved bank row", () => {
    render(
      <BankProposalSuggestions
        bankTransactionId="33333333-3333-4333-8333-333333333333"
        suggestions={[
          suggestion({
            actionability: "resolved",
            transaction: { ...suggestion().transaction, status: "recorded" },
          }),
          suggestion({
            submissionId: "44444444-4444-4444-8444-444444444444",
            kind: "existing_match",
            actionability: "resolved",
            transaction: { ...suggestion().transaction, status: "recorded" },
          }),
        ]}
      />,
    );

    expect(screen.queryByRole("region", { name: "Suggestions" })).toBeNull();
  });
});
