import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { AutocompleteMultiSelect, AutocompleteSelect } from "./autocomplete";
import "../styles/query-chip-builder.css";

export interface QueryChipClause {
  id: number;
  type: "filter" | "sort";
  field: string;
  operator: string;
  value: string | string[];
}

export interface QueryChipField {
  value: string;
  label: string;
  valueKind: "text" | "date" | "number" | "enum";
  operators: readonly { value: string; label: string }[];
  options?: readonly { value: string; label: string; disabled?: boolean }[];
}

interface QueryChipBuilderProps {
  label: string;
  clauses: QueryChipClause[];
  filterFields: QueryChipField[];
  sortFields: readonly { value: string; label: string }[];
  onChange: (clauses: QueryChipClause[]) => void;
  maxFilters?: number;
  maxSorts?: number;
  defaultSort?: readonly QueryChipClause[];
  isClauseValid?: (clause: QueryChipClause) => boolean;
}

interface EditorState {
  clause: QueryChipClause;
  baseClausesKey: string;
  error: boolean;
}

const membershipOperators = new Set(["contains_any", "contains_none"]);
const sortOperators = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
] as const;

const preferredOperator = (field: QueryChipField): string => {
  const preferred =
    field.valueKind === "text"
      ? "contains"
      : field.valueKind === "enum"
        ? "contains_any"
        : "equals";
  return (
    field.operators.find((operator) => operator.value === preferred)?.value ??
    field.operators[0]?.value ??
    preferred
  );
};

const defaultFilterValue = (
  field: QueryChipField,
  operator: string,
): string | string[] =>
  field.valueKind === "enum" && membershipOperators.has(operator) ? [] : "";

const normalizeOperatorValue = (
  field: QueryChipField,
  operator: string,
  value: string | string[],
): string | string[] => {
  if (field.valueKind !== "enum")
    return typeof value === "string" ? value : (value[0] ?? "");
  if (membershipOperators.has(operator))
    return Array.isArray(value) ? [...value] : value ? [value] : [];
  return typeof value === "string" ? value : (value[0] ?? "");
};

const isValidDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

const basicClauseIsComplete = (
  clause: QueryChipClause,
  filterFields: readonly QueryChipField[],
  sortFields: readonly { value: string; label: string }[],
): boolean => {
  if (clause.type === "sort")
    return (
      sortFields.some((field) => field.value === clause.field) &&
      sortOperators.some((operator) => operator.value === clause.operator) &&
      clause.value === ""
    );

  const field = filterFields.find(
    (candidate) => candidate.value === clause.field,
  );
  if (!field || !clause.operator) return false;
  if (
    !fieldOperators(field).some(
      (operator) => operator.value === clause.operator,
    )
  )
    return false;

  if (field.valueKind === "enum" && membershipOperators.has(clause.operator))
    return (
      Array.isArray(clause.value) &&
      clause.value.some((value) => value.trim() !== "") &&
      clause.value.every((value) =>
        field.options?.some(
          (option) => option.value === value && !option.disabled,
        ),
      )
    );

  if (Array.isArray(clause.value) || clause.value.trim() === "") return false;
  if (field.valueKind === "date") return isValidDate(clause.value);
  if (field.valueKind === "number")
    return Number.isFinite(Number(clause.value));
  if (field.valueKind === "enum")
    return Boolean(
      field.options?.some(
        (option) => option.value === clause.value && !option.disabled,
      ),
    );
  return true;
};

const normalizeClause = (
  clause: QueryChipClause,
  filterFields: readonly QueryChipField[],
): QueryChipClause => {
  if (clause.type === "sort") return { ...clause, value: "" };
  const field = filterFields.find(
    (candidate) => candidate.value === clause.field,
  );
  if (!field) return clause;
  return {
    ...clause,
    value: Array.isArray(clause.value)
      ? clause.value.map((value) => value.trim()).filter(Boolean)
      : clause.value.trim(),
  };
};

const clauseSignature = (clauses: readonly QueryChipClause[]): string =>
  JSON.stringify(clauses);

const clauseSummary = (
  clause: QueryChipClause,
  filterFields: readonly QueryChipField[],
  sortFields: readonly { value: string; label: string }[],
): string => {
  if (clause.type === "sort") {
    const field = sortFields.find(
      (candidate) => candidate.value === clause.field,
    );
    const direction = sortOperators.find(
      (candidate) => candidate.value === clause.operator,
    )?.label;
    return `Sort ${field?.label ?? clause.field} ${direction ?? clause.operator}`;
  }

  const field = filterFields.find(
    (candidate) => candidate.value === clause.field,
  );
  const operator = field?.operators.find(
    (candidate) => candidate.value === clause.operator,
  )?.label;
  const displayValue = Array.isArray(clause.value)
    ? clause.value
        .map(
          (value) =>
            field?.options?.find((option) => option.value === value)?.label ??
            value,
        )
        .join(", ")
    : (field?.options?.find((option) => option.value === clause.value)?.label ??
      clause.value);
  return `Filter ${field?.label ?? clause.field} ${operator ?? clause.operator} ${displayValue}`;
};

const clauseDisplayLabel = (
  clause: QueryChipClause,
  filterFields: readonly QueryChipField[],
  sortFields: readonly { value: string; label: string }[],
): string => {
  if (clause.type === "sort") {
    const field = sortFields.find(
      (candidate) => candidate.value === clause.field,
    );
    return `${field?.label ?? clause.field} ${clause.operator === "asc" ? "↑" : "↓"}`;
  }
  return clauseSummary(clause, filterFields, sortFields).replace(
    /^Filter /,
    "",
  );
};

const fieldOperators = (field: QueryChipField) =>
  field.operators.length > 0
    ? field.operators
    : [{ value: preferredOperator(field), label: preferredOperator(field) }];

const optionInputSize = (
  options: readonly { value: string; label: string }[],
  value: string,
): number =>
  Math.max(
    4,
    (options.find((option) => option.value === value)?.label.length ?? 6) + 2,
  );

const sortSignature = (clauses: readonly QueryChipClause[]): string =>
  JSON.stringify(
    clauses
      .filter((clause) => clause.type === "sort")
      .map(({ field, operator, value }) => [field, operator, value]),
  );

export const QueryChipBuilder = ({
  label,
  clauses,
  filterFields,
  sortFields,
  onChange,
  maxFilters = 20,
  maxSorts = 5,
  defaultSort = [],
  isClauseValid,
}: QueryChipBuilderProps) => {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [addSelection, setAddSelection] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const clausesKey = clauseSignature(clauses);
  const editorCanApply = (candidate: QueryChipClause): boolean =>
    basicClauseIsComplete(candidate, filterFields, sortFields) &&
    (isClauseValid?.(normalizeClause(candidate, filterFields)) ?? true);
  const focusInEditor = (selector: string) => {
    window.setTimeout(() => {
      editorRef.current?.querySelector<HTMLElement>(selector)?.focus();
    }, 0);
  };

  useEffect(() => {
    setEditor((current) =>
      current && current.baseClausesKey !== clausesKey ? null : current,
    );
  }, [clausesKey]);

  const filters = clauses.filter((clause) => clause.type === "filter");
  const sorts = clauses.filter((clause) => clause.type === "sort");
  const availableSortFields = sortFields.filter(
    (field) =>
      !sorts.some(
        (clause) =>
          clause.field === field.value &&
          !(editor?.clause.type === "sort" && editor.clause.id === clause.id),
      ),
  );
  const sortFieldOptions = sortFields.filter(
    (field) =>
      field.value === editor?.clause.field ||
      !sorts.some(
        (clause) =>
          clause.field === field.value &&
          !(editor?.clause.type === "sort" && editor.clause.id === clause.id),
      ),
  );
  const availableAddOptions = [
    ...(filters.length < maxFilters
      ? filterFields.map((field) => ({
          value: `filter:${field.value}`,
          label: `Filter · ${field.label}`,
        }))
      : []),
    ...(sorts.length < maxSorts
      ? availableSortFields.map((field) => ({
          value: `sort:${field.value}`,
          label: `Sort · ${field.label}`,
        }))
      : []),
  ];
  const activeField =
    editor?.clause.type === "filter"
      ? filterFields.find((field) => field.value === editor.clause.field)
      : undefined;
  const summary = editor
    ? clauseSummary(editor.clause, filterFields, sortFields)
    : "";

  const updateEditor = (update: (current: EditorState) => EditorState) =>
    setEditor((current) => (current ? update(current) : current));

  const beginEdit = (clause: QueryChipClause) => {
    setEditor({
      clause: {
        ...clause,
        value: Array.isArray(clause.value) ? [...clause.value] : clause.value,
      },
      baseClausesKey: clausesKey,
      error: false,
    });
    focusInEditor(
      clause.type === "sort"
        ? ".query-chip-builder__operator input"
        : ".query-chip-builder__value input, .query-chip-builder__value select",
    );
  };

  const beginAdd = (selection: string) => {
    const [type, ...fieldParts] = selection.split(":");
    const fieldValue = fieldParts.join(":");
    if (type === "filter") {
      const field = filterFields.find(
        (candidate) => candidate.value === fieldValue,
      );
      if (!field || filters.length >= maxFilters) return;
      const operator = preferredOperator(field);
      setEditor({
        clause: {
          id: Math.max(0, ...clauses.map((clause) => clause.id)) + 1,
          type: "filter",
          field: field.value,
          operator,
          value: defaultFilterValue(field, operator),
        },
        baseClausesKey: clausesKey,
        error: false,
      });
      focusInEditor(".query-chip-builder__operator input");
    }
    if (type === "sort") {
      const field = availableSortFields.find(
        (candidate) => candidate.value === fieldValue,
      );
      if (!field || sorts.length >= maxSorts) return;
      setEditor({
        clause: {
          id: Math.max(0, ...clauses.map((clause) => clause.id)) + 1,
          type: "sort",
          field: field.value,
          operator: "asc",
          value: "",
        },
        baseClausesKey: clausesKey,
        error: false,
      });
      focusInEditor(".query-chip-builder__operator input");
    }
  };

  const commitEditor = () => {
    if (!editor) return false;
    if (editor.baseClausesKey !== clausesKey) {
      setEditor(null);
      return false;
    }
    const next = normalizeClause(editor.clause, filterFields);
    if (!editorCanApply(next)) {
      setEditor((current) => (current ? { ...current, error: true } : current));
      return false;
    }
    if (next.type === "sort") next.value = "";
    const index = clauses.findIndex((clause) => clause.id === next.id);
    const existing = clauses.some((clause) => clause.id === next.id);
    const updated = [...clauses];
    if (existing && index >= 0) updated[index] = next;
    else if (!existing) updated.push(next);
    else {
      setEditor(null);
      return false;
    }
    onChange(updated);
    setEditor(null);
    return true;
  };

  const cancelEditor = () => setEditor(null);

  const handleEditorBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof HTMLElement) {
      if (event.currentTarget.contains(next)) return;
      if (next.closest(".autocomplete-popover")) return;
    }
    if (!editor) return;
    if (editorCanApply(editor.clause)) commitEditor();
    else
      setEditor((current) => (current ? { ...current, error: true } : current));
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.getAttribute("role") === "combobox" &&
        (target.getAttribute("aria-expanded") === "true" ||
          event.defaultPrevented)
      ) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      cancelEditor();
      return;
    }
    if (event.key !== "Enter") return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.tagName === "BUTTON") return;
    if (
      target?.getAttribute("role") === "combobox" &&
      (target.getAttribute("aria-expanded") === "true" ||
        event.defaultPrevented)
    ) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!editor || editorCanApply(editor.clause)) commitEditor();
  };

  const handleBuilderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLElement)) return;
    const target = event.target;
    if (!target.closest(".query-chip-builder__add")) return;
    if (
      target.getAttribute("role") === "combobox" &&
      (target.getAttribute("aria-expanded") === "true" ||
        event.defaultPrevented)
    ) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const setField = (fieldValue: string) => {
    updateEditor((current) => {
      if (current.clause.type === "sort")
        return {
          ...current,
          clause: {
            ...current.clause,
            field: fieldValue,
            operator: "asc",
            value: "",
          },
          error: false,
        };
      const field = filterFields.find(
        (candidate) => candidate.value === fieldValue,
      );
      if (!field) return current;
      const operator = preferredOperator(field);
      return {
        ...current,
        clause: {
          ...current.clause,
          field: field.value,
          operator,
          value: defaultFilterValue(field, operator),
        },
        error: false,
      };
    });
    focusInEditor(".query-chip-builder__operator input");
  };

  const setOperator = (operator: string) => {
    updateEditor((current) => {
      if (current.clause.type === "sort")
        return {
          ...current,
          clause: { ...current.clause, operator, value: "" },
          error: false,
        };
      const field = filterFields.find(
        (candidate) => candidate.value === current.clause.field,
      );
      if (!field) return current;
      return {
        ...current,
        clause: {
          ...current.clause,
          operator,
          value: normalizeOperatorValue(field, operator, current.clause.value),
        },
        error: false,
      };
    });
    focusInEditor(
      editor?.clause.type === "sort"
        ? ".query-chip-builder__apply"
        : ".query-chip-builder__value input, .query-chip-builder__value select",
    );
  };

  const changeValue = (value: string | string[]) =>
    updateEditor((current) => ({
      ...current,
      clause: { ...current.clause, value },
      error: false,
    }));

  const moveClause = (id: number, direction: -1 | 1) => {
    const index = clauses.findIndex((clause) => clause.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= clauses.length) return;
    const next = [...clauses];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const clearFilters = () => {
    cancelEditor();
    onChange(clauses.filter((clause) => clause.type !== "filter"));
  };

  const clearSorts = () => {
    cancelEditor();
    let nextId = Math.max(
      0,
      ...clauses
        .filter((clause) => clause.type !== "sort")
        .map((clause) => clause.id),
    );
    onChange([
      ...clauses.filter((clause) => clause.type !== "sort"),
      ...defaultSort.map((clause) => ({ ...clause, id: ++nextId, value: "" })),
    ]);
  };

  const valueOptions = activeField?.options ?? [];
  const sortDefaultsMatch = sortSignature(sorts) === sortSignature(defaultSort);
  const renderEditor = (): ReactNode => {
    if (!editor) return null;
    const operatorLabel =
      editor.clause.type === "sort"
        ? (sortOperators.find(
            (operator) => operator.value === editor.clause.operator,
          )?.label ?? "direction")
        : (activeField?.operators.find(
            (operator) => operator.value === editor.clause.operator,
          )?.label ?? editor.clause.operator);
    const valueName = activeField
      ? `${activeField.label} ${operatorLabel} ${membershipOperators.has(editor.clause.operator) ? "values" : "value"}`
      : "Filter value";

    return (
      <div
        className="query-chip-builder__editor"
        aria-label={`Edit ${summary}`}
        role="group"
        ref={editorRef}
        onBlur={handleEditorBlur}
        onKeyDown={handleEditorKeyDown}
      >
        {editor.clause.type === "filter" ? (
          <>
            <AutocompleteSelect
              className="query-chip-builder__select query-chip-builder__field"
              aria-label={`${label} filter field`}
              inputSize={optionInputSize(filterFields, editor.clause.field)}
              value={editor.clause.field}
              onValueChange={setField}
            >
              {filterFields.map((field) => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </AutocompleteSelect>
            {activeField && (
              <AutocompleteSelect
                className="query-chip-builder__select query-chip-builder__operator"
                aria-label={`${activeField.label} filter operator`}
                inputSize={optionInputSize(
                  fieldOperators(activeField),
                  editor.clause.operator,
                )}
                value={editor.clause.operator}
                onValueChange={setOperator}
              >
                {fieldOperators(activeField).map((operator) => (
                  <option key={operator.value} value={operator.value}>
                    {operator.label}
                  </option>
                ))}
              </AutocompleteSelect>
            )}
            {activeField && (
              <div className="query-chip-builder__value">
                {activeField.valueKind === "enum" &&
                membershipOperators.has(editor.clause.operator) ? (
                  <AutocompleteMultiSelect
                    aria-label={valueName}
                    options={valueOptions}
                    value={
                      Array.isArray(editor.clause.value)
                        ? editor.clause.value
                        : []
                    }
                    onChange={changeValue}
                  />
                ) : activeField.valueKind === "enum" ? (
                  <AutocompleteSelect
                    className="query-chip-builder__select query-chip-builder__enum-value"
                    aria-label={valueName}
                    inputSize={optionInputSize(
                      valueOptions,
                      Array.isArray(editor.clause.value)
                        ? ""
                        : editor.clause.value,
                    )}
                    value={
                      Array.isArray(editor.clause.value)
                        ? ""
                        : editor.clause.value
                    }
                    onValueChange={(value) => {
                      changeValue(value);
                      focusInEditor(".query-chip-builder__apply");
                    }}
                  >
                    <option value="" disabled>
                      Select a value…
                    </option>
                    {valueOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </AutocompleteSelect>
                ) : (
                  <input
                    className="query-chip-builder__native-value"
                    aria-label={valueName}
                    type={activeField.valueKind}
                    value={
                      Array.isArray(editor.clause.value)
                        ? ""
                        : editor.clause.value
                    }
                    onChange={(event) => changeValue(event.currentTarget.value)}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <AutocompleteSelect
              className="query-chip-builder__select query-chip-builder__field"
              aria-label={`${label} sort field`}
              inputSize={optionInputSize(sortFieldOptions, editor.clause.field)}
              value={editor.clause.field}
              onValueChange={setField}
            >
              {sortFieldOptions.map((field) => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </AutocompleteSelect>
            <AutocompleteSelect
              className="query-chip-builder__select query-chip-builder__operator"
              aria-label={`${label} sort direction`}
              inputSize={optionInputSize(sortOperators, editor.clause.operator)}
              value={editor.clause.operator}
              onValueChange={setOperator}
            >
              {sortOperators.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label}
                </option>
              ))}
            </AutocompleteSelect>
          </>
        )}
        {editor.error && (
          <span className="query-chip-builder__error" role="alert">
            This clause is incomplete or invalid.
          </span>
        )}
        <button
          type="button"
          className="query-chip-builder__apply"
          aria-label={`Apply ${editor.clause.type} clause`}
          disabled={!editorCanApply(editor.clause)}
          onClick={commitEditor}
        >
          ✓
        </button>
        <button
          type="button"
          className="query-chip-builder__cancel"
          aria-label={`Cancel ${editor.clause.type} edit`}
          onClick={cancelEditor}
        >
          ×
        </button>
      </div>
    );
  };

  return (
    <div
      className="query-chip-builder"
      role="region"
      aria-label={label}
      onKeyDown={handleBuilderKeyDown}
    >
      <ul className="query-chip-builder__bar" aria-label={`${label} clauses`}>
        {clauses.map((clause) => {
          const chipLabel = clauseSummary(clause, filterFields, sortFields);
          const displayLabel = clauseDisplayLabel(
            clause,
            filterFields,
            sortFields,
          );
          const sortFieldLabel =
            clause.type === "sort"
              ? (sortFields.find((field) => field.value === clause.field)
                  ?.label ?? clause.field)
              : "";
          const isEditing = editor?.clause.id === clause.id;
          return (
            <li
              className={`query-chip-builder__chip query-chip-builder__chip--${clause.type} ${isEditing ? "query-chip-builder__chip--editing" : ""}`}
              data-clause-id={clause.id}
              key={clause.id}
            >
              {isEditing ? (
                renderEditor()
              ) : (
                <>
                  <button
                    type="button"
                    className="query-chip-builder__chip-label"
                    disabled={Boolean(editor)}
                    aria-label={`Edit ${chipLabel}`}
                    onClick={() => beginEdit(clause)}
                  >
                    {clause.type === "sort" ? (
                      <>
                        <span>{sortFieldLabel}</span>
                        <span
                          className="query-chip-builder__sort-direction"
                          aria-hidden="true"
                        >
                          {clause.operator === "asc" ? "↑" : "↓"}
                        </span>
                      </>
                    ) : (
                      displayLabel
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(editor)}
                    aria-label={`Move ${chipLabel} up`}
                    onClick={() => moveClause(clause.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(editor)}
                    aria-label={`Move ${chipLabel} down`}
                    onClick={() => moveClause(clause.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(editor)}
                    aria-label={`Remove ${chipLabel}`}
                    onClick={() =>
                      onChange(
                        clauses.filter(
                          (candidate) => candidate.id !== clause.id,
                        ),
                      )
                    }
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          );
        })}
        {editor &&
          !clauses.some((clause) => clause.id === editor.clause.id) && (
            <li
              className={`query-chip-builder__chip query-chip-builder__chip--${editor.clause.type} query-chip-builder__chip--editing`}
              data-clause-id={editor.clause.id}
            >
              {renderEditor()}
            </li>
          )}
        {!editor && (
          <li className="query-chip-builder__add-clause">
            <AutocompleteSelect
              className="query-chip-builder__select query-chip-builder__add"
              aria-label={`${label} add filter or sort`}
              inputSize={12}
              placeholder="＋ Add clause"
              value={addSelection}
              disabled={availableAddOptions.length === 0}
              onValueChange={(selection) => {
                setAddSelection("");
                beginAdd(selection);
              }}
            >
              {availableAddOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </AutocompleteSelect>
          </li>
        )}
      </ul>
      <div className="query-chip-builder__secondary-actions">
        <button
          type="button"
          className="secondary"
          disabled={filters.length === 0 || Boolean(editor)}
          onClick={clearFilters}
        >
          Clear filters
        </button>
        <button
          type="button"
          className="secondary"
          disabled={sortDefaultsMatch || Boolean(editor)}
          onClick={clearSorts}
        >
          Clear sorts
        </button>
      </div>
    </div>
  );
};
