import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Button,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";

import { AutocompleteSelect } from "./autocomplete";
import {
  bulkTransactionFieldLabels,
  type BulkTransactionChange,
  type BulkTransactionPreview,
  type BulkTransactionRequest,
  type BulkTransactionResult,
} from "../domain/bulk-transactions";
import {
  expenseCategorySuggestions,
  transactionKindLabels,
  transactionSourceLabels,
  type TransactionRecord,
  type User,
} from "../domain/types";
import {
  applyBulkTransactionEdit,
  listTransactionFormOptions,
  previewBulkTransactionEdit,
} from "../server/operations";
import "../styles/bulk-transactions.css";

type BulkTransactionField = BulkTransactionChange["field"];
type SelectedTransaction = BulkTransactionRequest["transactions"][number];
type FormOptions = Awaited<ReturnType<typeof listTransactionFormOptions>>;

const safeBulkEditError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message.trim() : "";
  if (
    !message ||
    message.length > 180 ||
    /https?:\/\/|@|secret|password|credential|stack/i.test(message)
  )
    return fallback;
  return message;
};

const userLabel = (user: Pick<User, "displayName" | "email">): string =>
  user.displayName?.trim() || user.email;

const changeFor = (
  field: BulkTransactionField,
  value: string,
): BulkTransactionChange | null => {
  const normalized = value.trim();
  if (!normalized) return null;
  if (field === "ownerId") return { field, value: normalized };
  if (field === "counterparty") return { field, value: normalized };
  return { field: "category", value: normalized };
};

const fieldValue = (
  field: BulkTransactionField,
  value: string | null,
  users: readonly User[],
): string => {
  if (!value) return "—";
  if (field !== "ownerId") return value;
  const owner = users.find((user) => user.id === value);
  return owner ? userLabel(owner) : value;
};

const statusLabel = (status: TransactionRecord["status"]): string =>
  `${status.charAt(0).toLocaleUpperCase()}${status.slice(1)}`;

const transactionPrimaryLabel = (
  row: BulkTransactionPreview["rows"][number],
): string =>
  [
    row.counterparty || "No counterparty",
    row.reference || (!row.description ? row.id : null),
  ]
    .filter(Boolean)
    .join(" · ");

const transactionTypeContext = (
  row: BulkTransactionPreview["rows"][number],
): string =>
  `${transactionSourceLabels[row.sourceSystem]} · ${statusLabel(row.status)}`;

const CreatableValueField = ({
  id,
  label,
  value,
  options,
  maxLength,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) => {
  const query = value.trim().toLocaleLowerCase();
  const visibleOptions = options.filter(
    (option) => !query || option.toLocaleLowerCase().includes(query),
  );

  return (
    <ComboBox
      className="choice-field folio-combobox"
      allowsCustomValue
      menuTrigger="focus"
      isDisabled={disabled}
      inputValue={value}
      selectedKey={options.includes(value) ? value : null}
      onInputChange={onChange}
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <Label>{label}</Label>
      <div className="combobox-input-row">
        <Input id={id} maxLength={maxLength} required />
        <Button type="button" aria-label={`Show ${label} suggestions`}>
          ⌄
        </Button>
      </div>
      {visibleOptions.length > 0 && (
        <Popover className="autocomplete-popover" isNonModal>
          <ListBox
            items={visibleOptions.map((option) => ({ id: option, option }))}
          >
            {(item) => (
              <ListBoxItem textValue={item.option}>{item.option}</ListBoxItem>
            )}
          </ListBox>
        </Popover>
      )}
    </ComboBox>
  );
};

export interface BulkTransactionEditorProps {
  transactions: readonly SelectedTransaction[];
  onApplied: (result: BulkTransactionResult) => Promise<void> | void;
  onApplyFailed: () => Promise<void> | void;
  onApplyBusyChange: (busy: boolean) => void;
  onClose: () => void;
}

export const BulkTransactionEditor = ({
  transactions,
  onApplied,
  onApplyFailed,
  onApplyBusyChange,
  onClose,
}: BulkTransactionEditorProps) => {
  const [field, setField] = useState<BulkTransactionField>("counterparty");
  const [value, setValue] = useState("");
  const [formOptions, setFormOptions] = useState<FormOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [preview, setPreview] = useState<{
    requestKey: string;
    result: BulkTransactionPreview;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [requiresReselection, setRequiresReselection] = useState(false);
  const optionsRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const previewInFlightRef = useRef(false);
  const applyInFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const refreshFormOptions = useCallback(async () => {
    const request = ++optionsRequestRef.current;
    setOptionsLoading(true);
    setOptionsError("");
    try {
      const result = await listTransactionFormOptions();
      if (request !== optionsRequestRef.current) return false;
      setFormOptions(result);
      setOptionsLoading(false);
      return true;
    } catch (loadError) {
      if (request !== optionsRequestRef.current) return false;
      setOptionsError(
        safeBulkEditError(
          loadError,
          "Transaction options could not be loaded.",
        ),
      );
      setOptionsLoading(false);
      return false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshFormOptions();
    return () => {
      mountedRef.current = false;
      ++optionsRequestRef.current;
      ++previewRequestRef.current;
    };
  }, [refreshFormOptions]);

  const selectionKey = JSON.stringify(transactions);
  const hasSelection = transactions.length > 0;
  useEffect(() => {
    ++previewRequestRef.current;
    previewInFlightRef.current = false;
    setPreview(null);
    setPreviewBusy(false);
    if (hasSelection) {
      setRequiresReselection(false);
      setError("");
    }
  }, [hasSelection, selectionKey]);

  const change = changeFor(field, value);
  const request: BulkTransactionRequest | null =
    change && transactions.length > 0
      ? { transactions: [...transactions], change }
      : null;
  const requestKey = JSON.stringify(request);
  const activeUsers = formOptions?.users.filter((user) => user.active) ?? [];
  const currentPreview =
    preview?.requestKey === requestKey ? preview.result : null;
  const canPreview = Boolean(
    request &&
    formOptions &&
    !optionsLoading &&
    !previewBusy &&
    !applyBusy &&
    !requiresReselection &&
    (field !== "ownerId" || activeUsers.some((user) => user.id === value)),
  );
  const canApply = Boolean(
    currentPreview &&
    currentPreview.changedCount > 0 &&
    !previewBusy &&
    !applyBusy &&
    !requiresReselection,
  );

  const invalidatePreview = () => {
    ++previewRequestRef.current;
    previewInFlightRef.current = false;
    setPreview(null);
    setPreviewBusy(false);
    setFeedback("");
    setError("");
  };

  const handleFieldChange = (nextField: BulkTransactionField) => {
    invalidatePreview();
    setField(nextField);
    setValue("");
  };

  const handleValueChange = (nextValue: string) => {
    invalidatePreview();
    setValue(nextValue);
  };

  const previewChanges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !request ||
      !canPreview ||
      previewInFlightRef.current ||
      applyInFlightRef.current
    )
      return;

    const requestSequence = ++previewRequestRef.current;
    previewInFlightRef.current = true;
    setPreviewBusy(true);
    setFeedback("");
    setError("");
    try {
      const result = await previewBulkTransactionEdit({ data: request });
      if (requestSequence !== previewRequestRef.current) return;
      setPreview({ requestKey, result });
    } catch (previewError) {
      if (requestSequence !== previewRequestRef.current) return;
      setError(
        safeBulkEditError(
          previewError,
          "A preview could not be created. Check the selection and retry.",
        ),
      );
    } finally {
      if (requestSequence === previewRequestRef.current) {
        previewInFlightRef.current = false;
        setPreviewBusy(false);
      }
    }
  };

  const applyChanges = async () => {
    if (!request || !currentPreview || !canApply || applyInFlightRef.current)
      return;

    applyInFlightRef.current = true;
    setApplyBusy(true);
    setError("");
    setFeedback("");
    onApplyBusyChange(true);
    try {
      let result: BulkTransactionResult;
      try {
        result = await applyBulkTransactionEdit({ data: request });
      } catch (applyError) {
        if (!mountedRef.current) return;
        ++previewRequestRef.current;
        setPreview(null);
        setRequiresReselection(true);
        try {
          await onApplyFailed();
        } catch {
          setError(
            "The transaction list could not be refreshed after the failed update.",
          );
        }
        const detail = safeBulkEditError(
          applyError,
          "The update result could not be confirmed.",
        );
        setError(
          `${detail} Reload the transaction list and select the transactions again before retrying; the change may already have been applied.`,
        );
        return;
      }

      let pageRefreshFailed = false;
      try {
        await onApplied(result);
      } catch {
        pageRefreshFailed = true;
      }
      if (!mountedRef.current) return;
      setPreview(null);
      const refreshedOptions = await refreshFormOptions();
      setFeedback(
        `Updated ${result.updatedCount} of ${result.selectedCount} selected transactions.${
          !pageRefreshFailed && refreshedOptions
            ? " Options refreshed."
            : " The transaction list or options could not be refreshed; reload before making another edit."
        }`,
      );
    } finally {
      applyInFlightRef.current = false;
      if (mountedRef.current) setApplyBusy(false);
      onApplyBusyChange(false);
    }
  };

  const users = formOptions?.users ?? [];
  const suggestions = formOptions?.entrySuggestions;
  const categorySuggestions = [
    ...new Set([
      ...expenseCategorySuggestions,
      ...(suggestions?.categories ?? []),
    ]),
  ];
  const previewRows = currentPreview?.rows ?? [];
  const unchangedCount = currentPreview
    ? currentPreview.rows.length - currentPreview.changedCount
    : 0;

  return (
    <section
      className="bulk-transaction-editor"
      aria-labelledby="bulk-transaction-editor-heading"
      aria-busy={optionsLoading || previewBusy || applyBusy}
    >
      <div className="bulk-transaction-editor__heading">
        <div>
          <h3 id="bulk-transaction-editor-heading">
            Edit selected transactions
          </h3>
          <p>
            {transactions.length === 0
              ? "No transactions are selected. Select rows on this page to begin another edit."
              : `${transactions.length} transaction${transactions.length === 1 ? "" : "s"} selected from this page.`}
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={applyBusy}
          onClick={onClose}
        >
          Close editor
        </button>
      </div>

      {optionsLoading && (
        <p role="status" aria-live="polite">
          Loading transaction options…
        </p>
      )}
      {optionsError && (
        <div className="bulk-transaction-editor__error">
          <p role="alert">{optionsError}</p>
          <button
            type="button"
            disabled={applyBusy}
            onClick={() => void refreshFormOptions()}
          >
            Retry loading options
          </button>
        </div>
      )}
      {feedback && <p role="status">{feedback}</p>}
      {error && (
        <p className="bulk-transaction-editor__error" role="alert">
          {error}
        </p>
      )}

      {transactions.length > 0 && (
        <>
          <form
            className="bulk-transaction-editor__form"
            onSubmit={(event) => void previewChanges(event)}
          >
            <div className="bulk-transaction-editor__field-picker">
              <label htmlFor="bulk-transaction-field">Field</label>
              <AutocompleteSelect
                aria-label="Field"
                id="bulk-transaction-field"
                value={field}
                disabled={optionsLoading || previewBusy || applyBusy}
                onValueChange={(nextField) =>
                  handleFieldChange(nextField as BulkTransactionField)
                }
              >
                {Object.entries(bulkTransactionFieldLabels).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </AutocompleteSelect>
            </div>

            {field === "ownerId" ? (
              <label>
                Owner
                <AutocompleteSelect
                  aria-label="Owner"
                  value={value}
                  required
                  disabled={optionsLoading || previewBusy || applyBusy}
                  placeholder="Choose an active owner"
                  onValueChange={handleValueChange}
                >
                  <option value="">Choose an active owner</option>
                  {activeUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {userLabel(user)}
                    </option>
                  ))}
                </AutocompleteSelect>
              </label>
            ) : (
              <div className="bulk-transaction-editor__creatable-field">
                <CreatableValueField
                  id={`bulk-${field}`}
                  label={bulkTransactionFieldLabels[field]}
                  value={value}
                  maxLength={field === "counterparty" ? 300 : 200}
                  disabled={optionsLoading || previewBusy || applyBusy}
                  onChange={handleValueChange}
                  options={
                    field === "counterparty"
                      ? (suggestions?.counterparties ?? [])
                      : categorySuggestions
                  }
                />
                <span className="bulk-transaction-editor__help">
                  Choose a suggestion or enter custom text. Values cannot be
                  cleared in bulk.
                </span>
              </div>
            )}

            {field === "ownerId" &&
              activeUsers.length === 0 &&
              !optionsLoading && (
                <p className="bulk-transaction-editor__help">
                  No active users are available as owners.
                </p>
              )}

            <div className="bulk-transaction-editor__actions">
              <button
                type="submit"
                disabled={!canPreview || transactions.length === 0}
              >
                {previewBusy ? "Creating preview…" : "Preview changes"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!canApply}
                onClick={() => void applyChanges()}
              >
                {applyBusy ? "Applying…" : "Apply changes"}
              </button>
            </div>
          </form>

          {currentPreview && (
            <div className="bulk-transaction-editor__preview">
              <div className="bulk-transaction-editor__counts" role="status">
                <span>{currentPreview.changedCount} changed</span>
                <span>{unchangedCount} unchanged</span>
              </div>
              <p className="bulk-transaction-editor__note">
                Editing transaction metadata may make saved tax review results
                out of date. This update does not change partner percentages.
              </p>
              <div
                className="bulk-transaction-editor__table-viewport"
                role="region"
                aria-label="Scrollable transaction change preview"
                tabIndex={0}
              >
                <table
                  className="bulk-transaction-editor__preview-table"
                  aria-label="Transaction change preview"
                >
                  <thead>
                    <tr>
                      <th scope="col">Transaction</th>
                      <th scope="col">Type</th>
                      <th scope="col">Current value</th>
                      <th scope="col">New value</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => {
                      const primaryLabel = transactionPrimaryLabel(row);
                      const typeContext = transactionTypeContext(row);
                      return (
                        <tr key={row.id}>
                          <td>
                            <div className="bulk-transaction-editor__transaction-context">
                              <strong
                                className="bulk-transaction-editor__context-primary"
                                title={primaryLabel}
                              >
                                {primaryLabel}
                              </strong>
                              {row.description && (
                                <span
                                  className="bulk-transaction-editor__context-secondary"
                                  title={row.description}
                                >
                                  {row.description}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="bulk-transaction-editor__type-context">
                              <strong
                                className="bulk-transaction-editor__context-primary"
                                title={transactionKindLabels[row.kind]}
                              >
                                {transactionKindLabels[row.kind]}
                              </strong>
                              <span
                                className="bulk-transaction-editor__context-secondary"
                                title={typeContext}
                              >
                                {typeContext}
                              </span>
                            </div>
                          </td>
                          <td>{fieldValue(field, row.beforeValue, users)}</td>
                          <td>{fieldValue(field, row.afterValue, users)}</td>
                          <td>{row.changed ? "Changed" : "Unchanged"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
