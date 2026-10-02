// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: null as unknown }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (configuration: Record<string, unknown>) => ({
    ...configuration,
    useLoaderData: () => mocks.transaction,
  }),
}));

vi.mock("../server/operations", () => ({
  downloadArtifact: vi.fn(),
  getTransaction: vi.fn(),
}));

import { Route } from "./transactions_.$transactionId";
import type { TransactionRecord } from "../domain/types";

const transactionRoute = Route as unknown as { component: ComponentType };

const transaction: TransactionRecord = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  ownerId: null,
  sourceArtifactId: null,
  kind: "sale",
  reference: null,
  counterparty: "Example customer",
  description: "Monthly subscription",
  status: "recorded",
  category: null,
  notes: null,
  occurredAt: null,
  availableAt: null,
  invoiceDate: null,
  settledAt: null,
  documentCurrency: "AUD",
  documentAmount: "120.0000",
  documentTaxAmount: null,
  taxTreatment: "unknown_mixed",
  settlementCurrency: "AUD",
  settlementAmount: "120.0000",
  gstCreditStatus: "not_registered",
  claimableGstAud: "0.0000",
  createdById: "123e4567-e89b-42d3-a456-426614174001",
  updatedById: "123e4567-e89b-42d3-a456-426614174001",
  sourceSystem: "manual",
  sourceArtifactFilename: null,
  sourceArtifacts: [],
  sourceGross: null,
  sourceFee: null,
  sourceNet: null,
  sourceCurrency: null,
  metadata: {},
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

const renderTransaction = () =>
  render(createElement(transactionRoute.component));

beforeEach(() => {
  mocks.transaction = transaction;
});

afterEach(() => cleanup());

describe("Transaction detail page", () => {
  it("offers explicit recurring setup only for recorded supplier expenses", () => {
    mocks.transaction = { ...transaction, kind: "supplier_expense" };
    renderTransaction();
    const editLink = screen.getByRole("link", { name: "Edit transaction" });
    const trackLink = screen.getByRole("link", {
      name: "Track recurring bill",
    });
    expect(trackLink.getAttribute("href")).toBe(
      `/transactions/recurring?sourceTransactionId=${transaction.id}`,
    );
    expect(trackLink.classList.contains("transaction-detail-edit")).toBe(true);
    expect(editLink.parentElement).toBe(trackLink.parentElement);
    expect(
      editLink.parentElement?.classList.contains("transaction-detail-actions"),
    ).toBe(true);
    cleanup();
    mocks.transaction = {
      ...transaction,
      kind: "supplier_expense",
      status: "draft",
    };
    renderTransaction();
    expect(
      screen.queryByRole("link", { name: "Track recurring bill" }),
    ).toBeNull();
    cleanup();
    mocks.transaction = { ...transaction, kind: "supplier_credit" };
    renderTransaction();
    expect(
      screen.queryByRole("link", { name: "Track recurring bill" }),
    ).toBeNull();
  });

  it.each([
    { kind: "supplier_expense", label: "Invoice missing" },
    { kind: "supplier_credit", label: "Credit note missing" },
    { kind: "owner_loan", label: "Invoice not expected" },
  ])(
    "shows document status separately from recorded status for $kind",
    ({ kind, label }) => {
      mocks.transaction = { ...transaction, kind };
      renderTransaction();
      expect(screen.getByText("recorded")).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
    },
  );

  it("shows the description once and presents editing as a secondary action", () => {
    renderTransaction();

    expect(screen.getAllByText("Monthly subscription")).toHaveLength(1);
    const editLink = screen.getByRole("link", { name: "Edit transaction" });
    expect(editLink.getAttribute("href")).toBe(
      "/transactions/123e4567-e89b-42d3-a456-426614174000/edit",
    );
    expect(editLink.classList.contains("transaction-detail-edit")).toBe(true);
  });

  it("marks document and settlement amounts while preserving their display strings", () => {
    renderTransaction();

    const amounts = screen.getAllByText("AUD 120.0000");
    expect(amounts).toHaveLength(2);
    for (const amount of amounts)
      expect(amount.getAttribute("data-money-value")).toBe("");
  });

  it("marks the Stripe net amount without altering its source-currency text", () => {
    mocks.transaction = {
      ...transaction,
      sourceSystem: "stripe",
      sourceCurrency: "USD",
      sourceNet: "119.0000",
    };
    renderTransaction();

    const amount = screen.getByText("USD 119.0000");
    expect(amount.getAttribute("data-money-value")).toBe("");
  });
});
