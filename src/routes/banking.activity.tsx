import {
  createFileRoute,
  useNavigate,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import {
  QueryChipBuilder,
  type QueryChipClause,
  type QueryChipField,
} from "../components/query-chip-builder";
import { MoneyText } from "../components/money-text";
import { TableIconAction } from "../components/table-icon-action";
import { formatAudDecimal } from "../domain/money";
import { listBankTransactions } from "../server/bank-operations";
import bankingCss from "../styles/banking.css?url";

export const bankActivityPageSize = 50;
export const bankActivityFetchLimit = bankActivityPageSize + 1;
export const bankActivityMaxPage = 201;

const activityComparisonOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
]);
const activityTextOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
]);
const activityEnumOperatorSchema = z.enum(["is", "is_not"]);
const activityMembershipOperatorSchema = z.enum([
  "contains_any",
  "contains_none",
]);
const activityReviewStateValues = [
  "unresolved",
  "matched",
  "private",
  "transfer",
  "duplicate",
] as const;
const activityReviewStateSchema = z.enum(activityReviewStateValues);
const activityMatchStatusValues = ["matched", "unmatched"] as const;
const activityMatchStatusSchema = z.enum(activityMatchStatusValues);
const activityDateValueSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === value
    );
  });
const activityNumberValueSchema = z
  .string()
  .max(48)
  .regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/);
const activityTextValueSchema = z.string().trim().min(1).max(200);

const bankActivityFilterSchema = z.union([
  z
    .object({
      field: z.literal("postedDate"),
      operator: activityComparisonOperatorSchema,
      value: activityDateValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("description"),
      operator: activityTextOperatorSchema,
      value: activityTextValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("amountAud"),
      operator: activityComparisonOperatorSchema,
      value: activityNumberValueSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("reviewState"),
      operator: activityEnumOperatorSchema,
      value: activityReviewStateSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("reviewState"),
      operator: activityMembershipOperatorSchema,
      value: z
        .array(activityReviewStateSchema)
        .max(activityReviewStateValues.length),
    })
    .strict(),
  z
    .object({
      field: z.literal("matchStatus"),
      operator: activityEnumOperatorSchema,
      value: activityMatchStatusSchema,
    })
    .strict(),
  z
    .object({
      field: z.literal("matchStatus"),
      operator: activityMembershipOperatorSchema,
      value: z
        .array(activityMatchStatusSchema)
        .max(activityMatchStatusValues.length),
    })
    .strict(),
]);
const bankActivitySortClauseSchema = z
  .object({
    key: z.enum([
      "postedDate",
      "description",
      "amountAud",
      "reviewState",
      "matchStatus",
    ]),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();
const bankActivitySortSchema = z
  .array(bankActivitySortClauseSchema)
  .max(5)
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
const bankActivityBuilderClauseSchema = z.union([
  z
    .object({
      type: z.literal("filter"),
      clause: bankActivityFilterSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("sort"),
      clause: bankActivitySortClauseSchema,
    })
    .strict(),
]);

export type BankActivityFilter = z.infer<typeof bankActivityFilterSchema>;
export type BankActivitySort = z.infer<typeof bankActivitySortSchema>[number];
export type BankActivityFilterField = BankActivityFilter["field"];
export type BankActivitySortKey = BankActivitySort["key"];
export type BankActivityBuilderClause = z.infer<
  typeof bankActivityBuilderClauseSchema
>;

export interface BankActivityFilterClause {
  id: number;
  field: BankActivityFilterField;
  operator:
    | z.infer<typeof activityComparisonOperatorSchema>
    | z.infer<typeof activityTextOperatorSchema>
    | z.infer<typeof activityEnumOperatorSchema>
    | z.infer<typeof activityMembershipOperatorSchema>;
  value: string | string[];
}

export interface BankActivitySortClause extends BankActivitySort {
  id: number;
}

export type BankActivityBuilderRow =
  | { type: "filter"; id: number; clause: BankActivityFilterClause }
  | { type: "sort"; id: number; clause: BankActivitySortClause };

export interface BankActivitySearch {
  page: number;
  builder: BankActivityBuilderClause[];
}

export const defaultBankActivitySort: BankActivitySort[] = [
  { key: "postedDate", direction: "desc" },
];

export const bankActivityFilterFieldLabels: Record<
  BankActivityFilterField,
  string
> = {
  postedDate: "Posted date",
  description: "Description",
  amountAud: "Movement",
  reviewState: "Review state",
  matchStatus: "Match status",
};

const bankActivitySortFieldLabels: Record<BankActivitySortKey, string> = {
  postedDate: "Posted date",
  description: "Description",
  amountAud: "Movement",
  reviewState: "Review state",
  matchStatus: "Match status",
};

type BankActivityFilterValueKind = "text" | "date" | "number" | "enum";

const bankActivityFilterValueKinds: Record<
  BankActivityFilterField,
  BankActivityFilterValueKind
> = {
  postedDate: "date",
  description: "text",
  amountAud: "number",
  reviewState: "enum",
  matchStatus: "enum",
};

type BankActivityFilterOperator = BankActivityFilterClause["operator"];

const bankActivityFilterOperatorOptions: Record<
  BankActivityFilterValueKind,
  readonly { value: BankActivityFilterOperator; label: string }[]
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

const bankActivityFilterOptions: Partial<
  Record<BankActivityFilterField, readonly { value: string; label: string }[]>
> = {
  reviewState: [
    { value: "unresolved", label: "Unresolved" },
    { value: "matched", label: "Matched" },
    { value: "private", label: "Private" },
    { value: "transfer", label: "Transfer" },
    { value: "duplicate", label: "Duplicate" },
  ],
  matchStatus: [
    { value: "matched", label: "Matched" },
    { value: "unmatched", label: "Unmatched" },
  ],
};

const defaultActivityFilterOperator = (
  field: BankActivityFilterField,
): BankActivityFilterOperator => {
  const valueKind = bankActivityFilterValueKinds[field];
  return valueKind === "text"
    ? "contains"
    : bankActivityFilterOperatorOptions[valueKind][0]!.value;
};

export const resetBankActivityFilterField = (
  clause: BankActivityFilterClause,
  field: BankActivityFilterField,
): BankActivityFilterClause => ({
  ...clause,
  field,
  operator: defaultActivityFilterOperator(field),
  value: bankActivityFilterValueKinds[field] === "enum" ? [] : "",
});

const bankActivityQueryChipFilterFields: QueryChipField[] = (
  Object.keys(bankActivityFilterFieldLabels) as BankActivityFilterField[]
).map((field) => {
  const valueKind = bankActivityFilterValueKinds[field];
  const operators = bankActivityFilterOperatorOptions[valueKind];
  const defaultOperator = defaultActivityFilterOperator(field);

  return {
    value: field,
    label: bankActivityFilterFieldLabels[field],
    valueKind,
    operators: [
      ...operators.filter(({ value }) => value === defaultOperator),
      ...operators.filter(({ value }) => value !== defaultOperator),
    ],
    ...(bankActivityFilterOptions[field]
      ? { options: bankActivityFilterOptions[field] }
      : {}),
  };
});

const bankActivityQueryChipSortFields: readonly {
  value: string;
  label: string;
}[] = (Object.keys(bankActivitySortFieldLabels) as BankActivitySortKey[]).map(
  (field) => ({ value: field, label: bankActivitySortFieldLabels[field] }),
);

export const bankActivityFiltersForSearch = (
  clauses: readonly BankActivityFilterClause[],
): BankActivityFilter[] =>
  clauses.flatMap(({ id: _id, ...clause }) => {
    const value = Array.isArray(clause.value)
      ? [...clause.value]
      : clause.value.trim();
    if (Array.isArray(value) && value.length === 0) return [];
    const parsed = bankActivityFilterSchema.safeParse({
      ...clause,
      value,
    });
    return parsed.success ? [parsed.data] : [];
  });

export const bankActivitySortsForSearch = (
  clauses: readonly BankActivitySortClause[],
): BankActivitySort[] => {
  const parsed = bankActivitySortSchema.safeParse(
    clauses.map(({ id: _id, ...sort }) => sort),
  );
  return parsed.success ? parsed.data : [];
};

const bankActivityBuilderFromLegacySearch = (
  search: Record<string, unknown>,
): BankActivityBuilderClause[] => {
  const filters = Array.isArray(search.filters)
    ? search.filters.slice(0, 20).flatMap((filter) => {
        const parsed = bankActivityFilterSchema.safeParse(filter);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const sort = bankActivitySortSchema
    .catch(defaultBankActivitySort)
    .safeParse(search.sort);

  return [
    ...filters.map((clause) => ({ type: "filter" as const, clause })),
    ...(sort.success ? sort.data : defaultBankActivitySort).map((clause) => ({
      type: "sort" as const,
      clause,
    })),
  ];
};

const bankActivityBuilderForSearch = (
  value: unknown,
): BankActivityBuilderClause[] => {
  if (!Array.isArray(value)) return [];

  const rows = value.slice(0, 25).flatMap((item) => {
    const parsed = bankActivityBuilderClauseSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const result: BankActivityBuilderClause[] = [];
  const sortKeys = new Set<BankActivitySortKey>();
  let filterCount = 0;
  let sortCount = 0;

  for (const row of rows) {
    if (row.type === "filter") {
      if (filterCount >= 20) continue;
      result.push(row);
      filterCount += 1;
      continue;
    }

    if (sortCount >= 5 || sortKeys.has(row.clause.key)) continue;
    result.push(row);
    sortKeys.add(row.clause.key);
    sortCount += 1;
  }

  return result;
};

export const bankActivityBuilderRowsForSearch = (
  clauses: readonly BankActivityBuilderClause[],
): BankActivityBuilderRow[] =>
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

export const bankActivityBuilderForSearchRows = (
  rows: readonly BankActivityBuilderRow[],
): BankActivityBuilderClause[] => {
  const builder: BankActivityBuilderClause[] = [];
  const sortKeys = new Set<BankActivitySortKey>();
  let filterCount = 0;
  let sortCount = 0;

  for (const row of rows) {
    if (row.type === "filter") {
      if (filterCount >= 20) continue;
      const parsed = bankActivityFilterSchema.safeParse({
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

    if (sortCount >= 5 || sortKeys.has(row.clause.key)) continue;
    const parsed = bankActivitySortClauseSchema.safeParse({
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

const bankActivityQueryChipClausesForRows = (
  rows: readonly BankActivityBuilderRow[],
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

const bankActivityBuilderRowsForQueryChipClauses = (
  clauses: readonly QueryChipClause[],
): BankActivityBuilderRow[] =>
  clauses.flatMap<BankActivityBuilderRow>((clause) => {
    if (clause.type === "filter") {
      const parsed = bankActivityFilterSchema.safeParse({
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

    const parsed = bankActivitySortClauseSchema.safeParse({
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

const bankActivityDefaultSortForRows = (
  rows: readonly BankActivityBuilderRow[],
): QueryChipClause[] => {
  const nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  return defaultBankActivitySort.map((clause, index) => ({
    id: nextId + index,
    type: "sort" as const,
    field: clause.key,
    operator: clause.direction,
    value: "",
  }));
};

const bankActivityQueryChipClauseIsValid = (
  clause: QueryChipClause,
  currentClauses: readonly QueryChipClause[],
): boolean =>
  bankActivityBuilderRowsForQueryChipClauses([clause]).length === 1 &&
  (clause.type !== "sort" ||
    !currentClauses.some(
      (current) =>
        current.type === "sort" &&
        current.id !== clause.id &&
        current.field === clause.field,
    ));

export const bankActivityQueryPartsForBuilder = (
  builder: readonly BankActivityBuilderClause[],
) => ({
  filters: builder.flatMap((row) => {
    if (row.type !== "filter") return [];
    return Array.isArray(row.clause.value) && row.clause.value.length === 0
      ? []
      : [row.clause];
  }),
  sort: builder.flatMap((row) => (row.type === "sort" ? [row.clause] : [])),
});

export const moveBankActivityBuilderRow = (
  current: readonly BankActivityBuilderRow[],
  index: number,
  offset: -1 | 1,
): BankActivityBuilderRow[] => {
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

export const bankActivityBuilderWithSorts = (
  builder: readonly BankActivityBuilderClause[],
  sorts: readonly BankActivitySort[],
): BankActivityBuilderClause[] => {
  const currentSortCount = builder.filter((row) => row.type === "sort").length;
  const addedSorts = sorts.slice(
    0,
    Math.max(0, sorts.length - currentSortCount),
  );
  const replacementSorts = sorts.slice(addedSorts.length);
  const next: BankActivityBuilderClause[] = [];
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

export const parseBankActivitySearch = (
  search: Record<string, unknown>,
): BankActivitySearch => {
  const page = Number(search.page ?? 1);
  const builder = Array.isArray(search.builder)
    ? bankActivityBuilderForSearch(search.builder)
    : bankActivityBuilderFromLegacySearch(search);
  return {
    page:
      Number.isInteger(page) && page >= 1 && page <= bankActivityMaxPage
        ? page
        : 1,
    builder,
  };
};

export const bankActivityQueryForPage = (
  page: number,
  filters: BankActivityFilter[] = [],
  sort: BankActivitySort[] = defaultBankActivitySort,
) => ({
  limit: bankActivityFetchLimit,
  offset: (page - 1) * bankActivityPageSize,
  filters,
  sort,
});

export const nextBankActivitySort = (
  current: readonly BankActivitySort[],
  key: BankActivitySortKey,
): BankActivitySort[] => {
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
  return [{ key, direction: "asc" }, ...current.slice(0, 4)];
};

export const moveBankActivitySortClause = (
  current: readonly BankActivitySortClause[],
  index: number,
  offset: -1 | 1,
): BankActivitySortClause[] => {
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

export const bankActivitySortIndicator = (
  sort: readonly BankActivitySort[],
  key: BankActivitySortKey,
): string => {
  const index = sort.findIndex((clause) => clause.key === key);
  if (index < 0) return "";
  return ` ${index + 1}${sort[index]!.direction === "asc" ? "↑" : "↓"}`;
};

export const visibleBankActivityPage = <T,>(rows: readonly T[]) => ({
  rows: rows.slice(0, bankActivityPageSize),
  hasNextPage: rows.length > bankActivityPageSize,
});

export const Route = createFileRoute("/banking/activity")({
  head: () => ({ links: [{ rel: "stylesheet", href: bankingCss }] }),
  validateSearch: parseBankActivitySearch,
  loaderDeps: ({ search }) => ({
    page: search.page,
    ...bankActivityQueryPartsForBuilder(search.builder),
  }),
  loader: ({ deps }) =>
    listBankTransactions({
      data: bankActivityQueryForPage(deps.page, deps.filters, deps.sort),
    }),
  pendingComponent: BankActivityPending,
  errorComponent: BankActivityError,
  component: BankActivityPage,
});

function BankActivityPending() {
  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <h1>Bank activity</h1>
      <p className="banking-route-pending" role="status" aria-live="polite">
        Loading bank activity…
      </p>
    </main>
  );
}

function BankActivityError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };

  return (
    <main className="banking-page banking-route-state">
      <p className="eyebrow">Banking</p>
      <section className="banking-panel banking-route-error">
        <h1>Bank activity unavailable</h1>
        <p role="alert">
          Folio could not load bank activity. Check your access or connection,
          then retry.
        </p>
        <button type="button" onClick={retry}>
          Retry bank activity
        </button>
      </section>
    </main>
  );
}

export const bankActivityAmountDisplay = (amountAud: string) => ({
  text: formatAudDecimal(amountAud),
  className: amountAud.startsWith("-") ? "amount-negative" : "amount-positive",
});

const bankActivityDateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const bankActivityDateDisplay = (postedDate: string): string => {
  const date = new Date(`${postedDate}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? postedDate
    : bankActivityDateFormatter.format(date);
};

function BankActivityPage() {
  const loadedRows = Route.useLoaderData();
  const routeSearch = Route.useSearch();
  const { page, builder } = routeSearch;
  const navigate = useNavigate({ from: "/banking/activity" });
  const builderKey = JSON.stringify(builder);
  const [builderRows, setBuilderRows] = useState<BankActivityBuilderRow[]>(() =>
    bankActivityBuilderRowsForSearch(builder),
  );
  const queryChipClauses = useMemo(
    () => bankActivityQueryChipClausesForRows(builderRows),
    [builderRows],
  );
  const defaultSort = useMemo(
    () => bankActivityDefaultSortForRows(builderRows),
    [builderRows],
  );
  const lastAppliedBuilderDraftRef = useRef(JSON.stringify(builderRows));
  const selfAppliedBuilderKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (selfAppliedBuilderKeyRef.current === builderKey) {
      selfAppliedBuilderKeyRef.current = null;
      return;
    }
    const nextRows = bankActivityBuilderRowsForSearch(builder);
    lastAppliedBuilderDraftRef.current = JSON.stringify(nextRows);
    setBuilderRows(nextRows);
  }, [builderKey]);

  useEffect(() => {
    const draftKey = JSON.stringify(builderRows);
    if (lastAppliedBuilderDraftRef.current === draftKey) return;
    lastAppliedBuilderDraftRef.current = draftKey;
    const timeout = window.setTimeout(() => {
      const nextBuilder = bankActivityBuilderForSearchRows(builderRows);
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

  const updateSearch = (updates: Partial<BankActivitySearch>) => {
    void navigate({ search: (previous) => ({ ...previous, ...updates }) });
  };
  const { rows, hasNextPage } = visibleBankActivityPage(loadedRows);
  const canGoNext = hasNextPage && page < bankActivityMaxPage;
  const { filters, sort } = bankActivityQueryPartsForBuilder(builder);
  const sortHeader = (key: BankActivitySortKey, label: string) => {
    const active = sort.find((clause) => clause.key === key);
    return (
      <th
        scope="col"
        className={key === "amountAud" ? "money-column" : undefined}
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
          className={
            key === "amountAud" ? "sort-button money-column" : "sort-button"
          }
          onClick={() => {
            const currentBuilder =
              bankActivityBuilderForSearchRows(builderRows);
            const nextSort = nextBankActivitySort(
              bankActivityQueryPartsForBuilder(currentBuilder).sort,
              key,
            );
            updateSearch({
              builder: bankActivityBuilderWithSorts(currentBuilder, nextSort),
              page: 1,
            });
          }}
        >
          {label}
          {bankActivitySortIndicator(sort, key)}
        </button>
      </th>
    );
  };

  return (
    <main className="banking-page">
      <header className="banking-header">
        <p className="eyebrow">Banking</p>
        <h1>Banking</h1>
        <p className="banking-lead">
          Review immutable imported bank rows and their current review state.
        </p>
      </header>

      <nav className="banking-tabs" aria-label="Banking sections">
        <a href="/banking/activity" aria-current="page">
          Activity
        </a>
        <a href="/banking/reconcile">Reconcile</a>
        <a href="/banking/imports">Imports</a>
      </nav>

      <section
        className="banking-panel"
        aria-labelledby="bank-activity-heading"
      >
        <div className="banking-panel-heading">
          <div>
            <p className="banking-kicker">Imported source rows</p>
            <h2 id="bank-activity-heading">Bank activity</h2>
            <p className="banking-muted">
              Bank-provided running balances remain source details; Folio does
              not calculate an account balance here.
            </p>
          </div>
          <a className="banking-button-link" href="/imports/commbank">
            Import CommBank CSV
          </a>
        </div>

        <form onSubmit={(event) => event.preventDefault()}>
          <QueryChipBuilder
            label="Bank activity query"
            clauses={queryChipClauses}
            filterFields={bankActivityQueryChipFilterFields}
            sortFields={bankActivityQueryChipSortFields}
            defaultSort={defaultSort}
            onChange={(clauses) =>
              setBuilderRows(
                bankActivityBuilderRowsForQueryChipClauses(clauses),
              )
            }
            isClauseValid={(clause) =>
              bankActivityQueryChipClauseIsValid(clause, queryChipClauses)
            }
            maxFilters={20}
            maxSorts={5}
          />
        </form>

        {rows.length === 0 ? (
          <div className="banking-empty-state">
            <h3>
              {filters.length > 0 && page === 1
                ? "No bank rows match these filters"
                : page === 1
                  ? "No bank activity yet"
                  : "No bank rows on this page"}
            </h3>
            <p>
              {filters.length > 0 && page === 1
                ? "Change or reset the filters to see other bank rows."
                : page === 1
                  ? "Import a CommBank CSV to review its source rows in Folio."
                  : `Page ${page} has no bank rows. The collection may have changed; use Previous to return to available rows.`}
            </p>
            {page === 1 && filters.length === 0 && (
              <a className="banking-button-link" href="/imports/commbank">
                Import a CSV
              </a>
            )}
          </div>
        ) : (
          <div className="banking-table-scroll">
            <table className="banking-table banking-records-table banking-activity-table">
              <thead>
                <tr>
                  {sortHeader("postedDate", "Posted")}
                  {sortHeader("description", "Description")}
                  {sortHeader("amountAud", "Movement")}
                  {sortHeader("reviewState", "Review state")}
                  {sortHeader("matchStatus", "Match")}
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const amount = bankActivityAmountDisplay(row.amountAud);
                  return (
                    <tr key={row.id}>
                      <td data-label="Posted">
                        <time dateTime={row.postedDate}>
                          {bankActivityDateDisplay(row.postedDate)}
                        </time>
                      </td>
                      <td data-label="Description">{row.description}</td>
                      <td
                        data-label="Movement"
                        className={`${amount.className} money-column`}
                      >
                        <MoneyText>{amount.text}</MoneyText>
                      </td>
                      <td data-label="Review state">
                        <span
                          className={`banking-state banking-state-${row.reviewState}`}
                        >
                          {row.reviewState}
                        </span>
                      </td>
                      <td data-label="Match">
                        {row.matchedTransactionId ? (
                          <a
                            href={`/transactions/${encodeURIComponent(row.matchedTransactionId)}`}
                            aria-label={`View matched Folio transaction ${row.matchedTransactionId}`}
                          >
                            View transaction
                          </a>
                        ) : (
                          <span aria-label="No matched transaction">—</span>
                        )}
                      </td>
                      <td data-label="Actions">
                        <TableIconAction
                          icon="review"
                          label="Review row"
                          accessibleLabel={`Review bank row posted ${row.postedDate}`}
                          tooltip="Review row"
                          className="banking-table-action"
                          href={`/banking/reconcile?bank=${encodeURIComponent(row.id)}&window=14`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(page > 1 || rows.length > 0) && (
          <nav className="banking-pagination" aria-label="Bank activity pages">
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
