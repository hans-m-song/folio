import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import {
  QueryChipBuilder,
  type QueryChipClause,
  type QueryChipField,
} from "../components/query-chip-builder";
import { listBankImports } from "../server/bank-operations";
import bankingCss from "../styles/banking.css?url";

export const bankImportsPageSize = 50;
export const bankImportsFetchLimit = bankImportsPageSize + 1;
export const bankImportsMaxPage = 201;

const importsComparisonOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
]);
const importsTextOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
]);
const importsEnumOperatorSchema = z.enum(["is", "is_not"]);
const importsMembershipOperatorSchema = z.enum([
  "contains_any",
  "contains_none",
]);
const importsStateValues = [
  "pending",
  "awaiting_review",
  "available",
  "rejected",
  "abandoned",
  "superseded",
] as const;
const importsStateSchema = z.enum(importsStateValues);
const importsDateValueSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === value
    );
  });
const importsCountValueSchema = z.string().max(12).regex(/^\d+$/);
const importsTextValueSchema = z.string().trim().min(1).max(200);

const bankImportsFilterSchema = z.union([
  z
    .object({
      field: z.literal("filename"),
      operator: importsTextOperatorSchema,
      value: importsTextValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("earliestDate"),
      operator: importsComparisonOperatorSchema,
      value: importsDateValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("latestDate"),
      operator: importsComparisonOperatorSchema,
      value: importsDateValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("rowCount"),
      operator: importsComparisonOperatorSchema,
      value: importsCountValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("reviewedCount"),
      operator: importsComparisonOperatorSchema,
      value: importsCountValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("unresolvedCount"),
      operator: importsComparisonOperatorSchema,
      value: importsCountValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("state"),
      operator: importsEnumOperatorSchema,
      value: importsStateSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("state"),
      operator: importsMembershipOperatorSchema,
      value: z.array(importsStateSchema).max(importsStateValues.length),
    })
    .strict(),
]);
const bankImportsSortClauseSchema = z
  .object({
    key: z.enum([
      "filename",
      "earliestDate",
      "latestDate",
      "rowCount",
      "reviewedCount",
      "unresolvedCount",
      "state",
    ]),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();
const bankImportsSortSchema = z
  .array(bankImportsSortClauseSchema)
  .max(7)
  .superRefine((clauses, context) => {
    const keys = new Set<string>();
    clauses.forEach(({ key }, index) => {
      if (keys.has(key))
        context.addIssue({
          code: "custom",
          path: [index, "key"],
          message: "Sort fields must be unique",
        });
      keys.add(key);
    });
  });
const bankImportsBuilderClauseSchema = z.union([
  z
    .object({
      type: z.literal("filter"),
      clause: bankImportsFilterSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("sort"),
      clause: bankImportsSortClauseSchema,
    })
    .strict(),
]);

export type BankImportsFilter = z.infer<typeof bankImportsFilterSchema>;
export type BankImportsSort = z.infer<typeof bankImportsSortSchema>[number];
export type BankImportsFilterField = BankImportsFilter["field"];
export type BankImportsSortKey = BankImportsSort["key"];
export type BankImportsBuilderClause = z.infer<
  typeof bankImportsBuilderClauseSchema
>;

export interface BankImportsFilterClause {
  id: number;
  field: BankImportsFilterField;
  operator:
    | z.infer<typeof importsComparisonOperatorSchema>
    | z.infer<typeof importsTextOperatorSchema>
    | z.infer<typeof importsEnumOperatorSchema>
    | z.infer<typeof importsMembershipOperatorSchema>;
  value: string | string[];
}

export interface BankImportsSortClause extends BankImportsSort {
  id: number;
}

export type BankImportsBuilderRow =
  | { type: "filter"; id: number; clause: BankImportsFilterClause }
  | { type: "sort"; id: number; clause: BankImportsSortClause };

export interface BankImportsSearch {
  page: number;
  builder: BankImportsBuilderClause[];
}

export const defaultBankImportsSort: BankImportsSort[] = [];

export const bankImportsFilterFieldLabels: Record<
  BankImportsFilterField,
  string
> = {
  filename: "Source file",
  earliestDate: "Period start",
  latestDate: "Period end",
  rowCount: "Rows",
  reviewedCount: "Reviewed",
  unresolvedCount: "Unresolved",
  state: "Import state",
};

const bankImportsSortFieldLabels: Record<BankImportsSortKey, string> = {
  filename: "Source file",
  earliestDate: "Period start",
  latestDate: "Period end",
  rowCount: "Rows",
  reviewedCount: "Reviewed",
  unresolvedCount: "Unresolved",
  state: "Import state",
};

type BankImportsFilterValueKind = "text" | "date" | "number" | "enum";

const bankImportsFilterValueKinds: Record<
  BankImportsFilterField,
  BankImportsFilterValueKind
> = {
  filename: "text",
  earliestDate: "date",
  latestDate: "date",
  rowCount: "number",
  reviewedCount: "number",
  unresolvedCount: "number",
  state: "enum",
};

type BankImportsFilterOperator = BankImportsFilterClause["operator"];

const bankImportsFilterOperatorOptions: Record<
  BankImportsFilterValueKind,
  readonly { value: BankImportsFilterOperator; label: string }[]
> = {
  text: [
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "does not equal" },
    { value: "contains", label: "contains" },
    { value: "not_contains", label: "does not contain" },
  ],
  date: [
    { value: "equals", label: "=" },
    { value: "not_equals", label: "≠" },
    { value: "greater_than", label: ">" },
    { value: "greater_than_or_equal", label: "≥" },
    { value: "less_than", label: "<" },
    { value: "less_than_or_equal", label: "≤" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "not_equals", label: "≠" },
    { value: "greater_than", label: ">" },
    { value: "greater_than_or_equal", label: "≥" },
    { value: "less_than", label: "<" },
    { value: "less_than_or_equal", label: "≤" },
  ],
  enum: [
    { value: "contains_any", label: "contains any of" },
    { value: "contains_none", label: "contains none of" },
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
  ],
};

const bankImportsFilterOptions: Partial<
  Record<BankImportsFilterField, readonly { value: string; label: string }[]>
> = {
  state: [
    { value: "pending", label: "Pending" },
    { value: "awaiting_review", label: "Awaiting review" },
    { value: "available", label: "Available" },
    { value: "rejected", label: "Rejected" },
    { value: "abandoned", label: "Abandoned" },
    { value: "superseded", label: "Superseded" },
  ],
};

const defaultImportsFilterOperator = (
  field: BankImportsFilterField,
): BankImportsFilterOperator => {
  const valueKind = bankImportsFilterValueKinds[field];
  return valueKind === "text"
    ? "contains"
    : bankImportsFilterOperatorOptions[valueKind][0]!.value;
};

export const resetBankImportsFilterField = (
  clause: BankImportsFilterClause,
  field: BankImportsFilterField,
): BankImportsFilterClause => ({
  ...clause,
  field,
  operator: defaultImportsFilterOperator(field),
  value: bankImportsFilterValueKinds[field] === "enum" ? [] : "",
});

const bankImportsQueryChipFilterFields: QueryChipField[] = (
  Object.keys(bankImportsFilterFieldLabels) as BankImportsFilterField[]
).map((field) => {
  const valueKind = bankImportsFilterValueKinds[field];
  const operators = bankImportsFilterOperatorOptions[valueKind];
  const defaultOperator = defaultImportsFilterOperator(field);

  return {
    value: field,
    label: bankImportsFilterFieldLabels[field],
    valueKind,
    operators: [
      ...operators.filter(({ value }) => value === defaultOperator),
      ...operators.filter(({ value }) => value !== defaultOperator),
    ],
    ...(bankImportsFilterOptions[field]
      ? { options: bankImportsFilterOptions[field] }
      : {}),
  };
});

const bankImportsQueryChipSortFields: readonly {
  value: string;
  label: string;
}[] = (Object.keys(bankImportsSortFieldLabels) as BankImportsSortKey[]).map(
  (field) => ({ value: field, label: bankImportsSortFieldLabels[field] }),
);

const bankImportsDefaultSortQueryChips: readonly QueryChipClause[] = [];

export const bankImportsFiltersForSearch = (
  clauses: readonly BankImportsFilterClause[],
): BankImportsFilter[] =>
  clauses.flatMap(({ id: _id, ...clause }) => {
    const value = Array.isArray(clause.value)
      ? [...clause.value]
      : clause.value.trim();
    if (Array.isArray(value) && value.length === 0) return [];
    const parsed = bankImportsFilterSchema.safeParse({
      ...clause,
      value,
    });
    return parsed.success ? [parsed.data] : [];
  });

export const bankImportsSortsForSearch = (
  clauses: readonly BankImportsSortClause[],
): BankImportsSort[] => {
  const parsed = bankImportsSortSchema.safeParse(
    clauses.map(({ id: _id, ...sort }) => sort),
  );
  return parsed.success ? parsed.data : [];
};

const bankImportsBuilderFromLegacySearch = (
  search: Record<string, unknown>,
): BankImportsBuilderClause[] => {
  const filters = Array.isArray(search.filters)
    ? search.filters.slice(0, 20).flatMap((filter) => {
        const parsed = bankImportsFilterSchema.safeParse(filter);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const sort = bankImportsSortSchema.safeParse(search.sort);

  return [
    ...filters.map((clause) => ({ type: "filter" as const, clause })),
    ...(sort.success ? sort.data : defaultBankImportsSort).map((clause) => ({
      type: "sort" as const,
      clause,
    })),
  ];
};

const bankImportsBuilderForSearch = (
  value: unknown,
): BankImportsBuilderClause[] => {
  if (!Array.isArray(value)) return [];

  const rows = value.slice(0, 27).flatMap((item) => {
    const parsed = bankImportsBuilderClauseSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const result: BankImportsBuilderClause[] = [];
  const sortKeys = new Set<BankImportsSortKey>();
  let filterCount = 0;
  let sortCount = 0;

  for (const row of rows) {
    if (row.type === "filter") {
      if (filterCount >= 20) continue;
      result.push(row);
      filterCount += 1;
      continue;
    }

    if (sortCount >= 7 || sortKeys.has(row.clause.key)) continue;
    result.push(row);
    sortKeys.add(row.clause.key);
    sortCount += 1;
  }

  return result;
};

export const bankImportsBuilderRowsForSearch = (
  clauses: readonly BankImportsBuilderClause[],
): BankImportsBuilderRow[] =>
  clauses.map((row, index) =>
    row.type === "filter"
      ? {
          type: "filter",
          id: index + 1,
          clause: { ...row.clause, id: index + 1 },
        }
      : {
          type: "sort",
          id: index + 1,
          clause: { ...row.clause, id: index + 1 },
        },
  );

export const bankImportsBuilderForSearchRows = (
  rows: readonly BankImportsBuilderRow[],
): BankImportsBuilderClause[] => {
  const builder: BankImportsBuilderClause[] = [];
  const sortKeys = new Set<BankImportsSortKey>();
  let filterCount = 0;
  let sortCount = 0;

  for (const row of rows) {
    if (row.type === "filter") {
      if (filterCount >= 20) continue;
      const parsed = bankImportsFilterSchema.safeParse({
        field: row.clause.field,
        operator: row.clause.operator,
        value: Array.isArray(row.clause.value)
          ? [...row.clause.value]
          : row.clause.value.trim(),
      });
      if (!parsed.success) continue;
      builder.push({ type: "filter", clause: parsed.data });
      filterCount += 1;
      continue;
    }

    if (sortCount >= 7 || sortKeys.has(row.clause.key)) continue;
    const parsed = bankImportsSortClauseSchema.safeParse({
      key: row.clause.key,
      direction: row.clause.direction,
    });
    if (!parsed.success) continue;
    builder.push({ type: "sort", clause: parsed.data });
    sortKeys.add(parsed.data.key);
    sortCount += 1;
  }

  return builder;
};

const bankImportsQueryChipClausesForRows = (
  rows: readonly BankImportsBuilderRow[],
): QueryChipClause[] =>
  rows.map((row) =>
    row.type === "filter"
      ? {
          id: row.id,
          type: "filter",
          field: row.clause.field,
          operator: row.clause.operator,
          value: Array.isArray(row.clause.value)
            ? [...row.clause.value]
            : row.clause.value,
        }
      : {
          id: row.id,
          type: "sort",
          field: row.clause.key,
          operator: row.clause.direction,
          value: "",
        },
  );

const bankImportsBuilderRowsForQueryChipClauses = (
  clauses: readonly QueryChipClause[],
): BankImportsBuilderRow[] =>
  clauses.flatMap<BankImportsBuilderRow>((clause) => {
    if (clause.type === "filter") {
      const parsed = bankImportsFilterSchema.safeParse({
        field: clause.field,
        operator: clause.operator,
        value: clause.value,
      });
      return parsed.success
        ? [
            {
              type: "filter",
              id: clause.id,
              clause: { ...parsed.data, id: clause.id },
            },
          ]
        : [];
    }

    const parsed = bankImportsSortClauseSchema.safeParse({
      key: clause.field,
      direction: clause.operator,
    });
    return parsed.success
      ? [
          {
            type: "sort",
            id: clause.id,
            clause: { ...parsed.data, id: clause.id },
          },
        ]
      : [];
  });

const bankImportsQueryChipClauseIsValid = (
  clause: QueryChipClause,
  currentClauses: readonly QueryChipClause[],
): boolean =>
  bankImportsBuilderRowsForQueryChipClauses([clause]).length === 1 &&
  (clause.type !== "sort" ||
    !currentClauses.some(
      (current) =>
        current.type === "sort" &&
        current.id !== clause.id &&
        current.field === clause.field,
    ));

export const bankImportsQueryPartsForBuilder = (
  builder: readonly BankImportsBuilderClause[],
) => ({
  filters: builder.flatMap((row) => {
    if (row.type !== "filter") return [];
    return Array.isArray(row.clause.value) && row.clause.value.length === 0
      ? []
      : [row.clause];
  }),
  sort: builder.flatMap((row) => (row.type === "sort" ? [row.clause] : [])),
});

export const moveBankImportsBuilderRow = (
  current: readonly BankImportsBuilderRow[],
  index: number,
  offset: -1 | 1,
): BankImportsBuilderRow[] => {
  const nextIndex = index + offset;
  if (
    index < 0 ||
    index >= current.length ||
    nextIndex < 0 ||
    nextIndex >= current.length
  )
    return [...current];
  const next = [...current];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
};

export const bankImportsBuilderWithSorts = (
  builder: readonly BankImportsBuilderClause[],
  sorts: readonly BankImportsSort[],
): BankImportsBuilderClause[] => {
  const currentSortCount = builder.filter((row) => row.type === "sort").length;
  const addedSorts = sorts.slice(
    0,
    Math.max(0, sorts.length - currentSortCount),
  );
  const replacementSorts = sorts.slice(addedSorts.length);
  const next: BankImportsBuilderClause[] = [];
  let replacementIndex = 0;
  let insertedNewSorts = false;

  for (const row of builder) {
    if (row.type !== "sort") {
      next.push(row);
      continue;
    }

    if (!insertedNewSorts) {
      next.push(
        ...addedSorts.map((clause) => ({ type: "sort" as const, clause })),
      );
      insertedNewSorts = true;
    }

    const replacement = replacementSorts[replacementIndex++];
    if (replacement) next.push({ type: "sort", clause: replacement });
  }

  if (!insertedNewSorts) {
    next.unshift(
      ...addedSorts.map((clause) => ({ type: "sort" as const, clause })),
    );
  }

  return next;
};

export const nextBankImportsSort = (
  current: readonly BankImportsSort[],
  key: BankImportsSortKey,
): BankImportsSort[] => {
  const existingIndex = current.findIndex((clause) => clause.key === key);
  if (existingIndex === 0)
    return current.map((clause, index) =>
      index === 0
        ? { ...clause, direction: clause.direction === "asc" ? "desc" : "asc" }
        : clause,
    );
  if (existingIndex > 0)
    return [
      current[existingIndex]!,
      ...current.slice(0, existingIndex),
      ...current.slice(existingIndex + 1),
    ];
  return [{ key, direction: "asc" }, ...current.slice(0, 6)];
};

export const moveBankImportsSortClause = (
  current: readonly BankImportsSortClause[],
  index: number,
  offset: -1 | 1,
): BankImportsSortClause[] => {
  const nextIndex = index + offset;
  if (
    index < 0 ||
    index >= current.length ||
    nextIndex < 0 ||
    nextIndex >= current.length
  )
    return [...current];
  const next = [...current];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
};

export const bankImportsSortIndicator = (
  sort: readonly BankImportsSort[],
  key: BankImportsSortKey,
): string => {
  const index = sort.findIndex((clause) => clause.key === key);
  if (index < 0) return "";
  return ` ${index + 1}${sort[index]!.direction === "asc" ? "↑" : "↓"}`;
};

export const parseBankImportsSearch = (
  search: Record<string, unknown>,
): BankImportsSearch => {
  const page = Number(search.page ?? 1);
  const builder = Array.isArray(search.builder)
    ? bankImportsBuilderForSearch(search.builder)
    : bankImportsBuilderFromLegacySearch(search);
  return {
    page:
      Number.isInteger(page) && page >= 1 && page <= bankImportsMaxPage
        ? page
        : 1,
    builder,
  };
};

export const bankImportsQueryForPage = (
  page: number,
  filters: BankImportsFilter[] = [],
  sort: BankImportsSort[] = defaultBankImportsSort,
) => ({
  limit: bankImportsFetchLimit,
  offset: (page - 1) * bankImportsPageSize,
  filters,
  sort,
});

export const visibleBankImportsPage = <T,>(imports: readonly T[]) => ({
  imports: imports.slice(0, bankImportsPageSize),
  hasNextPage: imports.length > bankImportsPageSize,
});

export const Route = createFileRoute("/banking/imports")({
  head: () => ({ links: [{ rel: "stylesheet", href: bankingCss }] }),
  validateSearch: parseBankImportsSearch,
  loaderDeps: ({ search }) => ({
    page: search.page,
    ...bankImportsQueryPartsForBuilder(search.builder),
  }),
  loader: ({ deps }) =>
    listBankImports({
      data: bankImportsQueryForPage(deps.page, deps.filters, deps.sort),
    }),
  pendingComponent: BankImportsPending,
  errorComponent: BankImportsError,
  component: BankImportsPage,
});

function BankImportsPending() {
  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <h1>Import history</h1>
      <p className="banking-route-pending" role="status" aria-live="polite">
        Loading bank import history…
      </p>
    </main>
  );
}

function BankImportsError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };

  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <section className="banking-panel banking-route-error">
        <h1>Import history unavailable</h1>
        <p role="alert">
          Folio could not load bank import history. Check your access or
          connection, then retry.
        </p>
        <button type="button" onClick={retry}>
          Retry import history
        </button>
      </section>
    </main>
  );
}

function BankImportsPage() {
  const loadedImports = Route.useLoaderData();
  const routeSearch = Route.useSearch();
  const { page, builder } = routeSearch;
  const navigate = useNavigate({ from: "/banking/imports" });
  const builderKey = JSON.stringify(builder);
  const [builderRows, setBuilderRows] = useState<BankImportsBuilderRow[]>(() =>
    bankImportsBuilderRowsForSearch(builder),
  );
  const queryChipClauses = useMemo(
    () => bankImportsQueryChipClausesForRows(builderRows),
    [builderRows],
  );
  const lastAppliedBuilderDraftRef = useRef(JSON.stringify(builderRows));
  const selfAppliedBuilderKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (selfAppliedBuilderKeyRef.current === builderKey) {
      selfAppliedBuilderKeyRef.current = null;
      return;
    }
    const nextRows = bankImportsBuilderRowsForSearch(builder);
    lastAppliedBuilderDraftRef.current = JSON.stringify(nextRows);
    setBuilderRows(nextRows);
  }, [builderKey]);

  useEffect(() => {
    const draftKey = JSON.stringify(builderRows);
    if (lastAppliedBuilderDraftRef.current === draftKey) return;
    lastAppliedBuilderDraftRef.current = draftKey;
    const timeout = window.setTimeout(() => {
      const nextBuilder = bankImportsBuilderForSearchRows(builderRows);
      const nextKey = JSON.stringify(nextBuilder);
      if (nextKey === builderKey) return;
      selfAppliedBuilderKeyRef.current = nextKey;
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, builder: nextBuilder, page: 1 }),
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [builderRows, builderKey, navigate]);

  const updateSearch = (updates: Partial<BankImportsSearch>) => {
    void navigate({ search: (previous) => ({ ...previous, ...updates }) });
  };
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { imports, hasNextPage } = visibleBankImportsPage(loadedImports);
  const canGoNext = hasNextPage && page < bankImportsMaxPage;
  const { filters, sort } = bankImportsQueryPartsForBuilder(builder);
  const sortHeader = (key: BankImportsSortKey, label: string) => {
    const active = sort.find((clause) => clause.key === key);
    return (
      <th
        scope="col"
        aria-sort={
          active
            ? active.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <button
          type="button"
          className="sort-button"
          onClick={() => {
            const currentBuilder = bankImportsBuilderForSearchRows(builderRows);
            const nextSort = nextBankImportsSort(
              bankImportsQueryPartsForBuilder(currentBuilder).sort,
              key,
            );
            updateSearch({
              builder: bankImportsBuilderWithSorts(currentBuilder, nextSort),
              page: 1,
            });
          }}
        >
          {label}
          {bankImportsSortIndicator(sort, key)}
        </button>
      </th>
    );
  };
  if (pathname !== "/banking/imports") return <Outlet />;

  return (
    <main className="banking-page">
      <header className="banking-header">
        <p className="eyebrow">Banking</p>
        <h1>Banking</h1>
        <p className="banking-lead">
          Review imported CommBank source files and their processing state.
        </p>
      </header>

      <nav className="banking-tabs" aria-label="Banking sections">
        <a href="/banking/activity">Activity</a>
        <a href="/banking/reconcile">Reconcile</a>
        <a href="/banking/imports" aria-current="page">
          Imports
        </a>
      </nav>

      <section className="banking-panel" aria-labelledby="bank-imports-heading">
        <div className="banking-panel-heading">
          <div>
            <p className="banking-kicker">CommBank CSV</p>
            <h2 id="bank-imports-heading">Import history</h2>
            <p className="banking-muted">
              Row counts and review state describe imported bank activity, not
              Folio transactions.
            </p>
          </div>
          <a className="banking-button-link" href="/imports/commbank">
            Import CSV
          </a>
        </div>

        <form onSubmit={(event) => event.preventDefault()}>
          <QueryChipBuilder
            label="Import history query"
            clauses={queryChipClauses}
            filterFields={bankImportsQueryChipFilterFields}
            sortFields={bankImportsQueryChipSortFields}
            defaultSort={bankImportsDefaultSortQueryChips}
            onChange={(clauses) =>
              setBuilderRows(bankImportsBuilderRowsForQueryChipClauses(clauses))
            }
            isClauseValid={(clause) =>
              bankImportsQueryChipClauseIsValid(clause, queryChipClauses)
            }
            maxFilters={20}
            maxSorts={7}
          />
        </form>

        {imports.length === 0 ? (
          <div className="banking-empty-state">
            <h3>
              {filters.length > 0 && page === 1
                ? "No imports match these filters"
                : page === 1
                  ? "No bank imports yet"
                  : "No imports on this page"}
            </h3>
            <p>
              {filters.length > 0 && page === 1
                ? "Change or reset the filters to see other imports."
                : page === 1
                  ? "Choose a CommBank transaction history CSV to begin."
                  : `Page ${page} has no imports. The collection may have changed; use Previous to return to available imports.`}
            </p>
            {page === 1 && filters.length === 0 && (
              <a className="banking-button-link" href="/imports/commbank">
                Start an import
              </a>
            )}
          </div>
        ) : (
          <div className="banking-table-scroll">
            <table className="banking-table banking-records-table banking-imports-table">
              <thead>
                <tr>
                  {sortHeader("filename", "Source file")}
                  <th
                    scope="col"
                    aria-sort={
                      sort.some((clause) => clause.key === "earliestDate")
                        ? sort.find((clause) => clause.key === "earliestDate")!
                            .direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="sort-button"
                      onClick={() => {
                        const currentBuilder =
                          bankImportsBuilderForSearchRows(builderRows);
                        const nextSort = nextBankImportsSort(
                          bankImportsQueryPartsForBuilder(currentBuilder).sort,
                          "earliestDate",
                        );
                        updateSearch({
                          builder: bankImportsBuilderWithSorts(
                            currentBuilder,
                            nextSort,
                          ),
                          page: 1,
                        });
                      }}
                    >
                      Period{bankImportsSortIndicator(sort, "earliestDate")}
                    </button>
                  </th>
                  {sortHeader("rowCount", "Rows")}
                  {sortHeader("reviewedCount", "Reviewed")}
                  {sortHeader("unresolvedCount", "Unresolved")}
                  {sortHeader("state", "Import state")}
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr key={item.artifactId}>
                    <td data-label="Source file">{item.filename}</td>
                    <td data-label="Period">
                      {item.earliestDate && item.latestDate
                        ? `${item.earliestDate} to ${item.latestDate}`
                        : "—"}
                    </td>
                    <td data-label="Rows">{item.rowCount}</td>
                    <td data-label="Reviewed">
                      {item.rowCount - item.unresolvedCount}
                    </td>
                    <td data-label="Unresolved">{item.unresolvedCount}</td>
                    <td data-label="Import state">
                      <span
                        className={`banking-state banking-state-${item.state}`}
                      >
                        {item.state}
                      </span>
                    </td>
                    <td data-label="Actions">
                      {item.rowCount > 0 ? (
                        <a
                          className="banking-table-action"
                          href={`/banking/reconcile?artifact=${encodeURIComponent(item.artifactId)}&window=14`}
                          aria-label={`${item.unresolvedCount > 0 ? "Review unresolved rows in" : "View rows in"} ${item.filename}`}
                        >
                          {item.unresolvedCount > 0
                            ? "Review rows"
                            : "View rows"}
                        </a>
                      ) : (
                        <span aria-label="No imported rows">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(page > 1 || imports.length > 0) && (
          <nav className="banking-pagination" aria-label="Import history pages">
            <button
              type="button"
              className="secondary"
              disabled={page <= 1}
              onClick={() => updateSearch({ page: Math.max(1, page - 1) })}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              type="button"
              className="secondary"
              disabled={!canGoNext}
              onClick={() => updateSearch({ page: page + 1 })}
            >
              Next
            </button>
          </nav>
        )}
      </section>
    </main>
  );
}
