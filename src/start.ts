import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

import {
  requestFailureMiddleware,
  serverFailureMiddleware,
} from "./server/error-middleware";

export const startInstance = createStart(() => ({
  requestMiddleware: [
    requestFailureMiddleware,
    createCsrfMiddleware({
      filter: (context) => context.handlerType === "serverFn",
    }),
  ],
  functionMiddleware: [serverFailureMiddleware],
}));
