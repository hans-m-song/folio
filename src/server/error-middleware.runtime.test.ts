import { createMiddleware, executeMiddleware } from "@tanstack/react-start";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const response = vi.hoisted(() => ({ status: vi.fn(), header: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({
  setResponseStatus: response.status,
  setResponseHeader: response.header,
}));

import { getDefaultSerovalPlugins } from "@tanstack/react-start";
import { publicFailureFrom } from "../domain/public-failure";
import { HandledOperationError } from "./error-handling";
import { serverFailureMiddleware } from "./error-middleware";
import { validateInput } from "./input-validation";

const appRequire = createRequire(import.meta.url);
const reactStartPackage = appRequire.resolve(
  "@tanstack/react-start/package.json",
);
const reactStartRequire = createRequire(reactStartPackage);
const startCorePackage = reactStartRequire.resolve(
  "@tanstack/start-client-core/package.json",
);
const startCoreRequire = createRequire(startCorePackage);
const storagePackage = startCoreRequire.resolve(
  "@tanstack/start-storage-context/package.json",
);
const { runWithStartContext } = await import(
  pathToFileURL(join(dirname(storagePackage), "dist/esm/index.js")).href
);
const seroval = startCoreRequire("seroval");

const startContext = () => ({
  getRouter: async () => ({}),
  request: new Request("https://folio.invalid/_serverFn", { method: "POST" }),
  startOptions: { functionMiddleware: [] },
  contextAfterGlobalMiddlewares: {},
  executedRequestMiddlewares: new Set(),
  handlerType: "serverFn" as const,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("installed TanStack function middleware execution", () => {
  it("sanitizes failures thrown by the framework input validator before handler execution", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const submittedValue = "synthetic-private-value";
    const handler = vi.fn(async () => "handled");
    const validatingMiddleware = createMiddleware({ type: "function" })
      .validator(validateInput(z.object({ amount: z.number() })))
      .server(async ({ next }) => {
        await handler();
        return next();
      });

    const result = await runWithStartContext(startContext(), () =>
      executeMiddleware(
        [serverFailureMiddleware, validatingMiddleware],
        "server",
        {
          method: "POST",
          data: { amount: submittedValue },
          serverFnMeta: { name: "saveManualTransaction" },
        } as never,
      ),
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.error).toBeInstanceOf(HandledOperationError);
    const error = result.error as HandledOperationError;
    expect(error.publicFailure).toMatchObject({
      code: "INPUT_INVALID",
      recovery: "fix_input",
    });
    expect(error.message).toContain(error.publicFailure.reference);
    expect(error.stack).toBeUndefined();
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(submittedValue);
    expect(JSON.stringify(error)).not.toContain("issues");
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.header).toHaveBeenCalledWith(
      "x-folio-error-reference",
      error.publicFailure.reference,
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).not.toContain(submittedValue);

    const { plugins, serialized } = await runWithStartContext(
      startContext(),
      async () => {
        const plugins = getDefaultSerovalPlugins();
        const serialized = await Promise.resolve(
          seroval.toCrossJSONAsync(error, { refs: new Map(), plugins }),
        );
        return { plugins, serialized };
      },
    );
    const serializedText = JSON.stringify(serialized);
    const restored = seroval.fromCrossJSON(JSON.parse(serializedText), {
      plugins,
    }) as Error;
    const decodedFailure = publicFailureFrom(restored);
    expect(restored).toBeInstanceOf(Error);
    expect(restored.message).toContain(error.publicFailure.message);
    expect(restored.message).toContain(error.publicFailure.code);
    expect(restored.message).toContain(error.publicFailure.reference);
    expect(decodedFailure).toMatchObject(error.publicFailure);
    expect(restored.message).not.toContain("synthetic-private-value");
    expect(restored).not.toHaveProperty("publicFailure");
  });

  it("round-trips a handled failure through the installed Seroval plugins without its cause", async () => {
    const reference = "33333333-3333-4333-8333-333333333333";
    const publicMessage =
      "The request could not be completed. Review the input and try again.";
    const error = new HandledOperationError(
      {
        publicFailure: {
          code: "INPUT_INVALID",
          message: publicMessage,
          reference,
          recovery: "fix_input",
        },
        status: 400,
        internalCode: "INPUT_INVALID",
      },
      new Error("synthetic-private-cause"),
    );

    const { plugins, serialized } = await runWithStartContext(
      startContext(),
      async () => {
        const plugins = getDefaultSerovalPlugins();
        const serialized = await Promise.resolve(
          seroval.toCrossJSONAsync(error, { refs: new Map(), plugins }),
        );
        return { plugins, serialized };
      },
    );
    const text = JSON.stringify(serialized);
    const restored = seroval.fromCrossJSON(JSON.parse(text), {
      plugins,
    }) as Error;
    const decodedFailure = publicFailureFrom(restored);

    expect(restored.message).toBe(error.message);
    expect(restored.message).toContain(publicMessage);
    expect(restored.message).toContain("Code INPUT_INVALID.");
    expect(restored.message).toContain(`Reference ${reference}.`);
    expect(decodedFailure).toMatchObject({
      code: "INPUT_INVALID",
      message: publicMessage,
      reference,
      recovery: "fix_input",
    });
    expect(text).not.toContain("synthetic-private-cause");
    expect(restored).not.toHaveProperty("cause");
  });
});
