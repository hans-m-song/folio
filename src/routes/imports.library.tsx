import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { artifactProfiles, artifactProfileSchema } from "../artifacts/profiles";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import {
  QueryChipBuilder,
  type QueryChipClause,
  type QueryChipField,
} from "../components/query-chip-builder";
import { enumFilterSchema } from "../domain/enum-filter";
import {
  approveArtifact,
  deleteArtifact,
  downloadArtifact,
  listArtifacts,
  previewArtifactForReview,
  rejectArtifact,
} from "../server/operations";
import artifactsCss from "../styles/artifacts.css?url";

export const artifactPageSize = 25;

const artifactStateSchema = z.enum([
  "pending",
  "awaiting_review",
  "available",
  "superseded",
  "abandoned",
  "rejected",
  "deleting",
]);

export type ArtifactFilterField =
  | "filename"
  | "profile"
  | "type"
  | "uploaded"
  | "state"
  | "linkage"
  | "transactions"
  | "bank_activity";

export type ArtifactFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "is"
  | "is_not"
  | "contains_any"
  | "contains_none";

const artifactComparisonOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
]);

const artifactFilterSchema = z.union([
  z
    .object({
      field: z.literal("filename"),
      operator: z.enum(["equals", "not_equals", "contains", "not_contains"]),
      value: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      field: z.literal("uploaded"),
      operator: artifactComparisonOperatorSchema,
      value: z.string().date(),
    })
    .strict(),
  z
    .object({
      field: z.literal("transactions"),
      operator: artifactComparisonOperatorSchema,
      value: z.string().trim().min(1).max(9).regex(/^\d+$/),
    })
    .strict(),
  z
    .object({
      field: z.literal("bank_activity"),
      operator: artifactComparisonOperatorSchema,
      value: z.string().trim().min(1).max(9).regex(/^\d+$/),
    })
    .strict(),
  enumFilterSchema("profile", artifactProfileSchema),
  enumFilterSchema("type", z.enum(["application/pdf", "text/csv"])),
  enumFilterSchema("state", artifactStateSchema),
  enumFilterSchema("linkage", z.enum(["linked", "unlinked"])),
]);

export type ArtifactSearchFilter = z.infer<typeof artifactFilterSchema>;

const artifactSortSchema = z
  .object({
    field: z.enum([
      "filename",
      "profile",
      "type",
      "uploaded",
      "state",
      "transactions",
      "bank_activity",
    ]),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();

export type ArtifactSort = z.infer<typeof artifactSortSchema>;

const artifactQueryClauseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("filter"),
      clause: artifactFilterSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("sort"),
      clause: artifactSortSchema,
    })
    .strict(),
]);

export type ArtifactQueryClause = z.infer<typeof artifactQueryClauseSchema>;

const artifactQueryClausesSchema = z
  .array(artifactQueryClauseSchema)
  .max(27)
  .superRefine((clauses, context) => {
    const filterCount = clauses.filter(({ kind }) => kind === "filter").length;
    const sortCount = clauses.filter(({ kind }) => kind === "sort").length;

    if (filterCount > 20)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At most 20 filter clauses are allowed.",
      });
    if (sortCount > 7)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At most 7 sort clauses are allowed.",
      });
  });

const artifactQueryClausesSearchSchema = z.unknown().transform((input) => {
  const parsed = artifactQueryClausesSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
});

export const defaultArtifactSort: ArtifactSort[] = [
  { field: "uploaded", direction: "desc" },
];

export const defaultArtifactQueryClauses: ArtifactQueryClause[] =
  defaultArtifactSort.map((clause) => ({ kind: "sort", clause }));

const artifactSearchSchema = z
  .object({
    filters: z.array(artifactFilterSchema).max(20).catch([]).optional(),
    sort: z
      .array(artifactSortSchema)
      .max(7)
      .catch(defaultArtifactSort)
      .optional(),
    clauses: artifactQueryClausesSearchSchema.optional(),
    filename: z.string().trim().max(200).catch("").optional(),
    profile: z
      .union([z.literal("all"), artifactProfileSchema])
      .catch("all")
      .optional(),
    from: z.string().date().catch("").optional(),
    to: z.string().date().catch("").optional(),
    state: z
      .union([z.literal("all"), artifactStateSchema])
      .catch("all")
      .optional(),
    linkage: z.enum(["all", "linked", "unlinked"]).catch("all").optional(),
    page: z.coerce.number().int().min(1).max(4_001).catch(1),
  })
  .transform(
    ({
      filters,
      sort,
      clauses,
      filename,
      profile,
      from,
      to,
      state,
      linkage,
      page,
    }) => {
      const legacyFilters: ArtifactSearchFilter[] = [];
      if (filename)
        legacyFilters.push({
          field: "filename",
          operator: "contains",
          value: filename,
        });
      if (profile && profile !== "all")
        legacyFilters.push({
          field: "profile",
          operator: "is",
          value: profile,
        });
      if (from)
        legacyFilters.push({
          field: "uploaded",
          operator: "greater_than_or_equal",
          value: from,
        });
      if (to)
        legacyFilters.push({
          field: "uploaded",
          operator: "less_than_or_equal",
          value: to,
        });
      if (state && state !== "all")
        legacyFilters.push({ field: "state", operator: "is", value: state });
      if (linkage && linkage !== "all")
        legacyFilters.push({
          field: "linkage",
          operator: "is",
          value: linkage,
        });

      const resolvedFilters = filters ?? legacyFilters;
      const resolvedSort = sort ?? defaultArtifactSort;
      const resolvedClauses = clauses ?? [
        ...resolvedFilters.map((clause) => ({
          kind: "filter" as const,
          clause,
        })),
        ...resolvedSort.map((clause) => ({ kind: "sort" as const, clause })),
      ];

      return {
        clauses: resolvedClauses,
        filters:
          clauses === undefined
            ? resolvedFilters
            : resolvedClauses.flatMap((item) =>
                item.kind === "filter" ? [item.clause] : [],
              ),
        sort:
          clauses === undefined
            ? resolvedSort
            : resolvedClauses.flatMap((item) =>
                item.kind === "sort" ? [item.clause] : [],
              ),
        page,
      };
    },
  );

export type ArtifactSearch = z.infer<typeof artifactSearchSchema>;

export const validateArtifactSearch = (
  search: Record<string, unknown>,
): ArtifactSearch => artifactSearchSchema.parse(search);

export const artifactListInput = (search: ArtifactSearch) => ({
  filters: search.filters,
  sort: search.sort,
  limit: artifactPageSize,
  offset: (search.page - 1) * artifactPageSize,
});

export type ArtifactFilterDraft = {
  id: number;
  field: ArtifactFilterField;
  operator: ArtifactFilterOperator;
  value: string | string[];
};

export type ArtifactSortDraft = ArtifactSort & { id: number };

export type ArtifactQueryDraft =
  | ({ kind: "filter" } & ArtifactFilterDraft)
  | ({ kind: "sort" } & ArtifactSortDraft);

export const artifactFilterFieldLabels: Record<ArtifactFilterField, string> = {
  filename: "Filename",
  profile: "Profile",
  type: "Type",
  uploaded: "Uploaded date (UTC)",
  state: "State",
  linkage: "Linkage",
  transactions: "Transactions linked",
  bank_activity: "Bank activity rows linked",
};

type ArtifactFilterValueKind = "text" | "date" | "number" | "enum";

export const artifactFilterValueKinds: Record<
  ArtifactFilterField,
  ArtifactFilterValueKind
> = {
  filename: "text",
  profile: "enum",
  type: "enum",
  uploaded: "date",
  state: "enum",
  linkage: "enum",
  transactions: "number",
  bank_activity: "number",
};

export const artifactFilterOperatorOptions: Record<
  ArtifactFilterValueKind,
  readonly { value: ArtifactFilterOperator; label: string }[]
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

const defaultArtifactFilterOperator = (
  field: ArtifactFilterField,
): ArtifactFilterOperator => {
  const valueKind = artifactFilterValueKinds[field];
  return valueKind === "text"
    ? "contains"
    : artifactFilterOperatorOptions[valueKind][0]!.value;
};

export const resetArtifactFilterField = (
  clause: ArtifactFilterDraft,
  field: ArtifactFilterField,
): ArtifactFilterDraft => ({
  ...clause,
  field,
  operator: defaultArtifactFilterOperator(field),
  value: artifactFilterValueKinds[field] === "enum" ? [] : "",
});

export const artifactFiltersForPage = (
  clauses: readonly ArtifactFilterDraft[],
): ArtifactSearch["filters"] =>
  clauses.flatMap((clause) => {
    const parsed = artifactFilterSchema.safeParse({
      field: clause.field,
      operator: clause.operator,
      value: Array.isArray(clause.value) ? clause.value : clause.value.trim(),
    });
    return parsed.success ? [parsed.data] : [];
  });

export const artifactSortsForPage = (
  clauses: readonly ArtifactSortDraft[],
): ArtifactSearch["sort"] =>
  clauses.flatMap((clause) => {
    const parsed = artifactSortSchema.safeParse({
      field: clause.field,
      direction: clause.direction,
    });
    return parsed.success ? [parsed.data] : [];
  });

export const artifactQueryDraftsFromClauses = (
  clauses: readonly ArtifactQueryClause[],
): ArtifactQueryDraft[] =>
  clauses.map((item, index) =>
    item.kind === "filter"
      ? { kind: "filter", ...item.clause, id: index + 1 }
      : { kind: "sort", ...item.clause, id: index + 1 },
  );

const artifactQueryChipsFromDrafts = (
  drafts: readonly ArtifactQueryDraft[],
): QueryChipClause[] =>
  drafts.map((draft) =>
    draft.kind === "filter"
      ? {
          id: draft.id,
          type: "filter",
          field: draft.field,
          operator: draft.operator,
          value: draft.value,
        }
      : {
          id: draft.id,
          type: "sort",
          field: draft.field,
          operator: draft.direction,
          value: "",
        },
  );

const artifactQueryDraftsFromChips = (
  clauses: readonly QueryChipClause[],
): ArtifactQueryDraft[] =>
  clauses.map((clause) =>
    clause.type === "filter"
      ? {
          id: clause.id,
          kind: "filter",
          field: clause.field as ArtifactFilterField,
          operator: clause.operator as ArtifactFilterOperator,
          value: clause.value,
        }
      : {
          id: clause.id,
          kind: "sort",
          field: clause.field as ArtifactSort["field"],
          direction: clause.operator as ArtifactSort["direction"],
        },
  );

const isArtifactQueryChipClauseValid = (clause: QueryChipClause): boolean => {
  const parsed =
    clause.type === "filter"
      ? artifactFilterSchema.safeParse({
          field: clause.field,
          operator: clause.operator,
          value: Array.isArray(clause.value)
            ? clause.value
            : clause.value.trim(),
        })
      : artifactSortSchema.safeParse({
          field: clause.field,
          direction: clause.operator,
        });

  return parsed.success;
};

const defaultArtifactQueryChipSort: readonly QueryChipClause[] = [
  { id: 0, type: "sort", field: "uploaded", operator: "desc", value: "" },
];

export const artifactQueryClausesForPage = (
  drafts: readonly ArtifactQueryDraft[],
): ArtifactSearch["clauses"] => {
  const clauses: ArtifactSearch["clauses"] = [];
  for (const draft of drafts) {
    if (draft.kind === "filter") {
      const [clause] = artifactFiltersForPage([draft]);
      if (clause) clauses.push({ kind: "filter", clause });
      continue;
    }

    const [clause] = artifactSortsForPage([draft]);
    if (clause) clauses.push({ kind: "sort", clause });
  }
  return clauses;
};

export const artifactSortFieldLabels: Record<ArtifactSort["field"], string> = {
  filename: "Filename",
  profile: "Profile",
  type: "Type",
  uploaded: "Uploaded date",
  state: "State",
  transactions: "Transactions linked",
  bank_activity: "Bank activity rows linked",
};

const artifactFilterOptions: Partial<
  Record<ArtifactFilterField, readonly { value: string; label: string }[]>
> = {
  profile: artifactProfiles.map(({ profile, label }) => ({
    value: profile,
    label,
  })),
  type: [
    { value: "application/pdf", label: "PDF" },
    { value: "text/csv", label: "CSV" },
  ],
  state: [
    { value: "pending", label: "Pending" },
    { value: "awaiting_review", label: "Awaiting review" },
    { value: "available", label: "Available" },
    { value: "superseded", label: "Superseded" },
    { value: "abandoned", label: "Abandoned" },
    { value: "rejected", label: "Rejected" },
    { value: "deleting", label: "Deleting" },
  ],
  linkage: [
    { value: "linked", label: "Linked" },
    { value: "unlinked", label: "Unlinked" },
  ],
};

const artifactSortFields = Object.keys(
  artifactSortFieldLabels,
) as ArtifactSort["field"][];

const artifactQueryFilterFields: QueryChipField[] = (
  Object.keys(artifactFilterFieldLabels) as ArtifactFilterField[]
).map((field) => ({
  value: field,
  label: artifactFilterFieldLabels[field],
  valueKind: artifactFilterValueKinds[field],
  operators: artifactFilterOperatorOptions[artifactFilterValueKinds[field]],
  options: artifactFilterOptions[field] ?? [],
}));

const artifactQuerySortFields = artifactSortFields.map((field) => ({
  value: field,
  label: artifactSortFieldLabels[field],
}));

export const artifactPagination = (total: number, requestedPage: number) => {
  const pageCount = Math.max(
    1,
    Math.ceil(Math.max(0, total) / artifactPageSize),
  );
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return {
    page,
    pageCount,
    start: total === 0 ? 0 : (page - 1) * artifactPageSize + 1,
    end: Math.min(page * artifactPageSize, total),
  };
};

export const isArtifactDownloadable = (state: string): boolean =>
  state === "available";

export const isArtifactReviewablePdf = (artifact: {
  state: string;
  mediaType: string;
}): boolean =>
  artifact.state === "awaiting_review" &&
  artifact.mediaType === "application/pdf";

export const isArtifactDeletable = (artifact: {
  transactionCount: number;
  bankRowCount: number;
}): boolean => artifact.transactionCount === 0 && artifact.bankRowCount === 0;

export const copyArtifactId = async (
  id: string,
  writeText: ((value: string) => Promise<void>) | undefined,
): Promise<"copied" | "failed"> => {
  if (!writeText) return "failed";
  try {
    await writeText(id);
    return "copied";
  } catch {
    return "failed";
  }
};

const loadArtifactPage = async (search: ArtifactSearch) => {
  try {
    const input = artifactListInput(search);
    let result = await listArtifacts({ data: input });
    let pagination = artifactPagination(result.total, search.page);

    if (pagination.page !== search.page) {
      result = await listArtifacts({
        data: {
          ...input,
          offset: (pagination.page - 1) * artifactPageSize,
        },
      });
      pagination = artifactPagination(result.total, pagination.page);
    }

    return { status: "loaded" as const, result, pagination };
  } catch {
    return { status: "error" as const };
  }
};

export const Route = createFileRoute("/imports/library")({
  validateSearch: validateArtifactSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadArtifactPage(deps),
  head: () => ({ links: [{ rel: "stylesheet", href: artifactsCss }] }),
  pendingComponent: ArtifactsPending,
  component: ArtifactLibraryPage,
});

function ArtifactLibraryPage() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: "/imports/library" });
  const router = useRouter();
  const [actionMessage, setActionMessage] = useState<{
    text: string;
    tone: "status" | "error";
  } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [reviewActivity, setReviewActivity] = useState<{
    id: string;
    action: "preview" | "approve" | "reject";
  } | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(
    null,
  );
  const [deletingArtifact, setDeletingArtifact] =
    useState<ArtifactListRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [queryClauses, setQueryClauses] = useState<ArtifactQueryDraft[]>(() =>
    artifactQueryDraftsFromClauses(search.clauses),
  );
  const lastAppliedQueryDraftRef = useRef(JSON.stringify(queryClauses));
  const selfAppliedQueryKeyRef = useRef<string | null>(null);
  const appliedQueryKey = JSON.stringify(search.clauses);

  useEffect(() => {
    if (data.status !== "loaded" || data.pagination.page === search.page)
      return;
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, page: data.pagination.page }),
    });
  }, [data, navigate, search.page]);

  useEffect(() => {
    if (selfAppliedQueryKeyRef.current === appliedQueryKey) {
      selfAppliedQueryKeyRef.current = null;
      return;
    }
    const nextClauses = artifactQueryDraftsFromClauses(search.clauses);
    lastAppliedQueryDraftRef.current = JSON.stringify(nextClauses);
    setQueryClauses(nextClauses);
  }, [appliedQueryKey, search.clauses]);

  useEffect(() => {
    const draftKey = JSON.stringify(queryClauses);
    if (lastAppliedQueryDraftRef.current === draftKey) return;
    lastAppliedQueryDraftRef.current = draftKey;
    const timeout = window.setTimeout(() => {
      const clauses = artifactQueryClausesForPage(queryClauses);
      const nextKey = JSON.stringify(clauses);
      if (nextKey === appliedQueryKey) return;
      selfAppliedQueryKeyRef.current = nextKey;
      setPreview(null);
      void navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          clauses,
          filters: clauses.flatMap((item) =>
            item.kind === "filter" ? [item.clause] : [],
          ),
          sort: clauses.flatMap((item) =>
            item.kind === "sort" ? [item.clause] : [],
          ),
          page: 1,
        }),
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [queryClauses, appliedQueryKey, navigate]);

  const goToPage = (page: number) => {
    setPreview(null);
    void navigate({ search: (previous) => ({ ...previous, page }) });
  };

  const handlePreview = async (artifact: ArtifactListRow) => {
    if (!isArtifactReviewablePdf(artifact) || reviewActivity) return;
    setReviewActivity({ id: artifact.id, action: "preview" });
    setPreview(null);
    setActionMessage({
      text: `Preparing the verified PDF preview for ${artifact.filename}…`,
      tone: "status",
    });
    try {
      const url = await previewArtifactForReview({
        data: { id: artifact.id },
      });
      setPreview({ id: artifact.id, url });
      setActionMessage({
        text: `Pinned PDF preview ready for ${artifact.filename}. Open it in a new tab to review.`,
        tone: "status",
      });
    } catch {
      setActionMessage({
        text: `Preview could not be prepared for ${artifact.filename}. It remains awaiting review; try again.`,
        tone: "error",
      });
    } finally {
      setReviewActivity(null);
    }
  };

  const handleReviewDecision = async (
    artifact: ArtifactListRow,
    action: "approve" | "reject",
  ) => {
    if (
      !isArtifactReviewablePdf(artifact) ||
      reviewActivity ||
      (action === "approve" && preview?.id !== artifact.id)
    )
      return;
    setReviewActivity({ id: artifact.id, action });
    setPreview(null);
    setActionMessage({
      text: `${action === "approve" ? "Approving" : "Rejecting"} ${artifact.filename}…`,
      tone: "status",
    });

    try {
      if (action === "approve")
        await approveArtifact({ data: { id: artifact.id } });
      else await rejectArtifact({ data: { id: artifact.id } });
    } catch {
      setActionMessage({
        text: `Could not confirm the ${action} action for ${artifact.filename}. Refresh the file library to check its state before retrying.`,
        tone: "error",
      });
      await router.invalidate().catch(() => undefined);
      return;
    } finally {
      setReviewActivity(null);
    }

    setActionMessage({
      text:
        action === "approve"
          ? `${artifact.filename} approved and available as evidence.`
          : `${artifact.filename} rejected. It is not available as evidence.`,
      tone: "status",
    });
    await router.invalidate().catch(() => {
      setActionMessage({
        text: `${artifact.filename} was ${action === "approve" ? "approved" : "rejected"}, but the file library could not refresh. Reload the page to see its current state.`,
        tone: "error",
      });
    });
  };

  const handleDownload = async (artifact: ArtifactListRow) => {
    if (!isArtifactDownloadable(artifact.state)) return;
    setActionMessage(null);
    setDownloadingId(artifact.id);
    try {
      const url = await downloadArtifact({ data: { id: artifact.id } });
      window.location.assign(url);
    } catch {
      setActionMessage({
        text: `Download could not be prepared for ${artifact.filename}. Try again.`,
        tone: "error",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCopy = async (artifact: ArtifactListRow) => {
    const result = await copyArtifactId(
      artifact.id,
      navigator.clipboard?.writeText.bind(navigator.clipboard),
    );
    setActionMessage(
      result === "copied"
        ? {
            text: `Artifact ID copied for ${artifact.filename}.`,
            tone: "status",
          }
        : {
            text: `Could not copy ${artifact.id}. Select and copy it manually.`,
            tone: "error",
          },
    );
  };

  const handleDelete = async () => {
    if (!deletingArtifact || !isArtifactDeletable(deletingArtifact)) return;
    const target = deletingArtifact;
    setDeletePending(true);
    setActionMessage({
      text: `Deleting ${target.filename}…`,
      tone: "status",
    });
    try {
      await deleteArtifact({ data: { id: target.id } });
    } catch {
      setActionMessage({
        text: `Deletion failed for ${target.filename}. It remains listed so you can retry when storage is available.`,
        tone: "error",
      });
      setDeletingArtifact(null);
      await router.invalidate().catch(() => undefined);
      return;
    } finally {
      setDeletePending(false);
    }

    setActionMessage({
      text: `Artifact ${target.filename} deleted.`,
      tone: "status",
    });
    setDeletingArtifact(null);
    await router.invalidate().catch(() => {
      setActionMessage({
        text: `Artifact ${target.filename} was deleted, but the list could not be refreshed. Reload the page to see its current state.`,
        tone: "error",
      });
    });
  };

  const hasFilters = search.filters.length > 0;

  return (
    <main className="artifact-library-page">
      <header className="artifact-library-header">
        <p className="eyebrow">Source files</p>
        <h1>File library</h1>
        <p className="artifact-library-lead">
          Browse uploaded files and their links to transactions or bank
          activity. PDFs awaiting review are not available as evidence until
          approved. Preview is required to enable approval, but Folio cannot
          confirm that the PDF was read.
        </p>
      </header>

      <section
        className="artifact-library-panel"
        aria-labelledby="artifact-library-heading"
      >
        <div className="artifact-library-panel-heading">
          <div>
            <p className="artifact-library-kicker">Library</p>
            <h2 id="artifact-library-heading">Uploaded artifacts</h2>
            {data.status === "loaded" && (
              <p className="artifact-library-total" aria-live="polite">
                {data.result.total.toLocaleString("en-AU")} artifact
                {data.result.total === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>

        <div className="artifact-library-query">
          <QueryChipBuilder
            label="Filters and sorting"
            clauses={artifactQueryChipsFromDrafts(queryClauses)}
            filterFields={artifactQueryFilterFields}
            sortFields={artifactQuerySortFields}
            onChange={(clauses) =>
              setQueryClauses(artifactQueryDraftsFromChips(clauses))
            }
            defaultSort={defaultArtifactQueryChipSort}
            isClauseValid={isArtifactQueryChipClauseValid}
            maxFilters={20}
            maxSorts={7}
          />
          <div className="artifact-library-filter-actions">
            <a href="/imports/library">Clear query</a>
          </div>
        </div>

        {actionMessage && (
          <p
            className={`artifact-library-action-message${actionMessage.tone === "error" ? "artifact-library-action-message--error" : ""}`}
            role={actionMessage.tone === "error" ? "alert" : "status"}
          >
            {actionMessage.text}
          </p>
        )}

        {data.status === "error" ? (
          <div className="artifact-library-error" role="alert">
            <h3>Artifacts could not be loaded</h3>
            <p>Retry the request. Your filters remain in the address bar.</p>
            <button type="button" onClick={() => void router.invalidate()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {data.result.rows.length === 0 ? (
              <div className="artifact-library-empty" role="status">
                <h3>
                  {hasFilters ? "No matching artifacts" : "No artifacts yet"}
                </h3>
                <p>
                  {hasFilters
                    ? "Change or clear the filters to see other source files."
                    : "Uploaded invoice evidence, imports, and statements will appear here."}
                </p>
                {hasFilters && <a href="/imports/library">Clear filters</a>}
              </div>
            ) : (
              <div className="artifact-library-scroll">
                <table className="artifact-library-table">
                  <caption className="artifact-library-sr-only">
                    Uploaded artifacts and their relationships
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Filename</th>
                      <th scope="col">Profile</th>
                      <th scope="col">Type</th>
                      <th scope="col">Uploaded (UTC)</th>
                      <th scope="col">State</th>
                      <th scope="col">Linked records</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.result.rows.map((artifact) => (
                      <tr key={artifact.id}>
                        <td data-label="Filename">
                          <span className="artifact-library-filename">
                            {artifact.filename}
                          </span>
                        </td>
                        <td data-label="Profile">
                          {artifactProfileLabel(artifact.artifactProfile)}
                        </td>
                        <td data-label="Type">
                          {artifactTypeLabel(artifact.mediaType)}
                        </td>
                        <td data-label="Uploaded (UTC)">
                          <time dateTime={artifact.createdAt}>
                            {formatArtifactDate(artifact.createdAt)}
                          </time>
                        </td>
                        <td data-label="State">
                          <span
                            className={`artifact-library-state artifact-library-state--${artifactStateClass(artifact.state)}`}
                          >
                            {artifactStateLabel(artifact.state)}
                          </span>
                        </td>
                        <td data-label="Linked records">
                          <dl className="artifact-library-links">
                            <div>
                              <dt>Transactions</dt>
                              <dd>{artifact.transactionCount}</dd>
                            </div>
                            <div>
                              <dt>Bank activity rows</dt>
                              <dd>{artifact.bankRowCount}</dd>
                            </div>
                          </dl>
                        </td>
                        <td data-label="Actions">
                          <div className="artifact-library-actions">
                            {isArtifactReviewablePdf(artifact) && (
                              <>
                                <button
                                  type="button"
                                  className="artifact-library-action"
                                  aria-label={`Preview ${artifact.filename}`}
                                  disabled={reviewActivity !== null}
                                  onClick={() => void handlePreview(artifact)}
                                >
                                  {reviewActivity?.id === artifact.id &&
                                  reviewActivity.action === "preview"
                                    ? "Preparing…"
                                    : "Preview"}
                                </button>
                                {preview?.id === artifact.id && (
                                  <a
                                    className="artifact-library-action"
                                    href={preview.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open PDF preview for ${artifact.filename}`}
                                  >
                                    Open preview
                                  </a>
                                )}
                                {preview?.id !== artifact.id && (
                                  <span className="artifact-library-review-hint">
                                    Preview before approval
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className="artifact-library-action"
                                  aria-label={`Approve ${artifact.filename}`}
                                  disabled={
                                    reviewActivity !== null ||
                                    preview?.id !== artifact.id
                                  }
                                  onClick={() =>
                                    void handleReviewDecision(
                                      artifact,
                                      "approve",
                                    )
                                  }
                                >
                                  {reviewActivity?.id === artifact.id &&
                                  reviewActivity.action === "approve"
                                    ? "Approving…"
                                    : "Approve"}
                                </button>
                                <button
                                  type="button"
                                  className="artifact-library-action artifact-library-action--danger"
                                  aria-label={`Reject ${artifact.filename}`}
                                  disabled={reviewActivity !== null}
                                  onClick={() =>
                                    void handleReviewDecision(
                                      artifact,
                                      "reject",
                                    )
                                  }
                                >
                                  {reviewActivity?.id === artifact.id &&
                                  reviewActivity.action === "reject"
                                    ? "Rejecting…"
                                    : "Reject"}
                                </button>
                              </>
                            )}
                            {isArtifactDownloadable(artifact.state) ? (
                              <button
                                type="button"
                                className="artifact-library-action"
                                aria-label={`Download ${artifact.filename}`}
                                disabled={downloadingId === artifact.id}
                                onClick={() => void handleDownload(artifact)}
                              >
                                {downloadingId === artifact.id
                                  ? "Preparing…"
                                  : "Download"}
                              </button>
                            ) : (
                              <span className="artifact-library-unavailable">
                                Download unavailable
                              </span>
                            )}
                            <button
                              type="button"
                              className="artifact-library-action"
                              aria-label={`Copy artifact ID for ${artifact.filename}`}
                              onClick={() => void handleCopy(artifact)}
                            >
                              Copy ID
                            </button>
                            {isArtifactDeletable(artifact) && (
                              <button
                                type="button"
                                className="artifact-library-action artifact-library-action--danger"
                                aria-label={`${artifact.state === "deleting" ? "Retry deletion of" : "Delete artifact"} ${artifact.filename}`}
                                disabled={
                                  deletePending &&
                                  deletingArtifact?.id === artifact.id
                                }
                                onClick={() => {
                                  setDeletingArtifact(artifact);
                                }}
                              >
                                {deletePending &&
                                deletingArtifact?.id === artifact.id
                                  ? "Deleting…"
                                  : artifact.state === "deleting"
                                    ? "Retry deletion"
                                    : "Delete"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <nav
              className="artifact-library-pagination"
              aria-label="Artifact pagination"
            >
              <p aria-live="polite">
                Showing {data.pagination.start}–{data.pagination.end} of{" "}
                {data.result.total.toLocaleString("en-AU")} artifacts · Page{" "}
                {data.pagination.page} of {data.pagination.pageCount}
              </p>
              <div>
                <button
                  type="button"
                  className="secondary"
                  aria-label="Previous artifacts page"
                  disabled={data.pagination.page <= 1}
                  onClick={() => goToPage(data.pagination.page - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label="Next artifacts page"
                  disabled={data.pagination.page >= data.pagination.pageCount}
                  onClick={() => goToPage(data.pagination.page + 1)}
                >
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </section>
      {deletingArtifact && (
        <ConfirmationDialog
          title="Permanently delete artifact?"
          description={`Delete ${deletingArtifact.filename} and its stored file versions? This cannot be undone. No linked records will be removed. If an upload is still in progress, it may finish after deletion and leave an untracked file.`}
          confirmLabel="Delete permanently"
          pending={deletePending}
          onCancel={() => setDeletingArtifact(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </main>
  );
}

type ArtifactListRow = Awaited<
  ReturnType<typeof listArtifacts>
>["rows"][number];

const artifactProfileLabel = (profile: string): string =>
  artifactProfiles.find((definition) => definition.profile === profile)
    ?.label ?? "Unknown profile";

const artifactTypeLabel = (mediaType: string): string => {
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType === "text/csv") return "CSV";
  return mediaType || "Unknown";
};

const artifactStateLabel = (state: string): string => {
  if (state === "pending") return "Pending";
  if (state === "awaiting_review") return "Awaiting review";
  if (state === "available") return "Available";
  if (state === "superseded") return "Superseded";
  if (state === "abandoned") return "Abandoned";
  if (state === "rejected") return "Rejected";
  if (state === "deleting") return "Deleting";
  return "Unknown";
};

const artifactStateClass = (state: string): string =>
  artifactStateSchema.safeParse(state).success ? state : "unknown";

const formatArtifactDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

function ArtifactsPending() {
  return (
    <main className="artifact-library-page">
      <p className="artifact-library-pending" role="status">
        Loading artifacts…
      </p>
    </main>
  );
}
