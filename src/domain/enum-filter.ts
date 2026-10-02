import { z } from "zod";

export const enumFilterSchema = <Field extends string>(
  field: Field,
  valueSchema: z.ZodType<string>,
) =>
  z.union([
    z
      .object({
        field: z.literal(field),
        operator: z.enum(["is", "is_not"]),
        value: valueSchema,
      })
      .strict(),
    z
      .object({
        field: z.literal(field),
        operator: z.enum(["contains_any", "contains_none"]),
        value: z
          .array(valueSchema)
          .min(1)
          .max(20)
          .transform((values) => [...new Set(values)]),
      })
      .strict(),
  ]);
