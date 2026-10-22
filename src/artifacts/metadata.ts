import { z } from "zod";

const hasForbiddenFilenameCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      character === "/" ||
      character === "\\" ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    );
  });

const filenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .transform((value) => value.normalize("NFC"))
  .refine(
    (value) =>
      value !== "." && value !== ".." && !hasForbiddenFilenameCharacter(value),
    "Filename must be a single file name without control characters",
  );

const isoDateSchema = z.string().date();

const optionalText = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));

export const artifactMetadataFieldsSchema = z
  .object({
    filename: filenameSchema,
    originalFilename: z.string().max(255).nullable().optional(),
    periodStart: isoDateSchema.nullable().optional(),
    periodEnd: isoDateSchema.nullable().optional(),
    documentDate: isoDateSchema.nullable().optional(),
    reference: optionalText(200),
    notes: optionalText(2000),
    supplier: optionalText(200),
  })
  .strict();

export const validateArtifactMetadataPeriod = (
  value: Pick<
    z.input<typeof artifactMetadataFieldsSchema>,
    "periodStart" | "periodEnd"
  >,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
): void => {
  if (
    value.periodStart &&
    value.periodEnd &&
    value.periodStart > value.periodEnd
  )
    context.addIssue({
      code: "custom",
      path: [...path, "periodEnd"],
      message: "Period end must be on or after period start",
    });
};

export const artifactMetadataSchema = artifactMetadataFieldsSchema.superRefine(
  validateArtifactMetadataPeriod,
);

const artifactMetadataEditRangeSchema = z
  .object({
    filename: filenameSchema,
    periodStart: isoDateSchema.nullable(),
    periodEnd: isoDateSchema.nullable(),
  })
  .strict();

export const artifactMetadataEditSchema = z
  .object({
    id: z.string().uuid(),
    ...artifactMetadataEditRangeSchema.shape,
    expected: artifactMetadataEditRangeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateArtifactMetadataPeriod(value, context);
    validateArtifactMetadataPeriod(value.expected, context, ["expected"]);
  });

export type ArtifactMetadataInput = z.input<typeof artifactMetadataSchema>;
export type ArtifactMetadata = z.output<typeof artifactMetadataSchema>;
export type ArtifactMetadataEditInput = z.input<
  typeof artifactMetadataEditSchema
>;
export type ArtifactMetadataEdit = z.output<typeof artifactMetadataEditSchema>;
