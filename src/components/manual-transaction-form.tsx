import { AutocompleteSelect } from "./autocomplete";
import { InvoiceSuggestionReview } from "./invoice-suggestion-review";
import type { InvoiceEditableFields } from "../domain/pdf-invoice-fields";
import { useForm } from "@tanstack/react-form";
import {
  Button,
  ComboBox,
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  TextArea,
  TextField,
} from "react-aria-components";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { nonNegativeDecimalSchema, parseDecimal } from "../domain/money";
import {
  applyPdfFilenameSuggestions,
  parsePdfFilename,
  type PdfFilenameSuggestions,
} from "../domain/pdf-filename";
import {
  buildManualTransaction,
  manualTransactionActionSchema,
  manualTransactionEditingFieldError,
  manualTransactionFieldErrors,
  manualTransactionValues,
  type ManualTransactionAction,
  type ManualTransactionServerIssue,
  type ManualTransactionValues,
} from "../domain/manual-transaction";
import {
  defaultTaxTreatmentForTransaction,
  suggestedDocumentTaxAmount,
} from "../domain/tax";
import {
  expenseCategorySuggestions,
  isOwnerFundingKind,
  isOwnerLoanRepaymentKind,
  transactionKindLabels,
  transactionTaxTreatmentLabels,
  type TransactionInput,
  type User,
} from "../domain/types";
import "../styles/manual-transaction-form.css";

const currencySuggestions = ["AUD", "USD"] as const;
const validationArtifactId = "00000000-0000-4000-8000-000000000000";
const noServerIssues: readonly ManualTransactionServerIssue[] = [];
const amountFieldErrorMessage =
  "Enter a non-negative number with up to 4 decimal places.";
const amountFieldNames = new Set<keyof ManualTransactionValues>([
  "documentAmount",
  "settlementAmount",
  "documentTaxAmount",
  "claimableGstAud",
]);
const primaryAmountLabels: Record<TransactionInput["kind"], string> = {
  sale: "Sale total (tax-inclusive)",
  supplier_expense: "Invoice total (tax-inclusive)",
  processing_fee: "Processing fee total",
  sale_refund: "Sale refund total",
  supplier_credit: "Supplier credit total",
  dispute: "Disputed amount",
  transfer: "Transfer amount",
  owner_contribution: "Contribution amount",
  owner_loan: "Loan amount",
  owner_loan_repayment: "Principal amount repaid",
  adjustment: "Adjustment amount",
};

const ownerFundingMatchesBankMovement = (
  kind: TransactionInput["kind"],
  bankMovementIsPositive: boolean,
): boolean =>
  isOwnerFundingKind(kind) &&
  (isOwnerLoanRepaymentKind(kind)
    ? !bankMovementIsPositive
    : bankMovementIsPositive);

export interface ManualTransactionSubmission {
  action: ManualTransactionAction;
  transaction: TransactionInput;
  artifactIds: readonly string[];
  file: File | null;
}

export interface ManualArtifactOption {
  id: string;
  filename?: string;
}

interface ManualTransactionFormProps {
  transaction: TransactionInput;
  users: readonly User[];
  counterparties: readonly string[];
  supplierCategories?: readonly {
    counterparty: string;
    category: string;
  }[];
  categories: readonly string[];
  gstRegistered: boolean;
  attachedArtifactId: string | null;
  attachedArtifactIds?: readonly string[];
  availableArtifacts?: readonly ManualArtifactOption[];
  suggestedEvidence?: ManualArtifactOption;
  allowedKinds?: readonly TransactionInput["kind"][];
  autoDefaultTaxTreatment?: boolean;
  bankSettlementPrefilled?: boolean;
  bankPaymentHints?: {
    foreignCurrency?: string | null;
    foreignAmount?: string | null;
  };
  bankMovementIsPositive?: boolean;
  evidenceStatus: ReactNode;
  busy: boolean;
  onEvidenceChange: (file: File | null) => void;
  onPrepareInvoiceForExtraction?: (
    file: File,
    ownerId: string | null,
  ) => Promise<string>;
  onSubmit: (submission: ManualTransactionSubmission) => Promise<void> | void;
  serverIssues?: readonly ManualTransactionServerIssue[];
  submissionStatus?: string;
  submissionError?: string;
  onCancel?: () => void;
  recordButtonLabel?: string;
}

const fieldIds: Record<keyof ManualTransactionValues, string> = {
  ownerId: "transaction-owner",
  kind: "transaction-kind",
  counterparty: "transaction-counterparty",
  reference: "transaction-reference",
  invoiceDate: "transaction-invoice-date",
  documentAmount: "transaction-document-amount",
  documentCurrency: "transaction-document-currency",
  description: "transaction-description",
  settledAt: "transaction-settled-at",
  settlementCurrency: "transaction-settlement-currency",
  settlementAmount: "transaction-settlement-amount",
  taxTreatment: "transaction-tax-treatment",
  documentTaxAmount: "transaction-document-tax",
  category: "transaction-category",
  gstCreditStatus: "transaction-gst-status",
  claimableGstAud: "transaction-claimable-gst",
  occurredAt: "transaction-occurred-at",
  notes: "transaction-notes",
  artifact: "transaction-pdf",
};

const fieldLabels: Record<keyof typeof fieldIds, string> = {
  ownerId: "Owner",
  kind: "Kind",
  counterparty: "Supplier / counterparty",
  reference: "Invoice / reference",
  invoiceDate: "Invoice date",
  documentAmount: "Invoice total",
  documentCurrency: "Document currency",
  description: "Description",
  settledAt: "Payment date",
  settlementCurrency: "Settlement currency",
  settlementAmount: "Settlement amount",
  taxTreatment: "Document tax treatment",
  documentTaxAmount: "Exact document tax amount",
  category: "Operational category",
  gstCreditStatus: "GST credit status",
  claimableGstAud: "Claimable GST",
  occurredAt: "Occurrence date",
  notes: "Notes",
  artifact: "PDF evidence",
};

const normalizeCounterpartyName = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const humanizeSupplierName = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");

const existingPdfSupplierName = (
  supplier: string,
  counterparties: readonly string[],
) => {
  const normalizedSupplier = normalizeCounterpartyName(supplier);
  const matches = [
    ...new Set(
      counterparties.filter(
        (counterparty) =>
          normalizeCounterpartyName(counterparty) === normalizedSupplier,
      ),
    ),
  ];

  return matches.length === 1 ? matches[0]! : humanizeSupplierName(supplier);
};

const firstError = (errors: unknown[]): string | undefined =>
  errors.find((error): error is string => typeof error === "string");

const formatFieldError = <TField extends keyof ManualTransactionValues>(
  name: TField,
  error: string | undefined,
): string | undefined => {
  if (
    error &&
    amountFieldNames.has(name) &&
    [
      "Expected a decimal with at most four places",
      "Expected a non-negative decimal",
    ].includes(error)
  )
    return amountFieldErrorMessage;
  return error;
};

type PaymentValueSuggestions = Partial<
  Pick<
    ManualTransactionValues,
    "invoiceDate" | "documentCurrency" | "documentAmount"
  >
>;

const getPaymentValueSuggestions = (
  values: ManualTransactionValues,
): PaymentValueSuggestions => {
  const suggestions: PaymentValueSuggestions = {};
  const documentCurrency = values.documentCurrency.trim().toUpperCase();
  const settlementCurrency = values.settlementCurrency.trim().toUpperCase();

  if (!values.invoiceDate.trim() && values.settledAt.trim())
    suggestions.invoiceDate = values.settledAt.trim();

  if (settlementCurrency !== "AUD") return suggestions;

  if (!documentCurrency) suggestions.documentCurrency = "AUD";

  if (
    !values.documentAmount.trim() &&
    (!documentCurrency || documentCurrency === "AUD")
  ) {
    const settlementMagnitude = values.settlementAmount
      .trim()
      .replace(/^-/, "");
    const parsedSettlementAmount =
      nonNegativeDecimalSchema.safeParse(settlementMagnitude);
    if (parsedSettlementAmount.success)
      suggestions.documentAmount = parsedSettlementAmount.data;
  }

  return suggestions;
};

const revealAndFocus = (element: HTMLElement | null) => {
  if (!element) return;
  const details = element.closest("details");
  if (details) details.open = true;
  element.focus();
};

const focusField = (name: keyof typeof fieldIds) => {
  revealAndFocus(document.getElementById(fieldIds[name]));
};

const CreatableField = ({
  id,
  label,
  value,
  options,
  className,
  error,
  help,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  className?: string;
  error?: string;
  help?: ReactNode;
  onChange: (value: string) => void;
  onBlur: () => void;
}) => {
  const query = value.trim().toLocaleLowerCase();
  const visibleOptions = options.filter(
    (option) => !query || option.toLocaleLowerCase().includes(query),
  );

  return (
    <ComboBox
      className={["choice-field", "folio-combobox", className]
        .filter(Boolean)
        .join(" ")}
      allowsCustomValue
      menuTrigger="focus"
      inputValue={value}
      selectedKey={options.includes(value) ? value : null}
      onInputChange={onChange}
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
      isInvalid={Boolean(error)}
    >
      <Label>{label}</Label>
      <div className="combobox-input-row">
        <Input id={id} onBlur={onBlur} />
        <Button aria-label={`Show ${label} suggestions`}>⌄</Button>
      </div>
      <FieldError>{error}</FieldError>
      {help}
      {visibleOptions.length > 0 && (
        <Popover className="autocomplete-popover" isNonModal>
          <ListBox
            items={visibleOptions.map((option) => ({ id: option, option }))}
          >
            {(item) => (
              <ListBoxItem onPointerUp={() => onChange(item.option)}>
                {item.option}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      )}
    </ComboBox>
  );
};

const ManagedTextField = ({
  id,
  label,
  value,
  error,
  multiline,
  type,
  inputMode,
  className,
  help,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  multiline?: boolean;
  type?: "text" | "date";
  inputMode?: "text" | "decimal";
  className?: string;
  help?: ReactNode;
  onChange: (value: string) => void;
  onBlur: () => void;
}) => (
  <TextField
    className={className}
    value={value}
    onChange={onChange}
    onBlur={onBlur}
    isInvalid={Boolean(error)}
  >
    <Label>{label}</Label>
    {multiline ? (
      <TextArea id={id} />
    ) : (
      <Input id={id} type={type ?? "text"} inputMode={inputMode} />
    )}
    <FieldError>{error}</FieldError>
    {help}
  </TextField>
);

export const ManualTransactionForm = ({
  transaction,
  users,
  counterparties,
  supplierCategories = [],
  categories,
  gstRegistered,
  attachedArtifactId,
  attachedArtifactIds,
  availableArtifacts = [],
  suggestedEvidence,
  allowedKinds,
  autoDefaultTaxTreatment = false,
  bankSettlementPrefilled = false,
  bankPaymentHints,
  bankMovementIsPositive = true,
  evidenceStatus,
  busy,
  onEvidenceChange,
  onPrepareInvoiceForExtraction,
  onSubmit,
  serverIssues = noServerIssues,
  submissionStatus,
  submissionError,
  onCancel,
  recordButtonLabel,
}: ManualTransactionFormProps) => {
  const [selectedKind, setSelectedKind] = useState(transaction.kind);
  const ownerFunding = isOwnerFundingKind(selectedKind);
  const ownerLoanRepayment = isOwnerLoanRepaymentKind(selectedKind);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filenameSuggestions, setFilenameSuggestions] =
    useState<PdfFilenameSuggestions | null>(null);
  const [filenameSuggestionFeedback, setFilenameSuggestionFeedback] =
    useState("");
  const [
    existingFilenameSuggestionFeedback,
    setExistingFilenameSuggestionFeedback,
  ] = useState<Record<string, string>>({});
  const [paymentValueFeedback, setPaymentValueFeedback] = useState("");
  const [foreignHintFeedback, setForeignHintFeedback] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [serverFormError, setServerFormError] = useState<string | null>(null);
  const [artifactSearch, setArtifactSearch] = useState("");
  const initialArtifactIds = [
    ...(attachedArtifactIds ??
      (attachedArtifactId ? [attachedArtifactId] : [])),
  ];
  const [selectedArtifactIds, setSelectedArtifactIds] =
    useState<string[]>(initialArtifactIds);
  const initialValues = manualTransactionValues(transaction);
  const [documentCurrency, setDocumentCurrency] = useState(
    initialValues.documentCurrency.trim().toUpperCase(),
  );
  const occurredAtEdited = useRef(Boolean(transaction.occurredAt));
  const initialFundingAmountPrefill =
    bankSettlementPrefilled &&
    ownerFundingMatchesBankMovement(transaction.kind, bankMovementIsPositive) &&
    transaction.settlementCurrency === "AUD" &&
    transaction.documentAmount === transaction.settlementAmount
      ? transaction.documentAmount
      : null;
  const autoFundingAmount = useRef(initialFundingAmountPrefill);
  const documentAmountEdited = useRef(false);
  const autoTaxTreatmentEdited = useRef(false);
  const autoSuggestedDocumentTaxAmount = useRef<string | null>(null);
  const ownerFundingTaxSnapshot = useRef<Pick<
    ManualTransactionValues,
    "taxTreatment" | "documentTaxAmount" | "gstCreditStatus" | "claimableGstAud"
  > | null>(null);
  const submissionErrorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taxDetailsRef = useRef<HTMLDetailsElement>(null);
  const categoryOptions = [
    ...new Set([...expenseCategorySuggestions, ...categories]),
  ];
  const visibleArtifacts = availableArtifacts.filter((artifact) =>
    (artifact.filename ?? "Invoice evidence PDF")
      .toLocaleLowerCase()
      .includes(artifactSearch.trim().toLocaleLowerCase()),
  );
  const kindOptions = Object.entries(transactionKindLabels).filter(
    ([kind]) =>
      !allowedKinds || allowedKinds.includes(kind as TransactionInput["kind"]),
  );

  useEffect(() => {
    setSelectedArtifactIds(initialArtifactIds);
  }, [attachedArtifactId, attachedArtifactIds]);

  useEffect(() => {
    if (submissionError) submissionErrorRef.current?.focus();
  }, [submissionError]);

  const validate = (values: ManualTransactionValues) => {
    const errors = manualTransactionFieldErrors(values, {
      action: "save_draft",
      sourceArtifactId:
        selectedArtifactIds[0] ?? (file ? validationArtifactId : null),
      gstRegistered,
    });
    if (file?.size === 0)
      errors.artifact = "Choose a non-empty PDF file as transaction evidence.";
    else if (
      file &&
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    )
      errors.artifact = "Choose a PDF file as transaction evidence.";
    const visibleErrors = Object.fromEntries(
      Object.entries(errors).map(([name, error]) => [
        name,
        formatFieldError(name as keyof ManualTransactionValues, error),
      ]),
    ) as typeof errors;
    return Object.keys(visibleErrors).length > 0
      ? { fields: visibleErrors }
      : undefined;
  };

  const form = useForm({
    defaultValues: initialValues,
    onSubmitMeta: { action: "save_draft" as ManualTransactionAction },
    validators: {
      onSubmit: ({ value }) => validate(value),
    },
    onSubmitInvalid: () => {
      setAttempted(true);
      queueMicrotask(() => {
        const invalid = document.querySelector<HTMLElement>(
          ".manual-entry-form [aria-invalid='true']",
        );
        revealAndFocus(invalid);
      });
    },
    onSubmit: async ({ value, meta }) => {
      const built = buildManualTransaction(value, {
        action: meta.action,
        sourceArtifactId:
          selectedArtifactIds[0] ?? (file ? validationArtifactId : null),
        gstRegistered,
      });
      await onSubmit({
        action: meta.action,
        transaction: {
          ...built,
          sourceArtifactId: selectedArtifactIds[0] ?? null,
        },
        artifactIds: selectedArtifactIds,
        file,
      });
    },
  });
  const clearAutoSuggestedDocumentTaxAmount = (
    currentValue = form.state.values.documentTaxAmount,
  ) => {
    const suggestedAmount = autoSuggestedDocumentTaxAmount.current;
    if (suggestedAmount === null) return;

    if (currentValue === suggestedAmount)
      form.setFieldValue("documentTaxAmount", "");

    const snapshot = ownerFundingTaxSnapshot.current;
    if (snapshot?.documentTaxAmount === suggestedAmount)
      ownerFundingTaxSnapshot.current = {
        ...snapshot,
        documentTaxAmount: "",
      };

    autoSuggestedDocumentTaxAmount.current = null;
  };
  const setManualTaxTreatment = (
    value: TransactionInput["taxTreatment"],
    onChange: (value: TransactionInput["taxTreatment"]) => void,
  ) => {
    autoTaxTreatmentEdited.current = true;
    const nextSuggestion = suggestedDocumentTaxAmount(
      form.state.values.documentAmount.trim() || null,
      documentCurrency || null,
      value,
    );
    if (autoSuggestedDocumentTaxAmount.current !== nextSuggestion)
      clearAutoSuggestedDocumentTaxAmount();
    onChange(value);
  };
  const fieldError = <TField extends keyof ManualTransactionValues>(
    name: TField,
    value: ManualTransactionValues[TField],
  ) => {
    const domainError = manualTransactionEditingFieldError(name, value);
    if (domainError || name !== "artifact")
      return formatFieldError(name, domainError);
    if (file?.size === 0)
      return "Choose a non-empty PDF file as transaction evidence.";
    if (
      file &&
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    )
      return "Choose a PDF file as transaction evidence.";
    return undefined;
  };

  const applyPdfSuggestionsToBlankFields = (
    suggestions: PdfFilenameSuggestions,
    allowedFields: readonly ("counterparty" | "invoiceDate" | "reference")[],
  ) => {
    const result = applyPdfFilenameSuggestions(
      {
        counterparty: form.state.values.counterparty,
        invoiceDate: form.state.values.invoiceDate,
        reference: form.state.values.reference,
      },
      suggestions,
    );
    const filled = result.filled.filter((name) => allowedFields.includes(name));
    for (const name of filled) {
      form.setFieldValue(name, result.values[name]);
      if (name === "invoiceDate" && !occurredAtEdited.current)
        form.setFieldValue("occurredAt", result.values.invoiceDate);
    }
    const labels = filled.map((name) =>
      name === "counterparty"
        ? "supplier"
        : name === "invoiceDate"
          ? "invoice date"
          : "reference",
    );
    return labels.length > 0
      ? `Applied filename suggestions to ${labels.join(", ")}.`
      : "No blank fields were available to fill.";
  };

  const applyFilenameSuggestions = () => {
    if (!filenameSuggestions) return;
    const feedback = applyPdfSuggestionsToBlankFields(filenameSuggestions, [
      "counterparty",
      "invoiceDate",
      "reference",
    ]);
    setFilenameSuggestionFeedback(
      feedback === "No blank fields were available to fill."
        ? "No blank supplier, invoice date, or reference fields were available to fill."
        : feedback,
    );
  };

  const applyExistingFilenameSuggestion = (
    artifactId: string,
    field: "counterparty" | "invoiceDate" | "reference",
    value: string,
    label: string,
  ) => {
    form.setFieldValue(field, value);
    if (field === "invoiceDate" && !occurredAtEdited.current)
      form.setFieldValue("occurredAt", value);
    setExistingFilenameSuggestionFeedback((current) => ({
      ...current,
      [artifactId]: `Applied ${label} from selected PDF.`,
    }));
  };

  const applyPaymentValues = () => {
    const suggestions = getPaymentValueSuggestions(form.state.values);
    const filled = Object.keys(
      suggestions,
    ) as (keyof PaymentValueSuggestions)[];

    for (const name of filled) {
      const value = suggestions[name];
      if (value === undefined) continue;
      form.setFieldValue(name, value);
      if (name === "documentCurrency") setDocumentCurrency(value.toUpperCase());
      if (name === "invoiceDate" && !occurredAtEdited.current)
        form.setFieldValue("occurredAt", value);
    }

    const labels = filled.map((name) =>
      name === "invoiceDate"
        ? "invoice date"
        : name === "documentCurrency"
          ? "document currency"
          : "document amount",
    );
    setPaymentValueFeedback(
      labels.length > 0
        ? `Applied payment values to ${labels.join(", ")}.`
        : "No blank document fields were available to fill.",
    );
  };

  const applyDocumentCurrency = (value: string) => {
    const currency = value.trim().toUpperCase();
    const currentValues = form.state.values;
    const nextTreatment =
      autoDefaultTaxTreatment &&
      !autoTaxTreatmentEdited.current &&
      !ownerFunding
        ? defaultTaxTreatmentForTransaction(currency || null, selectedKind)
        : currentValues.taxTreatment;
    form.setFieldValue("documentCurrency", value);
    setDocumentCurrency(currency);
    if (
      autoDefaultTaxTreatment &&
      !autoTaxTreatmentEdited.current &&
      !ownerFunding
    )
      form.setFieldValue("taxTreatment", nextTreatment);
    const nextSuggestion = suggestedDocumentTaxAmount(
      currentValues.documentAmount.trim() || null,
      currency || null,
      nextTreatment,
    );
    if (
      autoSuggestedDocumentTaxAmount.current !== null &&
      autoSuggestedDocumentTaxAmount.current !== nextSuggestion
    )
      clearAutoSuggestedDocumentTaxAmount();
  };

  const foreignCurrencyHint = bankPaymentHints?.foreignCurrency
    ?.trim()
    .toUpperCase();
  const foreignAmountHint = bankPaymentHints?.foreignAmount?.trim();
  const validForeignCurrencyHint =
    foreignCurrencyHint && /^[A-Z]{3}$/.test(foreignCurrencyHint)
      ? foreignCurrencyHint
      : null;
  const validForeignAmountHint =
    foreignAmountHint &&
    nonNegativeDecimalSchema.safeParse(foreignAmountHint).success
      ? foreignAmountHint
      : null;

  const clearSelectedFile = () => {
    setFile(null);
    setFilenameSuggestions(null);
    setFilenameSuggestionFeedback("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    form.setFieldValue("artifact", "");
    onEvidenceChange(null);
  };

  const clearServerFieldIssues = () => {
    for (const name of Object.keys(
      form.state.fieldMeta,
    ) as (keyof ManualTransactionValues)[])
      form.setFieldMeta(name, (previous) => ({
        ...previous,
        errorMap: { ...previous?.errorMap, onServer: undefined },
      }));
  };

  useEffect(() => {
    clearServerFieldIssues();
    setServerFormError(null);
    if (serverIssues.length === 0) return;
    setAttempted(true);
    for (const issue of serverIssues) {
      if (issue.field === "form") {
        setServerFormError(issue.message);
        continue;
      }
      const field = issue.field;
      form.setFieldMeta(field, (previous) => ({
        ...previous,
        isTouched: true,
        errorMap: {
          ...previous?.errorMap,
          onServer: formatFieldError(field, issue.message),
        },
      }));
    }
    queueMicrotask(() => {
      const first = serverIssues.find((issue) => issue.field !== "form");
      if (first && first.field !== "form") focusField(first.field);
    });
  }, [serverIssues]);

  const bankFundingDirectionInvalid =
    bankSettlementPrefilled &&
    ownerFunding &&
    !ownerFundingMatchesBankMovement(selectedKind, bankMovementIsPositive);
  const labelForField = (name: keyof typeof fieldLabels) => {
    if (ownerFunding) {
      if (name === "documentAmount") return primaryAmountLabels[selectedKind];
      if (ownerLoanRepayment) {
        if (name === "documentCurrency") return "Repayment currency";
        if (name === "reference") return "Repayment reference";
        if (name === "invoiceDate") return "Repayment date";
      }
      if (name === "documentCurrency") return "Funding currency";
      if (name === "reference") return "Funding reference";
      if (name === "invoiceDate") return "Funding date";
    }
    return fieldLabels[name];
  };
  useEffect(() => {
    if (documentCurrency && documentCurrency !== "AUD")
      taxDetailsRef.current?.setAttribute("open", "");
  }, [documentCurrency]);
  const saveDisabled = busy || bankFundingDirectionInvalid;
  const isVoid = transaction.status === "void";
  const defaultAction: ManualTransactionAction = isVoid
    ? "save_void"
    : transaction.status === "recorded"
      ? "save_recorded"
      : "save_draft";

  return (
    <form
      className="manual-entry-form"
      data-owner-funding={ownerFunding ? "true" : "false"}
      data-transaction-kind={selectedKind}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const submitter = (event.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;
        const submittedAction = manualTransactionActionSchema.safeParse(
          submitter?.value,
        );
        clearServerFieldIssues();
        setServerFormError(null);
        void form.handleSubmit({
          action: submittedAction.success
            ? submittedAction.data
            : defaultAction,
        });
      }}
    >
      <form.Subscribe selector={(state) => state.fieldMeta}>
        {(fieldMeta) => {
          if (!attempted) return null;
          const errors = Object.entries(fieldMeta).flatMap(([name, meta]) => {
            const error = firstError(meta.errors);
            return error
              ? [[name as keyof typeof fieldIds, error] as const]
              : [];
          });
          if (errors.length === 0 && !serverFormError) return null;
          return (
            <div className="form-error-summary wide" role="alert" tabIndex={-1}>
              <strong>Review the highlighted fields</strong>
              <ul>
                {errors.map(([name, error]) => (
                  <li key={name}>
                    <button
                      type="button"
                      className="link"
                      onPointerDown={(event) => {
                        const target = document.getElementById(fieldIds[name]);
                        const details = target?.closest("details");
                        if (details && !details.open) event.preventDefault();
                      }}
                      onClick={() => focusField(name)}
                    >
                      {labelForField(name)}: {error}
                    </button>
                  </li>
                ))}
                {serverFormError && <li>{serverFormError}</li>}
              </ul>
            </div>
          );
        }}
      </form.Subscribe>

      <form.Field
        name="kind"
        validators={{
          onBlur: ({ value }) => fieldError("kind", value),
        }}
      >
        {(field) => {
          const error = firstError(field.state.meta.errors);
          return (
            <div className="choice-field field-kind">
              <label htmlFor={fieldIds.kind}>Kind</label>
              <AutocompleteSelect
                aria-label="Kind"
                id={fieldIds.kind}
                value={field.state.value}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${fieldIds.kind}-error` : undefined}
                onBlur={field.handleBlur}
                onValueChange={(event) => {
                  const kind = event as TransactionInput["kind"];
                  const previousKind = field.state.value;
                  const values = form.state.values;
                  field.handleChange(kind);
                  setSelectedKind(kind);
                  if (
                    bankSettlementPrefilled &&
                    isOwnerLoanRepaymentKind(kind) &&
                    !isOwnerLoanRepaymentKind(previousKind)
                  )
                    form.setFieldValue("ownerId", "");
                  if (isOwnerFundingKind(kind)) {
                    if (!isOwnerFundingKind(previousKind))
                      ownerFundingTaxSnapshot.current = {
                        taxTreatment: values.taxTreatment,
                        documentTaxAmount: values.documentTaxAmount,
                        gstCreditStatus: values.gstCreditStatus,
                        claimableGstAud: values.claimableGstAud,
                      };
                    form.setFieldValue("taxTreatment", "no_tax");
                    form.setFieldValue("documentTaxAmount", "");
                    form.setFieldValue(
                      "gstCreditStatus",
                      gstRegistered ? "not_claimable" : "not_registered",
                    );
                    form.setFieldValue("claimableGstAud", "0.0000");
                    const settlementAmount = values.settlementAmount.trim();
                    const parsedSettlementAmount =
                      nonNegativeDecimalSchema.safeParse(settlementAmount);
                    if (
                      bankSettlementPrefilled &&
                      ownerFundingMatchesBankMovement(
                        kind,
                        bankMovementIsPositive,
                      ) &&
                      !values.documentAmount.trim() &&
                      values.settlementCurrency.trim().toUpperCase() ===
                        "AUD" &&
                      parsedSettlementAmount.success &&
                      parseDecimal(parsedSettlementAmount.data) > 0n
                    ) {
                      form.setFieldValue("documentAmount", settlementAmount);
                      form.setFieldValue("documentCurrency", "AUD");
                      setDocumentCurrency("AUD");
                      autoFundingAmount.current = settlementAmount;
                      documentAmountEdited.current = false;
                    }
                  } else if (
                    bankSettlementPrefilled &&
                    isOwnerFundingKind(previousKind) &&
                    autoFundingAmount.current &&
                    !documentAmountEdited.current &&
                    values.documentAmount === autoFundingAmount.current
                  ) {
                    form.setFieldValue("documentAmount", "");
                    autoFundingAmount.current = null;
                  }
                  if (
                    !isOwnerFundingKind(kind) &&
                    isOwnerFundingKind(previousKind)
                  ) {
                    const snapshot = ownerFundingTaxSnapshot.current;
                    if (snapshot) {
                      if (values.taxTreatment === "no_tax")
                        form.setFieldValue(
                          "taxTreatment",
                          snapshot.taxTreatment,
                        );
                      if (values.documentTaxAmount === "")
                        form.setFieldValue(
                          "documentTaxAmount",
                          snapshot.documentTaxAmount,
                        );
                      if (
                        values.gstCreditStatus ===
                        (gstRegistered ? "not_claimable" : "not_registered")
                      )
                        form.setFieldValue(
                          "gstCreditStatus",
                          snapshot.gstCreditStatus,
                        );
                      if (values.claimableGstAud === "0.0000")
                        form.setFieldValue(
                          "claimableGstAud",
                          snapshot.claimableGstAud,
                        );
                    }
                    ownerFundingTaxSnapshot.current = null;
                  }
                  if (
                    autoDefaultTaxTreatment &&
                    !autoTaxTreatmentEdited.current &&
                    !isOwnerFundingKind(kind)
                  ) {
                    const currency = values.documentCurrency.trim() || null;
                    const treatment = defaultTaxTreatmentForTransaction(
                      currency,
                      kind,
                    );
                    form.setFieldValue("taxTreatment", treatment);
                    const suggestion = suggestedDocumentTaxAmount(
                      values.documentAmount.trim() || null,
                      currency,
                      treatment,
                    );
                    if (
                      autoSuggestedDocumentTaxAmount.current !== null &&
                      autoSuggestedDocumentTaxAmount.current !== suggestion
                    )
                      clearAutoSuggestedDocumentTaxAmount(
                        values.documentTaxAmount,
                      );
                  }
                }}
              >
                {kindOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </AutocompleteSelect>
              {error && (
                <span
                  id={`${fieldIds.kind}-error`}
                  className="react-aria-FieldError"
                >
                  {error}
                </span>
              )}
            </div>
          );
        }}
      </form.Field>

      <form.Field
        name="counterparty"
        validators={{
          onBlur: ({ value }) => fieldError("counterparty", value),
        }}
      >
        {(field) => (
          <CreatableField
            id={fieldIds.counterparty}
            label={
              ownerLoanRepayment
                ? "Recipient description (optional)"
                : ownerFunding
                  ? "Funding source"
                  : "Supplier / counterparty"
            }
            value={field.state.value}
            options={counterparties}
            className="field-counterparty"
            error={firstError(field.state.meta.errors)}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>

      {(["reference", "invoiceDate"] as const).map((name) => (
        <form.Field
          key={name}
          name={name}
          validators={{
            onBlur: ({ value }) => fieldError(name, value),
          }}
        >
          {(field) => (
            <ManagedTextField
              id={fieldIds[name]}
              label={labelForField(name)}
              type={name === "invoiceDate" ? "date" : "text"}
              className={
                name === "invoiceDate"
                  ? "field-invoice-date"
                  : "field-reference"
              }
              value={field.state.value}
              error={firstError(field.state.meta.errors)}
              onChange={(value) => {
                field.handleChange(value);
                if (name === "invoiceDate" && !occurredAtEdited.current)
                  form.setFieldValue("occurredAt", value);
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
      ))}

      <form.Field
        name="documentAmount"
        validators={{
          onBlur: ({ value }) => fieldError("documentAmount", value),
        }}
        listeners={{
          onBlur: ({ value, fieldApi }) => {
            if (fieldApi.form.state.values.documentTaxAmount.trim()) return;
            const suggestion = suggestedDocumentTaxAmount(
              value.trim() || null,
              documentCurrency || null,
              ownerFunding ? "no_tax" : fieldApi.form.state.values.taxTreatment,
            );
            if (suggestion) {
              fieldApi.form.setFieldValue("documentTaxAmount", suggestion);
              autoSuggestedDocumentTaxAmount.current = suggestion;
            }
          },
        }}
      >
        {(field) => (
          <ManagedTextField
            id={fieldIds.documentAmount}
            label={primaryAmountLabels[selectedKind]}
            inputMode="decimal"
            className="field-document-amount"
            value={field.state.value}
            error={firstError(field.state.meta.errors)}
            help={
              ownerLoanRepayment ? (
                <p className="field-help">
                  Enter principal repaid as a positive amount. Record any
                  interest separately; it is not part of this repayment. This is
                  not an invoice total.
                  {bankSettlementPrefilled &&
                    !bankMovementIsPositive &&
                    " The exact outgoing AUD bank movement is prefilled."}
                </p>
              ) : ownerFunding ? (
                <p className="field-help">
                  Owner contributions and loans require a positive funding
                  amount. This is not an invoice total.
                  {bankSettlementPrefilled &&
                    bankMovementIsPositive &&
                    " The exact positive AUD bank movement is prefilled."}
                </p>
              ) : (
                <p className="field-help">
                  Money is kept as entered text and validated as an exact
                  decimal with at most four places.
                </p>
              )
            }
            onChange={(value) => {
              documentAmountEdited.current = true;
              clearAutoSuggestedDocumentTaxAmount();
              field.handleChange(value);
            }}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>

      <form.Field
        name="documentCurrency"
        validators={{
          onBlur: ({ value }) => fieldError("documentCurrency", value),
        }}
      >
        {(field) => (
          <CreatableField
            id={fieldIds.documentCurrency}
            label={
              ownerLoanRepayment
                ? "Repayment currency"
                : ownerFunding
                  ? "Funding currency"
                  : "Document currency"
            }
            value={field.state.value}
            options={currencySuggestions}
            className="field-document-currency"
            error={firstError(field.state.meta.errors)}
            onChange={applyDocumentCurrency}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>

      {bankSettlementPrefilled &&
        !ownerFunding &&
        (validForeignCurrencyHint || validForeignAmountHint) && (
          <div className="wide payment-values-suggestion">
            <p>
              Unverified bank-description hints. Apply each value only if it
              matches the invoice.
            </p>
            {validForeignCurrencyHint && (
              <Button
                type="button"
                onPress={() => {
                  applyDocumentCurrency(validForeignCurrencyHint);
                  setForeignHintFeedback(
                    `Applied ${validForeignCurrencyHint} to document currency.`,
                  );
                }}
              >
                Apply currency {validForeignCurrencyHint}
              </Button>
            )}
            {validForeignAmountHint && (
              <Button
                type="button"
                onPress={() => {
                  documentAmountEdited.current = true;
                  clearAutoSuggestedDocumentTaxAmount();
                  form.setFieldValue("documentAmount", validForeignAmountHint);
                  setForeignHintFeedback(
                    `Applied ${validForeignAmountHint} to invoice total.`,
                  );
                }}
              >
                Apply invoice total {validForeignAmountHint}
              </Button>
            )}
            {foreignHintFeedback && (
              <p role="status" aria-live="polite">
                {foreignHintFeedback}
              </p>
            )}
          </div>
        )}

      {bankSettlementPrefilled && !ownerFunding && (
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const suggestions = getPaymentValueSuggestions(values);
            const hasSuggestions = Object.keys(suggestions).length > 0;
            if (!hasSuggestions && !paymentValueFeedback) return null;

            return (
              <div className="wide payment-values-suggestion">
                {hasSuggestions && (
                  <>
                    <p>
                      Apply invoice PDF date and reference suggestions first
                      when available. Payment values fill only remaining blank
                      fields.
                    </p>
                    <Button type="button" onPress={applyPaymentValues}>
                      Use payment values
                    </Button>
                  </>
                )}
                {paymentValueFeedback && (
                  <p role="status" aria-live="polite">
                    {paymentValueFeedback}
                  </p>
                )}
              </div>
            );
          }}
        </form.Subscribe>
      )}

      <form.Field
        name="description"
        validators={{
          onBlur: ({ value }) => fieldError("description", value),
        }}
      >
        {(field) => (
          <ManagedTextField
            id={fieldIds.description}
            label="Description"
            multiline
            className="field-description"
            value={field.state.value}
            error={firstError(field.state.meta.errors)}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>

      {bankFundingDirectionInvalid ? (
        <p className="wide kind-notice" role="status">
          {ownerLoanRepayment
            ? "This bank row is not a negative cash outflow. Owner loan repayments require an outgoing movement, so create and match is disabled. Choose a kind consistent with the signed bank movement."
            : "This bank row is not a positive cash inflow. Owner contribution and loan kinds require an incoming movement, so create and match is disabled. Choose a kind consistent with the signed bank movement."}
        </p>
      ) : ownerLoanRepayment ? (
        <p className="wide kind-notice" role="status">
          Owner loan repayment is a cash outflow to an owner. Enter principal
          repaid as a positive amount; it is omitted from income, expense, and
          GST summaries.
        </p>
      ) : ownerFunding ? (
        <p className="wide kind-notice" role="status">
          Owner funding is a positive cash addition. Evidence is optional and
          the row is omitted from income, expense, and GST summaries.
        </p>
      ) : null}

      <form.Field
        name="artifact"
        validators={{
          onBlur: ({ value }) => fieldError("artifact", value),
        }}
      >
        {(field) => (
          <div className="wide evidence-panel">
            <label htmlFor={fieldIds.artifact}>PDF evidence</label>
            <input
              id={fieldIds.artifact}
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              aria-invalid={Boolean(firstError(field.state.meta.errors))}
              aria-describedby={
                firstError(field.state.meta.errors)
                  ? `${fieldIds.artifact}-error`
                  : undefined
              }
              onBlur={field.handleBlur}
              onChange={(event) => {
                const next = event.currentTarget.files?.[0] ?? null;
                setFile(next);
                setFilenameSuggestions(
                  next ? parsePdfFilename(next.name) : null,
                );
                setFilenameSuggestionFeedback("");
                field.handleChange(next?.name ?? "");
                onEvidenceChange(next);
              }}
            />
            {file && (
              <Button type="button" onPress={clearSelectedFile}>
                Clear selected PDF
              </Button>
            )}
            {filenameSuggestions && (
              <div className="pdf-filename-suggestion">
                <p role="status" aria-live="polite">
                  Filename suggests {filenameSuggestions.supplier}, invoice date{" "}
                  {filenameSuggestions.invoiceDate}
                  {filenameSuggestions.reference
                    ? `, and reference ${filenameSuggestions.reference}`
                    : ""}
                  .
                </p>
                <Button type="button" onPress={applyFilenameSuggestions}>
                  Apply filename suggestions
                </Button>
                {filenameSuggestionFeedback && (
                  <p role="status" aria-live="polite">
                    {filenameSuggestionFeedback}
                  </p>
                )}
              </div>
            )}
            <fieldset
              className="existing-evidence"
              aria-describedby={
                firstError(field.state.meta.errors)
                  ? `${fieldIds.artifact}-error`
                  : undefined
              }
            >
              <legend>Available invoice PDFs</legend>
              {availableArtifacts.length === 0 ? (
                <p className="existing-evidence-empty">
                  No available invoice PDFs yet. Upload a PDF from Transactions
                  to use it here. An available PDF can be linked to more than
                  one transaction; bank CSV files remain payment provenance, not
                  invoice evidence.
                </p>
              ) : (
                <>
                  <label htmlFor={`${fieldIds.artifact}-search`}>
                    Search available PDFs
                  </label>
                  <Input
                    id={`${fieldIds.artifact}-search`}
                    type="search"
                    value={artifactSearch}
                    onChange={(event) =>
                      setArtifactSearch(event.currentTarget.value)
                    }
                  />
                  <p className="existing-evidence-help">
                    Select one or more PDFs. The same PDF may be linked to
                    multiple transactions.
                  </p>
                  {suggestedEvidence && (
                    <p className="existing-evidence-help">
                      The proposed PDF is selected for recording. To exclude it,
                      use Remove proposed PDF above. Saving the draft does not
                      attach it.
                    </p>
                  )}
                  {visibleArtifacts.length === 0 ? (
                    <p className="existing-evidence-empty" role="status">
                      No available PDFs match that search.
                    </p>
                  ) : (
                    <div className="existing-evidence-options">
                      {visibleArtifacts.map((artifact) => {
                        const checkboxId = `${fieldIds.artifact}-${artifact.id}`;
                        return (
                          <label key={artifact.id} htmlFor={checkboxId}>
                            <input
                              id={checkboxId}
                              type="checkbox"
                              checked={
                                selectedArtifactIds.includes(artifact.id) ||
                                suggestedEvidence?.id === artifact.id
                              }
                              disabled={suggestedEvidence?.id === artifact.id}
                              onChange={(event) => {
                                setSelectedArtifactIds((current) =>
                                  event.currentTarget.checked
                                    ? [...new Set([...current, artifact.id])]
                                    : current.filter(
                                        (id) => id !== artifact.id,
                                      ),
                                );
                                if (!event.currentTarget.checked)
                                  setExistingFilenameSuggestionFeedback(
                                    (current) => {
                                      const next = { ...current };
                                      delete next[artifact.id];
                                      return next;
                                    },
                                  );
                              }}
                            />
                            <span>
                              {artifact.filename ?? "Invoice evidence PDF"}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {[
                    ...new Set([
                      ...selectedArtifactIds,
                      ...(suggestedEvidence ? [suggestedEvidence.id] : []),
                    ]),
                  ].map((artifactId) => {
                    const artifact =
                      availableArtifacts.find(
                        (available) => available.id === artifactId,
                      ) ??
                      (suggestedEvidence?.id === artifactId
                        ? suggestedEvidence
                        : null);
                    const suggestions = artifact?.filename
                      ? parsePdfFilename(artifact.filename)
                      : null;
                    if (!artifact || !suggestions) return null;
                    const sourceIndex =
                      availableArtifacts.findIndex(
                        (available) => available.id === artifact.id,
                      ) + 1;
                    const source =
                      suggestedEvidence?.id === artifactId &&
                      !selectedArtifactIds.includes(artifactId)
                        ? `Proposed PDF: ${artifact.filename}`
                        : `PDF ${sourceIndex}: ${artifact.filename}`;
                    const supplier = existingPdfSupplierName(
                      suggestions.supplier,
                      counterparties,
                    );

                    return (
                      <div
                        key={artifact.id}
                        className="pdf-filename-suggestion existing-pdf-filename-suggestion"
                        role="group"
                        aria-label={`Suggestions from ${source}`}
                      >
                        <p className="existing-pdf-filename-source">{source}</p>
                        <div className="existing-pdf-filename-actions">
                          <Button
                            type="button"
                            onPress={() =>
                              applyExistingFilenameSuggestion(
                                artifact.id,
                                "counterparty",
                                supplier,
                                "supplier",
                              )
                            }
                          >
                            Apply supplier {supplier}
                          </Button>
                          <Button
                            type="button"
                            onPress={() =>
                              applyExistingFilenameSuggestion(
                                artifact.id,
                                "invoiceDate",
                                suggestions.invoiceDate,
                                "invoice date",
                              )
                            }
                          >
                            Apply date {suggestions.invoiceDate}
                          </Button>
                          {suggestions.reference && (
                            <Button
                              type="button"
                              onPress={() =>
                                applyExistingFilenameSuggestion(
                                  artifact.id,
                                  "reference",
                                  suggestions.reference!,
                                  "reference",
                                )
                              }
                            >
                              Apply reference {suggestions.reference}
                            </Button>
                          )}
                        </div>
                        {existingFilenameSuggestionFeedback[artifact.id] && (
                          <p role="status" aria-live="polite">
                            {existingFilenameSuggestionFeedback[artifact.id]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </fieldset>
            {firstError(field.state.meta.errors) && (
              <span
                id={`${fieldIds.artifact}-error`}
                className="react-aria-FieldError"
              >
                {firstError(field.state.meta.errors)}
              </span>
            )}
            <form.Subscribe
              selector={(state) => [
                state.values.counterparty,
                state.values.invoiceDate,
                state.values.reference,
                state.values.documentAmount,
                state.values.documentCurrency,
              ]}
            >
              {() => (
                <InvoiceSuggestionReview
                  file={file}
                  artifacts={[
                    ...new Set([
                      ...selectedArtifactIds,
                      ...(suggestedEvidence ? [suggestedEvidence.id] : []),
                    ]),
                  ].map((id) => ({
                    id,
                    filename:
                      availableArtifacts.find((artifact) => artifact.id === id)
                        ?.filename ??
                      (suggestedEvidence?.id === id
                        ? suggestedEvidence.filename
                        : undefined),
                  }))}
                  busy={busy}
                  prepareFile={
                    onPrepareInvoiceForExtraction
                      ? (selectedFile) =>
                          onPrepareInvoiceForExtraction(
                            selectedFile,
                            form.state.values.ownerId || null,
                          )
                      : undefined
                  }
                  getValues={() => ({
                    counterparty: form.state.values.counterparty,
                    invoiceDate: form.state.values.invoiceDate,
                    reference: form.state.values.reference,
                    documentAmount: form.state.values.documentAmount,
                    documentCurrency: form.state.values.documentCurrency,
                  })}
                  onApply={(changes) => {
                    for (const name of Object.keys(changes) as Array<
                      keyof InvoiceEditableFields
                    >) {
                      const value = changes[name];
                      if (value !== undefined) form.setFieldValue(name, value);
                    }
                    if (changes.documentCurrency !== undefined)
                      setDocumentCurrency(changes.documentCurrency);
                  }}
                />
              )}
            </form.Subscribe>
            {evidenceStatus}
          </div>
        )}
      </form.Field>

      <details
        className={`wide form-details${bankSettlementPrefilled || (documentCurrency && documentCurrency !== "AUD") ? "settlement-prominent" : ""}`}
        open={
          bankSettlementPrefilled ||
          (documentCurrency !== "" && documentCurrency !== "AUD")
            ? true
            : undefined
        }
      >
        <summary>
          {bankSettlementPrefilled
            ? "Bank settlement details (AUD movement)"
            : documentCurrency !== "AUD"
              ? "Foreign-currency settlement details"
              : "Payment details (optional)"}
        </summary>
        <div className="details-grid">
          <form.Field
            name="settledAt"
            validators={{
              onBlur: ({ value }) => fieldError("settledAt", value),
            }}
          >
            {(field) => (
              <ManagedTextField
                id={fieldIds.settledAt}
                label="Payment date / final posted date"
                type="date"
                className="field-settled-at"
                value={field.state.value}
                error={firstError(field.state.meta.errors)}
                onChange={(value) => {
                  field.handleChange(value);
                  if (
                    value &&
                    documentCurrency === "AUD" &&
                    !form.state.values.settlementAmount.trim()
                  ) {
                    form.setFieldValue(
                      "settlementAmount",
                      form.state.values.documentAmount,
                    );
                    form.setFieldValue("settlementCurrency", "AUD");
                  }
                }}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
          <form.Field
            name="settlementCurrency"
            validators={{
              onBlur: ({ value }) => fieldError("settlementCurrency", value),
            }}
          >
            {(field) => (
              <CreatableField
                id={fieldIds.settlementCurrency}
                label="Settlement currency"
                value={field.state.value}
                options={currencySuggestions}
                className="field-settlement-currency"
                error={firstError(field.state.meta.errors)}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
          <form.Field
            name="settlementAmount"
            validators={{
              onBlur: ({ value }) => fieldError("settlementAmount", value),
            }}
          >
            {(field) => (
              <ManagedTextField
                id={fieldIds.settlementAmount}
                label="Settlement amount"
                inputMode="decimal"
                className="field-settlement-amount"
                value={field.state.value}
                error={firstError(field.state.meta.errors)}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
        </div>
      </details>

      <details className="wide form-details" ref={taxDetailsRef}>
        <summary>Tax and classification</summary>
        <div className="details-grid">
          <form.Field
            name="taxTreatment"
            validators={{
              onBlur: ({ value }) => fieldError("taxTreatment", value),
            }}
          >
            {(field) => {
              const error = firstError(field.state.meta.errors);
              return (
                <div className="choice-field field-tax-treatment">
                  <label htmlFor={fieldIds.taxTreatment}>
                    Document tax treatment
                  </label>
                  <AutocompleteSelect
                    aria-label="Document tax treatment"
                    id={fieldIds.taxTreatment}
                    value={ownerFunding ? "no_tax" : field.state.value}
                    disabled={ownerFunding}
                    aria-invalid={Boolean(error)}
                    aria-describedby={
                      error ? `${fieldIds.taxTreatment}-error` : undefined
                    }
                    onBlur={field.handleBlur}
                    onValueChange={(event) =>
                      setManualTaxTreatment(
                        event as TransactionInput["taxTreatment"],
                        field.handleChange,
                      )
                    }
                  >
                    {Object.entries(transactionTaxTreatmentLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </AutocompleteSelect>
                  {error && (
                    <span
                      id={`${fieldIds.taxTreatment}-error`}
                      className="react-aria-FieldError"
                    >
                      {error}
                    </span>
                  )}
                  {!ownerFunding &&
                    documentCurrency !== "" &&
                    documentCurrency !== "AUD" &&
                    field.state.value !== "foreign_tax_included" && (
                      <div className="tax-treatment-suggestion">
                        <p>
                          The document currency is {documentCurrency}. Foreign
                          tax treatment may fit this evidence.
                        </p>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            setManualTaxTreatment(
                              "foreign_tax_included",
                              field.handleChange,
                            )
                          }
                        >
                          Apply suggestion: Foreign tax included
                        </button>
                      </div>
                    )}
                </div>
              );
            }}
          </form.Field>
          <form.Field
            name="documentTaxAmount"
            validators={{
              onBlur: ({ value }) => fieldError("documentTaxAmount", value),
            }}
          >
            {(field) => (
              <ManagedTextField
                id={fieldIds.documentTaxAmount}
                label="Exact document tax amount"
                inputMode="decimal"
                className="field-document-tax-amount"
                value={field.state.value}
                error={firstError(field.state.meta.errors)}
                onChange={(value) => {
                  autoSuggestedDocumentTaxAmount.current = null;
                  field.handleChange(value);
                }}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
          <form.Field
            name="category"
            validators={{
              onBlur: ({ value }) => fieldError("category", value),
            }}
          >
            {(field) => (
              <CreatableField
                id={fieldIds.category}
                label="Operational category"
                value={field.state.value}
                options={categoryOptions}
                className="field-category"
                error={firstError(field.state.meta.errors)}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                help={
                  <form.Subscribe
                    selector={(state) => state.values.counterparty}
                  >
                    {(counterparty) => {
                      const matchingCategories = [
                        ...new Set(
                          supplierCategories
                            .filter(
                              (suggestion) =>
                                suggestion.counterparty === counterparty,
                            )
                            .map((suggestion) => suggestion.category),
                        ),
                      ];
                      const suggestion =
                        matchingCategories.length === 1
                          ? matchingCategories[0]
                          : null;
                      if (
                        ownerFunding ||
                        !suggestion ||
                        field.state.value === suggestion
                      )
                        return null;
                      return (
                        <p className="category-suggestion">
                          Historical category: <strong>{suggestion}</strong>
                          <button
                            type="button"
                            className="secondary"
                            aria-label={`Apply suggestion: ${suggestion}`}
                            onClick={() => field.handleChange(suggestion)}
                          >
                            Apply suggestion
                          </button>
                        </p>
                      );
                    }}
                  </form.Subscribe>
                }
              />
            )}
          </form.Field>
          {gstRegistered && !ownerFunding && (
            <>
              <form.Field
                name="gstCreditStatus"
                validators={{
                  onBlur: ({ value }) => fieldError("gstCreditStatus", value),
                }}
              >
                {(field) => {
                  const error = firstError(field.state.meta.errors);
                  return (
                    <div className="choice-field field-gst-credit-status">
                      <label htmlFor={fieldIds.gstCreditStatus}>
                        GST credit status
                      </label>
                      <AutocompleteSelect
                        aria-label="GST credit status"
                        id={fieldIds.gstCreditStatus}
                        value={field.state.value}
                        aria-invalid={Boolean(error)}
                        aria-describedby={
                          error
                            ? `${fieldIds.gstCreditStatus}-error`
                            : undefined
                        }
                        onBlur={field.handleBlur}
                        onValueChange={(event) =>
                          field.handleChange(
                            event as TransactionInput["gstCreditStatus"],
                          )
                        }
                      >
                        <option value="not_registered">Not registered</option>
                        <option value="unknown">Unknown</option>
                        <option value="not_claimable">Not claimable</option>
                        <option value="claimable">Claimable</option>
                      </AutocompleteSelect>
                      {error && (
                        <span
                          id={`${fieldIds.gstCreditStatus}-error`}
                          className="react-aria-FieldError"
                        >
                          {error}
                        </span>
                      )}
                    </div>
                  );
                }}
              </form.Field>
              <form.Field
                name="claimableGstAud"
                validators={{
                  onBlur: ({ value }) => fieldError("claimableGstAud", value),
                }}
              >
                {(field) => (
                  <ManagedTextField
                    id={fieldIds.claimableGstAud}
                    label="Claimable GST (AUD)"
                    inputMode="decimal"
                    className="field-claimable-gst"
                    value={field.state.value}
                    error={firstError(field.state.meta.errors)}
                    onChange={field.handleChange}
                    onBlur={field.handleBlur}
                  />
                )}
              </form.Field>
            </>
          )}
        </div>
      </details>

      <details
        className="wide form-details"
        open={ownerLoanRepayment || advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>Advanced</summary>
        <div className="details-grid">
          <form.Field
            name="ownerId"
            validators={{
              onBlur: ({ value }) => fieldError("ownerId", value),
            }}
          >
            {(field) => {
              const error = firstError(field.state.meta.errors);
              return (
                <div className="choice-field field-owner">
                  <label htmlFor={fieldIds.ownerId}>
                    {ownerLoanRepayment ? "Owner receiving repayment" : "Owner"}
                  </label>
                  {ownerLoanRepayment && (
                    <p className="field-help">
                      Select the Folio user whose loan is being repaid.
                    </p>
                  )}
                  <AutocompleteSelect
                    aria-label={
                      ownerLoanRepayment ? "Owner receiving repayment" : "Owner"
                    }
                    id={fieldIds.ownerId}
                    value={field.state.value}
                    aria-invalid={Boolean(error)}
                    aria-describedby={
                      error ? `${fieldIds.ownerId}-error` : undefined
                    }
                    onBlur={field.handleBlur}
                    onValueChange={(event) => field.handleChange(event)}
                  >
                    {!field.state.value && (
                      <option value="" disabled>
                        Select an owner
                      </option>
                    )}
                    {users
                      .filter((user) => user.active)
                      .map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName?.trim() || user.email}
                        </option>
                      ))}
                  </AutocompleteSelect>
                  {error && (
                    <span
                      id={`${fieldIds.ownerId}-error`}
                      className="react-aria-FieldError"
                    >
                      {error}
                    </span>
                  )}
                </div>
              );
            }}
          </form.Field>
          <form.Field
            name="occurredAt"
            validators={{
              onBlur: ({ value }) => fieldError("occurredAt", value),
            }}
          >
            {(field) => (
              <ManagedTextField
                id={fieldIds.occurredAt}
                label="Occurrence date"
                type="date"
                className="field-occurred-at"
                value={field.state.value}
                error={firstError(field.state.meta.errors)}
                onChange={(value) => {
                  occurredAtEdited.current = true;
                  field.handleChange(value);
                }}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
          <form.Field
            name="notes"
            validators={{
              onBlur: ({ value }) => fieldError("notes", value),
            }}
          >
            {(field) => (
              <ManagedTextField
                id={fieldIds.notes}
                label="Notes"
                multiline
                className="wide field-notes"
                value={field.state.value}
                error={firstError(field.state.meta.errors)}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
        </div>
      </details>

      <div className="actions wide">
        {isVoid ? (
          <>
            <button
              type="submit"
              name="action"
              value="save_void"
              disabled={saveDisabled}
            >
              Save changes (keep void)
            </button>
            <button
              type="submit"
              name="action"
              value="restore_draft"
              disabled={saveDisabled}
            >
              Restore to draft
            </button>
            <button
              type="submit"
              name="action"
              value="restore_recorded"
              disabled={saveDisabled}
            >
              Restore to recorded
            </button>
          </>
        ) : transaction.status === "recorded" ? (
          <button
            type="submit"
            name="action"
            value="save_recorded"
            disabled={saveDisabled}
          >
            {recordButtonLabel ?? "Save changes (recorded)"}
          </button>
        ) : (
          <>
            <button
              type="submit"
              name="action"
              value="save_draft"
              disabled={saveDisabled}
            >
              Save draft
            </button>
            <button
              type="submit"
              name="action"
              value="save_recorded"
              disabled={saveDisabled}
            >
              {recordButtonLabel ?? "Save as recorded"}
            </button>
          </>
        )}
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel edit
          </button>
        )}
        {submissionStatus && (
          <div className="submission-feedback" role="status" aria-live="polite">
            {submissionStatus}
          </div>
        )}
        {submissionError && (
          <div
            ref={submissionErrorRef}
            className="submission-feedback error"
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
          >
            {submissionError}
          </div>
        )}
      </div>
    </form>
  );
};
