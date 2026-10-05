import { MCP_MAX_REQUEST_BODY_BYTES } from "./server";
import { AppError } from "../domain/errors";
import { reportServerFailure } from "../server/error-handling";

type LogWriter = (message: string) => void;

type RequestLogOptions = Readonly<{
  logSuccess?: boolean;
  info?: LogWriter;
  warn?: LogWriter;
  error?: LogWriter;
}>;

const knownMcpMethods = new Set([
  "server/discover",
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call",
]);

const knownMcpTools = new Set([
  "folio_ping",
  "list_unresolved_bank_rows",
  "search_transactions",
  "list_artifacts",
  "begin_artifact_upload",
  "confirm_artifact_upload",
  "submit_draft_transaction",
  "edit_transaction",
  "suggest_existing_match",
]);

const responseStage = (status: number) => {
  if (status === 401 || status === 503) return "credential";
  if (status === 403) return "host_or_origin";
  if (status === 404) return "disabled";
  if (status === 405) return "method";
  if (status === 413) return "body_limit";
  if (status >= 500) return "handler";
  return "protocol";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cloneForLogging = (request: Request) => {
  if (request.method !== "POST") return null;
  try {
    return request.clone();
  } catch {
    return null;
  }
};

const requestIdentity = async (request: Request | null) => {
  if (!request?.body) return {};

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let byteCount = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteCount += chunk.value.byteLength;
      if (byteCount > MCP_MAX_REQUEST_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return {};
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();

    const payload: unknown = JSON.parse(body);
    if (
      !isRecord(payload) ||
      typeof payload.method !== "string" ||
      !knownMcpMethods.has(payload.method)
    )
      return {};

    const mcpMethod = payload.method;
    if (mcpMethod !== "tools/call" || !isRecord(payload.params))
      return { mcpMethod };

    const mcpTool = payload.params.name;
    return typeof mcpTool === "string" && knownMcpTools.has(mcpTool)
      ? { mcpMethod, mcpTool }
      : { mcpMethod };
  } catch {
    return {};
  }
};

const mayInspectBody = (status: number) =>
  ![401, 403, 404, 405, 413, 503].includes(status);

const writeSafely = (writer: LogWriter, event: Record<string, unknown>) => {
  try {
    writer(JSON.stringify(event));
  } catch {
    return;
  }
};

const attachFailureReference = (response: Response, reference: string) => {
  const headers = new Headers(response.headers);
  headers.set("x-folio-error-reference", reference);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const withMcpRequestLogging = async (
  request: Request,
  action: () => Response | Promise<Response>,
  options: RequestLogOptions = {},
): Promise<Response> => {
  const startedAt = performance.now();
  const logRequest = cloneForLogging(request);
  const common = {
    event: "folio.mcp_request",
    version: 1,
    requestMethod: request.method,
    requestPath: new URL(request.url).pathname,
  };

  try {
    const response = await action();
    if (response.status >= 400 || options.logSuccess) {
      const identity = mayInspectBody(response.status)
        ? await requestIdentity(logRequest)
        : {};
      const durationMs = Math.round(performance.now() - startedAt);
      if (response.status >= 400) {
        if (response.headers.has("x-folio-error-reference")) return response;
        const stage = responseStage(response.status);
        const tool = "mcpTool" in identity ? identity.mcpTool : undefined;
        const reported = reportServerFailure(
          new AppError({
            code:
              response.status === 401
                ? "UNAUTHENTICATED"
                : response.status === 403
                  ? "REQUEST_FORBIDDEN"
                  : response.status < 500
                    ? "INPUT_INVALID"
                    : "REQUEST_FAILED",
            stage,
          }),
          {
            operation: tool ?? "mcp_http_request",
            stage,
            metadata: { httpStatus: response.status, ...identity },
            request,
            durationMs,
          },
          options,
        );
        return attachFailureReference(
          response,
          reported.publicFailure.reference,
        );
      }

      writeSafely(options.info ?? console.log, {
        ...common,
        ...identity,
        timestamp: new Date().toISOString(),
        status: response.status,
        durationMs,
      });
    }
    return response;
  } catch (error) {
    reportServerFailure(
      error,
      {
        operation: "mcp_http_request",
        stage: "route_exception",
        metadata: { httpStatus: 500 },
        request,
        durationMs: Math.round(performance.now() - startedAt),
      },
      options,
    );
    throw error;
  }
};
