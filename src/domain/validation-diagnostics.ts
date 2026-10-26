import { z } from "zod";

const schemas = new WeakMap<z.ZodError, z.ZodType>();

export const rememberValidationSchema = (
  error: z.ZodError,
  schema: z.ZodType,
): void => {
  const pending = [error];
  const seen = new Set<z.ZodError>();
  for (let index = 0; index < pending.length && index < 100; index++) {
    const current = pending[index];
    if (seen.has(current)) continue;
    seen.add(current);
    schemas.set(current, schema);
    try {
      for (const issue of current.issues.slice(0, 50)) {
        if (issue.code === "invalid_union")
          pending.push(...issue.unionErrors.slice(0, 50));
      }
    } catch {
      return;
    }
  }
};

export const parseWithDiagnostics = <Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> => {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) rememberValidationSchema(error, schema);
    throw error;
  }
};

const expand = (schema: z.ZodType, depth = 0): z.ZodType[] => {
  if (depth > 20) return [];
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodBranded
  )
    return expand(schema.unwrap(), depth + 1);
  if (schema instanceof z.ZodDefault)
    return expand(schema.removeDefault(), depth + 1);
  if (schema instanceof z.ZodEffects)
    return expand(schema.innerType(), depth + 1);
  if (schema instanceof z.ZodLazy) return expand(schema.schema, depth + 1);
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion)
    return schema.options
      .slice(0, 50)
      .flatMap((option: z.ZodType) => expand(option, depth + 1));
  if (schema instanceof z.ZodIntersection)
    return [schema._def.left, schema._def.right].flatMap((option) =>
      expand(option, depth + 1),
    );
  return [schema];
};

export const diagnosticValidationPath = (
  error: z.ZodError,
  path: (string | number)[],
): (string | number)[] => {
  const root = schemas.get(error);
  let candidates = root ? expand(root) : [];
  return path.slice(0, 50).map((part) => {
    let trusted = typeof part === "number";
    const next: z.ZodType[] = [];
    for (const schema of candidates.slice(0, 50)) {
      if (
        schema instanceof z.ZodObject &&
        typeof part === "string" &&
        Object.hasOwn(schema.shape, part)
      ) {
        trusted = true;
        next.push(schema.shape[part]);
      } else if (schema instanceof z.ZodArray && typeof part === "number") {
        next.push(schema.element);
      } else if (schema instanceof z.ZodRecord) {
        next.push(schema.valueSchema);
      }
    }
    candidates = next.flatMap((schema) => expand(schema)).slice(0, 50);
    return trusted ? part : "[REDACTED_KEY]";
  });
};
