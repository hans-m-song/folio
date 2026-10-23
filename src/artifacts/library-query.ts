import { z } from "zod";

import { enumFilterSchema } from "../domain/enum-filter";
import { artifactProfileSchema } from "./profiles";

export const artifactPageSize = 25;

export const artifactStateSchema = z.enum([
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

export const artifactFilterSchema = z.union([
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

export const artifactSortSchema = z
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
