import type { z } from "zod";
import { parseWithDiagnostics } from "../domain/validation-diagnostics";

export const validateInput =
  <Schema extends z.ZodType>(schema: Schema) =>
  (value: z.input<Schema>): z.output<Schema> =>
    parseWithDiagnostics(schema, value);
