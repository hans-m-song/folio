import { ZodError } from "zod";
import { AppError } from "../domain/errors";

export const validateRuntimeConfiguration = <Result>(
  load: () => Result,
): Result => {
  try {
    return load();
  } catch (cause) {
    if (!(cause instanceof ZodError)) throw cause;
    throw new AppError({
      code: "CONFIG_INVALID",
      stage: "configuration",
      cause,
    });
  }
};
