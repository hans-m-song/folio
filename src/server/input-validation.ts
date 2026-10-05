import type { z } from "zod";

export const validateInput =
  <Schema extends z.ZodType>(schema: Schema) =>
  (value: z.input<Schema>): z.output<Schema> =>
    schema.parse(value);
