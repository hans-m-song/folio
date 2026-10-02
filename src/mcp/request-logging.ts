import { MCP_MAX_REQUEST_BODY_BYTES } from "./server";

type LogWriter = (message: string) => void;

type RequestLogOptions = Readonly<{
  logSuccess?: boolean;
  info?: LogWriter;
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
      writeSafely(
        response.status >= 400
          ? (options.error ?? console.error)
          : (options.info ?? console.log),
        {
          ...common,
          ...identity,
          timestamp: new Date().toISOString(),
          status: response.status,
          ...(response.status >= 400
            ? { stage: responseStage(response.status) }
            : {}),
          durationMs: Math.round(performance.now() - startedAt),
        },
      );
    }
    return response;
  } catch (error) {
    writeSafely(options.error ?? console.error, {
      ...common,
      timestamp: new Date().toISOString(),
      status: 500,
      stage: "route_exception",
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
};
