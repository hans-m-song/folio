// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { transactionInputSchema } from "../domain/types";
import {
  ManualTransactionForm,
  type ManualArtifactOption,
} from "./manual-transaction-form";

Object.defineProperty(globalThis, "CSS", {
  configurable: true,
  value: { escape: (value: string) => value },
});

const transaction = transactionInputSchema.parse({
  ownerId: "00000000-0000-4000-8000-000000000001",
  kind: "supplier_expense",
  documentCurrency: "AUD",
  gstCreditStatus: "not_registered",
});

const formElement = (
  onSubmit = vi.fn(),
  initial = transaction,
  serverIssues: ComponentProps<
    typeof ManualTransactionForm
  >["serverIssues"] = [],
  options: {
    gstRegistered?: boolean;
    counterparties?: readonly string[];
    attachedArtifactId?: string | null;
    attachedArtifactIds?: readonly string[];
    availableArtifacts?: readonly ManualArtifactOption[];
    supplierCategories?: ComponentProps<
      typeof ManualTransactionForm
    >["supplierCategories"];
    allowedKinds?: ComponentProps<typeof ManualTransactionForm>["allowedKinds"];
    autoDefaultTaxTreatment?: boolean;
    bankSettlementPrefilled?: boolean;
    bankPaymentHints?: ComponentProps<
      typeof ManualTransactionForm
    >["bankPaymentHints"];
    submissionStatus?: string;
    submissionError?: string;
  } = {},
) => (
  <ManualTransactionForm
    transaction={initial}
    users={[
      {
        id: "00000000-0000-4000-8000-000000000001",
        email: "owner@example.test",
        displayName: "Owner",
        role: "member",
        active: true,
      },
    ]}
    counterparties={options.counterparties ?? ["Acme Supplies"]}
    categories={[]}
    gstRegistered={options.gstRegistered ?? false}
    attachedArtifactId={options.attachedArtifactId ?? null}
    attachedArtifactIds={options.attachedArtifactIds}
    availableArtifacts={options.availableArtifacts}
    supplierCategories={options.supplierCategories}
    allowedKinds={options.allowedKinds}
    autoDefaultTaxTreatment={options.autoDefaultTaxTreatment}
    bankSettlementPrefilled={options.bankSettlementPrefilled}
    bankPaymentHints={options.bankPaymentHints}
    submissionStatus={options.submissionStatus}
    submissionError={options.submissionError}
    evidenceStatus={<p>No PDF selected.</p>}
    busy={false}
    onEvidenceChange={vi.fn()}
    onSubmit={onSubmit}
    serverIssues={serverIssues}
  />
);

const renderForm = (
  onSubmit = vi.fn(),
  initial = transaction,
  serverIssues: ComponentProps<
    typeof ManualTransactionForm
  >["serverIssues"] = [],
  options: Parameters<typeof formElement>[3] = {},
) => render(formElement(onSubmit, initial, serverIssues, options));

const submitWith = (button: HTMLButtonElement) => {
  const form = button.closest("form");
  if (!form) throw new Error("Submit control is not inside a form");
  fireEvent.click(button);
};

afterEach(cleanup);

describe("managed manual transaction form", () => {
  it("keeps owner selection under Advanced without an unassigned option", () => {
    renderForm();

    const owner = screen.getByRole("combobox", { name: "Owner" });
    expect(owner.closest("details")).toBe(
      screen.getByText("Advanced").closest("details"),
    );
    expect((owner as HTMLSelectElement).value).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(screen.queryByRole("option", { name: "Unassigned" })).toBeNull();
  });

  it("requires an owner when an ownerless manual row is saved", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit, { ...transaction, ownerId: null });

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Owner: Choose an owner",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("normalises surrounding whitespace without converting money to a number", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    const total = screen.getByRole("textbox", {
      name: "Invoice total (tax-inclusive)",
    });
    await user.type(total, " 35.1 ");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].transaction.documentAmount).toBe("35.1");
  });

  it("retains multiple selected invoice artifacts and supports unlinking", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit, transaction, [], {
      attachedArtifactId: "00000000-0000-4000-8000-000000000002",
      availableArtifacts: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          filename: "first.pdf",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          filename: "second.pdf",
        },
      ],
    });

    await user.click(screen.getByRole("checkbox", { name: "second.pdf" }));
    await user.click(screen.getByRole("checkbox", { name: "first.pdf" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].artifactIds).toEqual([
      "00000000-0000-4000-8000-000000000003",
    ]);
  });

  it("keeps the reusable PDF picker visible when no PDFs are available", () => {
    renderForm();

    expect(
      screen.getByRole("group", { name: "Available invoice PDFs" }),
    ).toBeTruthy();
    expect(screen.getByText(/No available invoice PDFs yet/)).toBeTruthy();
    expect(
      screen.getByText(/bank CSV files remain payment provenance/),
    ).toBeTruthy();
  });

  it("offers PDF filename suggestions and applies them only on request", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.upload(
      screen.getByLabelText("PDF evidence"),
      new File(["invoice"], "Acme Building-Supplies-2026-02-28-INV-104.pdf", {
        type: "application/pdf",
      }),
    );

    expect(
      screen.getByText(
        "Filename suggests Acme Building-Supplies, invoice date 2026-02-28, and reference INV-104.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Supplier / counterparty" }),
    ).toMatchObject({ value: "" });
    expect(
      screen.getByRole("textbox", { name: "Invoice / reference" }),
    ).toMatchObject({ value: "" });
    expect(screen.getByLabelText("Invoice date")).toMatchObject({ value: "" });

    await user.click(
      screen.getByRole("button", { name: "Apply filename suggestions" }),
    );

    expect(
      screen.getByRole("combobox", { name: "Supplier / counterparty" }),
    ).toMatchObject({ value: "Acme Building-Supplies" });
    expect(
      screen.getByRole("textbox", { name: "Invoice / reference" }),
    ).toMatchObject({ value: "INV-104" });
    expect(screen.getByLabelText("Invoice date")).toMatchObject({
      value: "2026-02-28",
    });
    expect(
      screen.getByText(
        "Applied filename suggestions to supplier, invoice date, reference.",
      ),
    ).toBeTruthy();
  });

  it("fills blank edit fields while retaining saved supplier and reference values", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      counterparty: "Saved supplier",
      invoiceDate: null,
      reference: null,
    });
    renderForm(vi.fn(), initial, [], {
      attachedArtifactId: "00000000-0000-4000-8000-000000000002",
    });

    await user.upload(
      screen.getByLabelText("PDF evidence"),
      new File(["invoice"], "Other Supplier-2026-05-02-INV-204.pdf", {
        type: "application/pdf",
      }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Invoice / reference" }),
      "USER-ENTERED-REF",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply filename suggestions" }),
    );

    expect(
      screen.getByRole("combobox", { name: "Supplier / counterparty" }),
    ).toMatchObject({ value: "Saved supplier" });
    expect(
      screen.getByRole("textbox", { name: "Invoice / reference" }),
    ).toMatchObject({ value: "USER-ENTERED-REF" });
    expect(screen.getByLabelText("Invoice date")).toMatchObject({
      value: "2026-05-02",
    });
    expect(
      screen.getByText("Applied filename suggestions to invoice date."),
    ).toBeTruthy();
  });

  it("uses the filename invoice date in a bank create form without replacing the posted date", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      invoiceDate: null,
      settledAt: "2026-02-27T00:00:00.000Z",
    });
    renderForm(vi.fn(), initial, [], {
      allowedKinds: ["supplier_expense"],
      bankSettlementPrefilled: true,
    });

    const paymentDate = screen.getByLabelText(
      "Payment date / final posted date",
    );
    const invoiceDate = screen.getByLabelText("Invoice date");
    expect(paymentDate).toMatchObject({ value: "2026-02-27" });
    expect(invoiceDate).toMatchObject({ value: "" });

    await user.upload(
      screen.getByLabelText("PDF evidence"),
      new File(["invoice"], "Acme-2026-02-28-INV-104.pdf", {
        type: "application/pdf",
      }),
    );
    expect(invoiceDate).toMatchObject({ value: "" });
    await user.click(
      screen.getByRole("button", { name: "Apply filename suggestions" }),
    );

    expect(invoiceDate).toMatchObject({ value: "2026-02-28" });
    expect(paymentDate).toMatchObject({ value: "2026-02-27" });
  });

  it("uses bank payment values only after an explicit request and only for blank AUD fields", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentAmount: null,
      documentCurrency: null,
      invoiceDate: null,
      settledAt: "2026-02-27T00:00:00.000Z",
      settlementCurrency: "AUD",
      settlementAmount: "35.1200",
    });
    renderForm(vi.fn(), initial, [], {
      allowedKinds: ["supplier_expense"],
      bankSettlementPrefilled: true,
    });

    const amount = screen.getByRole("textbox", {
      name: "Invoice total (tax-inclusive)",
    });
    const currency = screen.getByRole("combobox", {
      name: "Document currency",
    });
    const invoiceDate = screen.getByLabelText("Invoice date");
    expect(amount).toMatchObject({ value: "" });
    expect(currency).toMatchObject({ value: "AUD" });
    expect(invoiceDate).toMatchObject({ value: "" });
    expect(
      screen.getByText(
        "Apply invoice PDF date and reference suggestions first when available. Payment values fill only remaining blank fields.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Use payment values" }),
    ).toBeTruthy();

    await user.clear(currency);
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Use payment values" }),
    );

    expect(amount).toMatchObject({ value: "35.1200" });
    expect(currency).toMatchObject({ value: "AUD" });
    expect(invoiceDate).toMatchObject({ value: "2026-02-27" });
    expect(
      screen.getByText(
        "Applied payment values to invoice date, document currency, document amount.",
      ),
    ).toBeTruthy();
  });

  it("keeps foreign-currency document amounts blank when using bank payment values", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentAmount: null,
      documentCurrency: "USD",
      invoiceDate: null,
      settledAt: "2026-02-27T00:00:00.000Z",
      settlementCurrency: "AUD",
      settlementAmount: "35.1200",
    });
    renderForm(vi.fn(), initial, [], {
      allowedKinds: ["supplier_expense"],
      bankSettlementPrefilled: true,
    });

    await user.click(
      screen.getByRole("button", { name: "Use payment values" }),
    );

    expect(
      screen.getByRole("textbox", { name: "Invoice total (tax-inclusive)" }),
    ).toMatchObject({ value: "" });
    expect(
      screen.getByRole("combobox", { name: "Document currency" }),
    ).toMatchObject({ value: "USD" });
    expect(screen.getByLabelText("Invoice date")).toMatchObject({
      value: "2026-02-27",
    });
    expect(
      screen.getByText("Applied payment values to invoice date."),
    ).toBeTruthy();
  });

  it("applies each selected foreign payment hint without changing AUD settlement", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentAmount: null,
      documentCurrency: "AUD",
      taxTreatment: "gst_included",
      settledAt: "2026-02-27T00:00:00.000Z",
      settlementCurrency: "AUD",
      settlementAmount: "58.4400",
    });
    renderForm(vi.fn(), initial, [], {
      bankSettlementPrefilled: true,
      autoDefaultTaxTreatment: true,
      bankPaymentHints: {
        foreignCurrency: "USD",
        foreignAmount: "37.08",
      },
    });

    const amount = screen.getByRole("textbox", {
      name: "Invoice total (tax-inclusive)",
    });
    const currency = screen.getByRole("combobox", {
      name: "Document currency",
    });
    const settlement = screen.getByRole("textbox", {
      name: "Settlement amount",
    });
    expect(amount).toMatchObject({ value: "" });
    expect(currency).toMatchObject({ value: "AUD" });

    await user.click(
      screen.getByRole("button", { name: "Apply currency USD" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Apply invoice total 37.08" }),
    );
    expect(currency).toMatchObject({ value: "USD" });
    expect(amount).toMatchObject({ value: "37.08" });
    expect(settlement).toMatchObject({ value: "58.4400" });
    await user.click(screen.getByText("Tax and classification"));
    expect(
      screen.getByRole("combobox", { name: "Document tax treatment" }),
    ).toMatchObject({ value: "foreign_tax_included" });

    await user.clear(amount);
    await user.type(amount, "36");
    await user.click(
      screen.getByRole("button", { name: "Apply invoice total 37.08" }),
    );
    expect(amount).toMatchObject({ value: "37.08" });
  });

  it("fills a blank amount while preserving an entered invoice date and currency", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentAmount: null,
      documentCurrency: "AUD",
      invoiceDate: "2026-02-10",
      settledAt: "2026-02-27T00:00:00.000Z",
      settlementCurrency: "AUD",
      settlementAmount: "35.1200",
    });
    renderForm(vi.fn(), initial, [], {
      allowedKinds: ["supplier_expense"],
      bankSettlementPrefilled: true,
    });

    await user.click(
      screen.getByRole("button", { name: "Use payment values" }),
    );

    expect(
      screen.getByRole("textbox", { name: "Invoice total (tax-inclusive)" }),
    ).toMatchObject({ value: "35.1200" });
    expect(
      screen.getByRole("combobox", { name: "Document currency" }),
    ).toMatchObject({ value: "AUD" });
    expect(screen.getByLabelText("Invoice date")).toMatchObject({
      value: "2026-02-10",
    });
    expect(
      screen.getByText("Applied payment values to document amount."),
    ).toBeTruthy();
  });

  it("does not offer bank payment values for ordinary manual forms or filled document fields", () => {
    const filledBankTransaction = transactionInputSchema.parse({
      ...transaction,
      documentAmount: "50.0000",
      documentCurrency: "AUD",
      invoiceDate: "2026-02-10",
      settledAt: "2026-02-27T00:00:00.000Z",
      settlementCurrency: "AUD",
      settlementAmount: "35.1200",
    });

    const { unmount } = renderForm();
    expect(
      screen.queryByRole("button", { name: "Use payment values" }),
    ).toBeNull();
    unmount();

    renderForm(vi.fn(), filledBankTransaction, [], {
      allowedKinds: ["supplier_expense"],
      bankSettlementPrefilled: true,
    });
    expect(
      screen.queryByRole("button", { name: "Use payment values" }),
    ).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Invoice total (tax-inclusive)" }),
    ).toMatchObject({ value: "50.0000" });
    expect(screen.getByLabelText("Invoice date")).toMatchObject({
      value: "2026-02-10",
    });
  });

  it("offers compact per-field suggestions for each selected existing PDF and reapplies only that field", async () => {
    const user = userEvent.setup();
    const firstId = "00000000-0000-4000-8000-000000000002";
    const secondId = "00000000-0000-4000-8000-000000000003";
    const initial = transactionInputSchema.parse({
      ...transaction,
      counterparty: "Saved supplier",
      invoiceDate: "2026-02-10",
      reference: "Saved reference",
      occurredAt: null,
    });
    renderForm(vi.fn(), initial, [], {
      availableArtifacts: [
        { id: firstId, filename: "Acme-Supplies-2026-02-28-INV-104.pdf" },
        { id: secondId, filename: "GoogleWorkspace-2026-03-01-REF-7.pdf" },
      ],
    });

    expect(
      screen.queryByRole("group", { name: /Suggestions from PDF/ }),
    ).toBeNull();
    await user.click(
      screen.getByRole("checkbox", {
        name: "Acme-Supplies-2026-02-28-INV-104.pdf",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "GoogleWorkspace-2026-03-01-REF-7.pdf",
      }),
    );

    const firstGroup = screen.getByRole("group", {
      name: "Suggestions from PDF 1: Acme-Supplies-2026-02-28-INV-104.pdf",
    });
    const secondGroup = screen.getByRole("group", {
      name: "Suggestions from PDF 2: GoogleWorkspace-2026-03-01-REF-7.pdf",
    });
    expect(
      screen.getByText("PDF 1: Acme-Supplies-2026-02-28-INV-104.pdf"),
    ).toBeTruthy();
    expect(
      screen.getByText("PDF 2: GoogleWorkspace-2026-03-01-REF-7.pdf"),
    ).toBeTruthy();
    const supplierButton = screen.getByRole("button", {
      name: "Apply supplier Acme Supplies",
    });
    const dateButton = screen.getByRole("button", {
      name: "Apply date 2026-02-28",
    });
    const referenceButton = screen.getByRole("button", {
      name: "Apply reference INV-104",
    });
    expect(supplierButton.closest("[role='group']")).toBe(firstGroup);
    expect(dateButton.closest("[role='group']")).toBe(firstGroup);
    expect(referenceButton.closest("[role='group']")).toBe(firstGroup);
    expect(
      screen
        .getByRole("button", { name: "Apply supplier Google Workspace" })
        .closest("[role='group']"),
    ).toBe(secondGroup);

    const supplier = screen.getByRole("combobox", {
      name: "Supplier / counterparty",
    });
    const date = screen.getByLabelText("Invoice date");
    const reference = screen.getByRole("textbox", {
      name: "Invoice / reference",
    });
    await user.clear(supplier);
    await user.type(supplier, "Edited supplier");
    await user.click(supplierButton);
    expect(supplier).toMatchObject({ value: "Acme Supplies" });
    expect(date).toMatchObject({ value: "2026-02-10" });
    expect(reference).toMatchObject({ value: "Saved reference" });
    expect(
      screen.getByRole("button", { name: "Apply supplier Acme Supplies" }),
    ).toBeTruthy();
    await user.clear(supplier);
    await user.type(supplier, "Edited again");
    await user.click(supplierButton);
    expect(supplier).toMatchObject({ value: "Acme Supplies" });

    await user.click(screen.getByText("Advanced"));
    const occurrenceDate = screen.getByLabelText("Occurrence date");
    expect(occurrenceDate).toMatchObject({ value: "" });
    await user.click(dateButton);
    expect(supplier).toMatchObject({ value: "Acme Supplies" });
    expect(date).toMatchObject({ value: "2026-02-28" });
    expect(reference).toMatchObject({ value: "Saved reference" });
    expect(occurrenceDate).toMatchObject({ value: "2026-02-28" });
    expect(
      screen.getByRole("button", { name: "Apply date 2026-02-28" }),
    ).toBeTruthy();
    await user.clear(occurrenceDate);
    await user.type(occurrenceDate, "2026-02-20");
    await user.clear(date);
    await user.type(date, "2026-03-05");
    await user.click(dateButton);
    expect(date).toMatchObject({ value: "2026-02-28" });
    expect(occurrenceDate).toMatchObject({ value: "2026-02-20" });

    await user.clear(reference);
    await user.type(reference, "Edited reference");
    await user.click(referenceButton);
    expect(supplier).toMatchObject({ value: "Acme Supplies" });
    expect(date).toMatchObject({ value: "2026-02-28" });
    expect(reference).toMatchObject({ value: "INV-104" });
    expect(
      screen.getByRole("button", { name: "Apply reference INV-104" }),
    ).toBeTruthy();
    await user.clear(reference);
    await user.type(reference, "Edited again");
    await user.click(referenceButton);
    expect(reference).toMatchObject({ value: "INV-104" });

    await user.click(
      screen.getByRole("button", { name: "Apply supplier Google Workspace" }),
    );
    expect(supplier).toMatchObject({ value: "Google Workspace" });
    expect(date).toMatchObject({ value: "2026-02-28" });
    expect(reference).toMatchObject({ value: "INV-104" });
  });

  it("humanizes the filename supplier when historical matches are ambiguous", async () => {
    const user = userEvent.setup();
    renderForm(vi.fn(), transaction, [], {
      counterparties: ["Google Workspace", "GOOGLE-WORKSPACE"],
      availableArtifacts: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          filename: "googleWorkspace-2026-03-01-REF-7.pdf",
        },
      ],
    });

    await user.click(
      screen.getByRole("checkbox", {
        name: "googleWorkspace-2026-03-01-REF-7.pdf",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Apply supplier google Workspace" }),
    );

    expect(
      screen.getByRole("combobox", { name: "Supplier / counterparty" }),
    ).toMatchObject({ value: "google Workspace" });
  });

  it("does not offer suggestions for a selected existing PDF with an invalid filename", async () => {
    const user = userEvent.setup();
    renderForm(vi.fn(), transaction, [], {
      availableArtifacts: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          filename: "Invoice without date.pdf",
        },
      ],
    });

    await user.click(
      screen.getByRole("checkbox", { name: "Invoice without date.pdf" }),
    );

    expect(
      screen.queryByRole("group", { name: /Suggestions from PDF/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /^Apply (supplier|date|reference) /,
      }),
    ).toBeNull();
  });

  it("rejects unmatched filenames and resets the offer when the selected PDF changes or clears", async () => {
    const user = userEvent.setup();
    renderForm();
    const pdfInput = screen.getByLabelText("PDF evidence") as HTMLInputElement;

    await user.upload(
      pdfInput,
      new File(["invoice"], "Invoice without date.pdf", {
        type: "application/pdf",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Apply filename suggestions" }),
    ).toBeNull();
    expect(screen.queryByText(/Filename suggests/)).toBeNull();

    await user.upload(
      pdfInput,
      new File(["invoice"], "Acme-2026-02-28-INV-104.pdf", {
        type: "application/pdf",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Apply filename suggestions" }),
    ).toBeTruthy();

    await user.upload(
      pdfInput,
      new File(["invoice"], "Another invoice.pdf", {
        type: "application/pdf",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Apply filename suggestions" }),
    ).toBeNull();

    await user.upload(
      pdfInput,
      new File(["invoice"], "Acme-2026-02-28-INV-104.pdf", {
        type: "application/pdf",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Clear selected PDF" }),
    );

    expect(
      screen.queryByRole("button", { name: "Apply filename suggestions" }),
    ).toBeNull();
    expect(pdfInput.files).toHaveLength(0);
  });

  it("searches available PDFs without losing the selected links", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit, transaction, [], {
      attachedArtifactId: "00000000-0000-4000-8000-000000000002",
      availableArtifacts: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          filename: "first invoice.pdf",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          filename: "second invoice.pdf",
        },
      ],
    });

    const search = screen.getByRole("searchbox", {
      name: "Search available PDFs",
    });
    await user.type(search, "second");

    expect(
      screen.queryByRole("checkbox", { name: "first invoice.pdf" }),
    ).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "second invoice.pdf" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "second invoice.pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].artifactIds).toEqual([
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]);
  });

  it("uses a contribution label and emphasis instead of invoice language", () => {
    renderForm(vi.fn(), {
      ...transaction,
      kind: "owner_contribution",
      documentAmount: "35.1200",
      taxTreatment: "no_tax",
      gstCreditStatus: "not_claimable",
    });

    const amount = screen.getByRole("textbox", { name: "Contribution amount" });
    expect(amount).toMatchObject({ value: "35.1200" });
    expect(amount.closest("form")?.getAttribute("data-owner-funding")).toBe(
      "true",
    );
    expect(screen.queryByRole("textbox", { name: /Invoice total/ })).toBeNull();
  });

  it("prefills a positive bank settlement into a chosen funding amount, then clears it for an invoice kind", async () => {
    const user = userEvent.setup();
    renderForm(
      vi.fn(),
      {
        ...transaction,
        documentAmount: null,
        settlementAmount: "35.1200",
        settlementCurrency: "AUD",
      },
      [],
      { bankSettlementPrefilled: true },
    );

    const kind = screen.getByRole("combobox", { name: "Kind" });
    await user.selectOptions(kind, "owner_contribution");

    expect(
      screen.queryByRole("button", { name: "Use payment values" }),
    ).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Contribution amount" }),
    ).toMatchObject({ value: "35.1200" });
    expect(
      screen.getByRole("combobox", { name: "Funding currency" }),
    ).toMatchObject({ value: "AUD" });

    await user.selectOptions(kind, "supplier_expense");
    expect(
      screen.getByRole("textbox", { name: "Invoice total (tax-inclusive)" }),
    ).toMatchObject({ value: "" });
  });

  it("restores the prior tax values when leaving a kind-specific funding treatment", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentTaxAmount: "4.0000",
      taxTreatment: "unknown_mixed",
      gstCreditStatus: "unknown",
      claimableGstAud: "2.0000",
    });
    renderForm(vi.fn(), initial, [], { gstRegistered: true });

    const kind = screen.getByRole("combobox", { name: "Kind" });
    await user.selectOptions(kind, "owner_contribution");
    await user.selectOptions(kind, "supplier_expense");
    await user.click(screen.getByText("Tax and classification"));

    expect(
      screen.getByRole("combobox", { name: "Document tax treatment" }),
    ).toMatchObject({ value: "unknown_mixed" });
    expect(
      screen.getByRole("textbox", { name: "Exact document tax amount" }),
    ).toMatchObject({ value: "4.0000" });
    expect(
      screen.getByRole("combobox", { name: "GST credit status" }),
    ).toMatchObject({ value: "unknown" });
    expect(
      screen.getByRole("textbox", { name: "Claimable GST (AUD)" }),
    ).toMatchObject({ value: "2.0000" });
  });

  it("restricts the Kind control when used for a bank-row match", () => {
    renderForm(vi.fn(), transaction, [], {
      allowedKinds: ["supplier_expense", "processing_fee"],
    });

    expect(screen.getByRole("combobox", { name: "Kind" })).toMatchObject({
      value: "supplier_expense",
    });
    expect(screen.getByRole("option", { name: "Processing fee" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Sale" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Transfer" })).toBeNull();
  });

  it("offers a known supplier category without filling it until requested", async () => {
    const user = userEvent.setup();
    renderForm(
      vi.fn(),
      { ...transaction, counterparty: "Acme Supplies", category: null },
      [],
      {
        supplierCategories: [
          { counterparty: "Acme Supplies", category: "Office and stationery" },
        ],
      },
    );
    await user.click(screen.getByText("Tax and classification"));

    const category = screen.getByRole("combobox", {
      name: "Operational category",
    });
    expect(category).toMatchObject({ value: "" });
    const apply = screen.getByRole("button", {
      name: "Apply suggestion: Office and stationery",
    });
    await user.click(apply);

    expect(category).toMatchObject({ value: "Office and stationery" });
  });

  it("follows currency for a new draft until the tax treatment is edited", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentCurrency: "AUD",
      taxTreatment: "gst_included",
    });
    renderForm(vi.fn(), initial, [], { autoDefaultTaxTreatment: true });
    await user.click(screen.getByText("Tax and classification"));

    const currency = screen.getByRole("combobox", {
      name: "Document currency",
    });
    const treatment = screen.getByRole("combobox", {
      name: "Document tax treatment",
    });
    expect(treatment).toMatchObject({ value: "gst_included" });

    await user.clear(currency);
    await user.type(currency, "USD");
    expect(treatment).toMatchObject({ value: "foreign_tax_included" });

    await user.clear(currency);
    await user.type(currency, "AUD");
    expect(treatment).toMatchObject({ value: "gst_included" });

    await user.selectOptions(treatment, "gst_separately_shown");
    await user.clear(currency);
    await user.type(currency, "USD");
    await user.clear(currency);
    await user.type(currency, "AUD");
    expect(treatment).toMatchObject({ value: "gst_separately_shown" });
  });

  it("preserves auto-suggested GST only while it matches the currency and treatment", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentCurrency: "AUD",
      taxTreatment: "gst_included",
    });
    renderForm(vi.fn(), initial, [], { autoDefaultTaxTreatment: true });

    const amount = screen.getByRole("textbox", {
      name: "Invoice total (tax-inclusive)",
    });
    const currency = screen.getByRole("combobox", {
      name: "Document currency",
    });
    await user.click(screen.getByText("Tax and classification"));
    const documentTax = screen.getByRole("textbox", {
      name: "Exact document tax amount",
    });

    await user.type(amount, "110");
    await user.tab();
    await waitFor(() =>
      expect(documentTax).toMatchObject({ value: "10.0000" }),
    );

    await user.clear(currency);
    await user.type(currency, "USD");
    expect(documentTax).toMatchObject({ value: "" });

    await user.type(documentTax, "7.50");
    await user.clear(currency);
    await user.type(currency, "AUD");
    expect(documentTax).toMatchObject({ value: "7.50" });
  });

  it("does not auto-change a saved treatment when an existing transaction currency changes", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentCurrency: "AUD",
      taxTreatment: "gst_included",
    });
    renderForm(vi.fn(), initial);

    const currency = screen.getByRole("combobox", {
      name: "Document currency",
    });
    await user.clear(currency);
    await user.type(currency, "USD");

    await user.click(screen.getByText("Tax and classification"));
    expect(
      screen.getByRole("combobox", { name: "Document tax treatment" }),
    ).toMatchObject({ value: "gst_included" });
  });

  it("suppresses ambiguous supplier categories and requires an exact supplier match", async () => {
    const user = userEvent.setup();
    renderForm(
      vi.fn(),
      { ...transaction, counterparty: "Acme Supplies", category: null },
      [],
      {
        supplierCategories: [
          { counterparty: "Acme Supplies", category: "Office and stationery" },
          { counterparty: "Acme Supplies", category: "Equipment and tools" },
          {
            counterparty: "acme supplies",
            category: "Advertising and marketing",
          },
        ],
      },
    );
    await user.click(screen.getByText("Tax and classification"));

    expect(
      screen.queryByRole("button", { name: /Apply suggestion:/ }),
    ).toBeNull();
  });

  it("suggests foreign tax treatment explicitly and preserves user choices", async () => {
    const user = userEvent.setup();
    const initial = transactionInputSchema.parse({
      ...transaction,
      documentCurrency: "AUD",
      taxTreatment: "gst_separately_shown",
    });
    renderForm(vi.fn(), initial);

    const currency = screen.getByRole("combobox", {
      name: "Document currency",
    });
    await user.clear(currency);
    await user.type(currency, "USD");

    const taxDetails = screen
      .getByText("Tax and classification")
      .closest("details");
    await waitFor(() => expect(taxDetails?.open).toBe(true));
    const treatment = screen.getByRole("combobox", {
      name: "Document tax treatment",
    });
    expect(treatment).toMatchObject({ value: "gst_separately_shown" });

    await user.click(
      screen.getByRole("button", {
        name: "Apply suggestion: Foreign tax included",
      }),
    );
    expect(
      screen.getByRole("combobox", { name: "Document tax treatment" }),
    ).toMatchObject({ value: "foreign_tax_included" });

    await user.clear(currency);
    await user.type(currency, "AUD");
    expect(
      screen.getByRole("combobox", { name: "Document tax treatment" }),
    ).toMatchObject({ value: "foreign_tax_included" });
  });

  it("renders submission feedback beside save actions and focuses a new error", async () => {
    const { rerender } = render(formElement(vi.fn(), transaction));
    rerender(
      formElement(vi.fn(), transaction, [], {
        submissionStatus: "Uploading PDF evidence…",
        submissionError: "PDF confirmation failed.",
      }),
    );

    const status = screen.getByRole("status");
    const error = screen.getByRole("alert");
    expect(status.textContent).toBe("Uploading PDF evidence…");
    expect(error.textContent).toBe("PDF confirmation failed.");
    expect(error.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(error));
  });

  it("exposes an accessible evidence error when claimable GST has no invoice", async () => {
    const user = userEvent.setup();
    renderForm(
      vi.fn(),
      transactionInputSchema.parse({
        ...transaction,
        sourceArtifactId: "00000000-0000-4000-8000-000000000001",
        gstCreditStatus: "claimable",
        claimableGstAud: "1.0000",
      }),
      [],
      { gstRegistered: true },
    );

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "PDF invoice",
    );
    expect(
      screen.getByLabelText("PDF evidence").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("exposes draft and recorded actions as native submit controls", () => {
    renderForm();

    expect(screen.getByRole("button", { name: "Save draft" })).toMatchObject({
      type: "submit",
      name: "action",
      value: "save_draft",
    });
    expect(
      screen.getByRole("button", { name: "Save as recorded" }),
    ).toMatchObject({
      type: "submit",
      name: "action",
      value: "save_recorded",
    });
  });

  it("shows a linked summary and focuses an over-precision amount", async () => {
    const user = userEvent.setup();
    renderForm();

    const total = screen.getByRole("textbox", {
      name: "Invoice total (tax-inclusive)",
    });
    await user.type(total, "35.12345");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "up to 4 decimal places",
    );
    expect(document.activeElement).toBe(total);
    await user.click(
      screen.getByRole("button", {
        name: /Invoice total:.*up to 4 decimal places/,
      }),
    );
    expect(document.activeElement).toBe(total);
  });

  it("shows field-specific decimal guidance on blur", async () => {
    const user = userEvent.setup();
    renderForm();

    const total = screen.getByRole("textbox", {
      name: "Invoice total (tax-inclusive)",
    });
    await user.type(total, "35.12345");
    await user.tab();

    expect(
      screen.getByText(
        "Enter a non-negative number with up to 4 decimal places.",
      ).textContent,
    ).toContain("up to 4 decimal places");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("validates an invalid amount when pointer focus moves to another field", async () => {
    const user = userEvent.setup();
    renderForm();

    const total = screen.getByRole("textbox", {
      name: "Invoice total (tax-inclusive)",
    });
    const reference = screen.getByRole("textbox", {
      name: "Invoice / reference",
    });
    await user.type(total, "asda");
    await user.click(reference);

    expect(document.activeElement).toBe(reference);
    expect(
      await screen.findByText(
        "Enter a non-negative number with up to 4 decimal places.",
      ),
    ).toBeTruthy();
    expect(total.getAttribute("aria-invalid")).toBe("true");

    await user.clear(total);
    await user.type(total, "35.1");
    await user.click(reference);
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Enter a non-negative number with up to 4 decimal places.",
        ),
      ).toBeNull(),
    );
    expect(total.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("keeps pointer blur validation working after SSR hydration", async () => {
    const user = userEvent.setup();
    const markup = renderToString(formElement());
    document.body.innerHTML = `<div id="hydration-root">${markup}</div>`;
    const hydrationRoot = document.getElementById("hydration-root");
    if (!hydrationRoot) throw new Error("Hydration root was not rendered");

    const root = hydrateRoot(hydrationRoot, formElement());
    const total = screen.getByRole("textbox", {
      name: "Invoice total (tax-inclusive)",
    });
    const reference = screen.getByRole("textbox", {
      name: "Invoice / reference",
    });

    await user.type(total, "asda");
    await user.click(reference);
    expect(
      await screen.findByText(
        "Enter a non-negative number with up to 4 decimal places.",
      ),
    ).toBeTruthy();
    expect(total.getAttribute("aria-invalid")).toBe("true");

    await user.clear(total);
    await user.type(total, "35.1");
    await user.click(reference);
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Enter a non-negative number with up to 4 decimal places.",
        ),
      ).toBeNull(),
    );
    expect(total.getAttribute("aria-invalid")).not.toBe("true");

    root.unmount();
  });

  it("keeps owner-funding amount rules authoritative at submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit, {
      ...transaction,
      kind: "owner_contribution",
      taxTreatment: "no_tax",
      gstCreditStatus: "not_claimable",
    });

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Owner contributions and loans require a positive amount",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks an amount without its related currency at submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    await user.type(
      screen.getByRole("textbox", {
        name: "Invoice total (tax-inclusive)",
      }),
      "25.00",
    );
    await user.clear(
      screen.getByRole("combobox", { name: "Document currency" }),
    );
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Document currency: Choose a document currency",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["Save draft", "Save as recorded"] as const)(
    "blocks an invalid native %s submission",
    async (actionLabel) => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderForm(onSubmit);

      await user.type(
        screen.getByRole("textbox", {
          name: "Invoice total (tax-inclusive)",
        }),
        "asda",
      );
      submitWith(screen.getByRole("button", { name: actionLabel }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        "Invoice total: Enter a non-negative number with up to 4 decimal places.",
      );
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it("opens closed details before focusing invalid fields and summary targets", async () => {
    const user = userEvent.setup();
    renderForm();

    const tax = screen.getByRole("textbox", {
      name: "Exact document tax amount",
    });
    const details = screen
      .getByText("Tax and classification")
      .closest("details");
    expect(details?.open).toBe(false);
    await user.type(tax, "1.12345");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(details?.open).toBe(true));
    expect(document.activeElement).toBe(tax);
    details!.open = false;
    await user.click(
      screen.getByRole("button", {
        name: /Exact document tax amount:.*up to 4 decimal places/,
      }),
    );
    expect(details?.open).toBe(true);
    expect(document.activeElement).toBe(tax);
  });

  it("maps safe server issues into fields inside closed details", async () => {
    renderForm(vi.fn(), transaction, [
      { field: "notes", message: "Notes were rejected safely" },
    ]);

    const notes = screen.getByRole("textbox", { name: "Notes" });
    const details = screen.getByText("Advanced").closest("details");
    expect(await screen.findByText("Notes were rejected safely")).toBeTruthy();
    await waitFor(() => expect(details?.open).toBe(true));
    expect(document.activeElement).toBe(notes);
  });

  it("maps server errors to native selects with inline accessible guidance", async () => {
    const user = userEvent.setup();
    renderForm(vi.fn(), transaction, [
      {
        field: "taxTreatment",
        message: "Choose a valid tax treatment.",
      },
    ]);

    const select = screen.getByRole("combobox", {
      name: "Document tax treatment",
    });
    const details = screen
      .getByText("Tax and classification")
      .closest("details");
    const error = await screen.findByText("Choose a valid tax treatment.");
    await waitFor(() => expect(details?.open).toBe(true));
    expect(document.activeElement).toBe(select);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe(error.id);

    details!.open = false;
    const summaryButton = screen.getByRole("button", {
      name: "Document tax treatment: Choose a valid tax treatment.",
    });
    await user.click(summaryButton);
    expect(details?.open).toBe(true);
    expect(document.activeElement).toBe(select);
  });

  it("supports keyboard selection in the creatable supplier combobox", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    const supplier = screen.getByRole("combobox", {
      name: "Supplier / counterparty",
    });
    await user.click(supplier);
    await user.type(supplier, "Acme");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].transaction.counterparty).toBe(
      "Acme Supplies",
    );
  });

  it("supports pointer selection in the creatable supplier combobox", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    const supplier = screen.getByRole("combobox", {
      name: "Supplier / counterparty",
    });
    await user.click(supplier);
    await user.type(supplier, "Acme");
    await user.click(
      await screen.findByRole("option", { name: "Acme Supplies" }),
    );
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].transaction.counterparty).toBe(
      "Acme Supplies",
    );
  });

  it("keeps void edits void unless a restore action is chosen", async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit, { ...transaction, status: "void" });

    submitWith(
      screen.getByRole("button", { name: "Save changes (keep void)" }),
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      action: "save_void",
      transaction: { status: "void" },
    });

    submitWith(screen.getByRole("button", { name: "Restore to draft" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0]).toMatchObject({
      action: "restore_draft",
      transaction: { status: "draft" },
    });

    submitWith(screen.getByRole("button", { name: "Restore to recorded" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2][0]).toMatchObject({
      action: "restore_recorded",
      transaction: { status: "recorded" },
    });
  });

  it("keeps recorded edits recorded and does not offer a draft regression", async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit, { ...transaction, status: "recorded" });

    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    submitWith(screen.getByRole("button", { name: "Save changes (recorded)" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      action: "save_recorded",
      transaction: { status: "recorded" },
    });
  });
});
