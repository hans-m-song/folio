// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseSupplierInvoice } from "../domain/invoice-parser";
import { normalizedInvoiceDocumentVersion } from "../domain/invoice-types";
import { selectAutocompleteOption } from "./autocomplete-test-helpers";
import { InvoiceSuggestionReview } from "./invoice-suggestion-review";

const operation = vi.hoisted(() => vi.fn());
vi.mock("../server/invoice-operations", () => ({
  extractInvoiceFields: operation,
}));

const blank = {
  counterparty: "",
  invoiceDate: "",
  reference: "",
  documentAmount: "",
  documentCurrency: "AUD",
};
const artifact = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "synthetic.pdf",
};
const response = (lines: string[]) => ({
  status: "parsed" as const,
  artifactId: artifact.id,
  checksumSha256: "synthetic-checksum",
  versionId: "synthetic-version",
  duplicateHints: {
    linkedTransactions: 0,
    matchingReferenceTransactions: 0,
    matchingChecksumArtifacts: 0,
  },
  result: parseSupplierInvoice({
    schemaVersion: normalizedInvoiceDocumentVersion,
    pages: [
      {
        pageNumber: 1,
        width: 612,
        height: 792,
        items: lines.map((text, index) => ({
          text,
          x: 40,
          y: 40 + index * 20,
          width: 300,
          height: 12,
        })),
      },
    ],
  }),
});

beforeEach(() => {
  operation.mockReset();
});
afterEach(cleanup);

describe("invoice review panel", () => {
  it("uploads a new file only on request and flags filename conflicts before applying", async () => {
    operation.mockResolvedValue(
      response([
        "Google Workspace Invoice",
        "Invoice date: 2026-06-30",
        "Total AUD 100.00",
      ]),
    );
    const file = new File(
      ["synthetic pdf"],
      "Google Workspace - 2026-06-01.pdf",
      { type: "application/pdf" },
    );
    const prepare = vi.fn().mockResolvedValue(artifact.id);
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={file}
        artifacts={[]}
        busy={false}
        prepareFile={prepare}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Upload and extract invoice fields" }),
    );
    await screen.findByRole("list", { name: "Invoice field conflicts" });
    expect(prepare).toHaveBeenCalledWith(file);
    expect(operation).toHaveBeenCalledWith({
      data: { artifactId: artifact.id },
    });
    expect(
      screen.getByText(/Invoice date differs from the filename/),
    ).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("extracts only on explicit request and applies invoice fields without settlement or occurrence fields", async () => {
    operation.mockResolvedValue(
      response([
        "Google Workspace Invoice",
        "Invoice date: 2026-06-30",
        "Total AUD 100.00",
        "Amount paid AUD 60.00",
        "Amount due AUD 40.00",
      ]),
    );
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    expect(operation).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await screen.findByRole("button", { name: "Apply to blank fields" });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply to blank fields" }),
    );
    expect(apply).toHaveBeenCalledWith({
      counterparty: "Google Workspace",
      invoiceDate: "2026-06-30",
      documentAmount: "100.0000",
    });
  });

  it("requires reviewed total entry and currency confirmation for paid-only receipts", async () => {
    operation.mockResolvedValue(
      response(["Supabase Invoice", "Subtotal $10.25", "Amount paid $10.25"]),
    );
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    const total = await screen.findByLabelText("Invoice total");
    expect((total as HTMLInputElement).value).toBe("");
    fireEvent.change(total, { target: { value: "10.25" } });
    await selectAutocompleteOption(
      screen.getByRole("combobox", { name: "Currency" }),
      "USD",
    );
    const use = screen.getByRole("button", {
      name: "Use reviewed total and currency",
    });
    expect((use as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I checked the invoice total and currency against the source PDF.",
      }),
    );
    fireEvent.click(use);
    expect(apply).toHaveBeenCalledWith({
      documentAmount: "10.25",
      documentCurrency: "USD",
    });
  });

  it("keeps Stripe facts read-only and shows duplication safeguards", async () => {
    const stripe = response([
      "Stripe Invoice",
      "Processing fees AUD10.00",
      "Total AUD10.00",
      "Amount due AUD0.00",
    ]);
    operation.mockResolvedValue({
      ...stripe,
      duplicateHints: { ...stripe.duplicateHints, linkedTransactions: 2 },
    });
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await screen.findByText(/Stripe review-only/);
    expect(
      screen.queryByRole("button", { name: "Apply to blank fields" }),
    ).toBeNull();
    expect(screen.getByText(/2 existing transaction link/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("discards an extraction response after a target field is edited", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    operation.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let values = { ...blank };
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => values}
        onApply={apply}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    values = { ...values, reference: "Edited while loading" };
    resolve(response(["Google Workspace Invoice", "Total AUD100.00"]));
    await screen.findByText(/Transaction fields changed during extraction/);
    expect(
      screen.queryByRole("button", { name: "Apply to blank fields" }),
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("discards extracted facts after the selected artifact changes", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    operation.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const apply = vi.fn();
    const props = {
      file: null,
      busy: false,
      getValues: () => blank,
      onApply: apply,
    };
    const { rerender } = render(
      <InvoiceSuggestionReview {...props} artifacts={[artifact]} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await waitFor(() => expect(operation).toHaveBeenCalledOnce());
    rerender(
      <InvoiceSuggestionReview
        {...props}
        artifacts={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            filename: "replacement.pdf",
          },
        ]}
      />,
    );
    await act(async () => {
      resolve(response(["Google Workspace Invoice", "Total AUD 100.00"]));
    });
    expect(
      screen.queryByRole("table", { name: "Observed invoice facts" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Apply to blank fields" }),
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledOnce();
    expect(
      (
        screen.getByRole("button", {
          name: "Extract invoice fields",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("does not expose raw extraction failures or mutate transactions", async () => {
    operation.mockRejectedValue(new Error("private diagnostic text"));
    const apply = vi.fn();
    render(
      <InvoiceSuggestionReview
        file={null}
        artifacts={[artifact]}
        busy={false}
        getValues={() => blank}
        onApply={apply}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Extract invoice fields" }),
    );
    await screen.findByText(/Invoice extraction failed/);
    expect(screen.queryByText(/private diagnostic/)).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});
