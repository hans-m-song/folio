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
  it("shows the description once and presents editing as a secondary action", () => {
    renderTransaction();

    expect(screen.getAllByText("Monthly subscription")).toHaveLength(1);
    const editLink = screen.getByRole("link", { name: "Edit transaction" });
    expect(editLink.getAttribute("href")).toBe(
      "/transactions/123e4567-e89b-42d3-a456-426614174000/edit",
    );
    expect(editLink.classList.contains("transaction-detail-edit")).toBe(true);
  });
});
