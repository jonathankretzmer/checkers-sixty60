import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer as createHttpServer,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DATA_DIR_PATH, MCP_HTTP_PORT } from "./config";
import { makeContext, runWithTenant } from "./context";
import {
  DEFAULT_HEALTHCHECK_PORT,
  HEALTHCHECK_HOST_ENV,
} from "./health";
import { IdentityError, effectiveAuthMode, resolveIdentity } from "./identity";
import { log } from "./logger";
import { createServer } from "./mcp-server";

// Streamable HTTP MCP host for multi-tenant deployment behind a gateway.
//
// Stateless: every request builds its own McpServer + transport, resolves the
// caller's identity, and runs the whole exchange inside a tenant-bound async
// context so session.ts / tenant-state.ts read the right per-user state. No
// session state is retained between requests, which is what a gateway that may
// fan requests across replicas wants.

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const bootedAt = Date.now();

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const rpcError = (status: number, message: string, code: number): unknown => ({
  jsonrpc: "2.0",
  error: { code, message },
  id: null,
});

const handleMcp = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  let identity: Awaited<ReturnType<typeof resolveIdentity>>;
  try {
    identity = await resolveIdentity(req);
  } catch (error) {
    if (error instanceof IdentityError) {
      res.setHeader("www-authenticate", 'Bearer realm="checkers-sixty60"');
      sendJson(res, 401, rpcError(401, error.message, -32001));
      return;
    }
    throw error;
  }

  let parsedBody: unknown;
  if (req.method === "POST") {
    const raw = await readBody(req);
    parsedBody = raw.length > 0 ? JSON.parse(raw) : undefined;
  }

  const ctx = makeContext(identity.tenantId, identity.label);
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await runWithTenant(ctx, () => transport.handleRequest(req, res, parsedBody));
};

export const runHttpMcpServer = async (
  port: number = MCP_HTTP_PORT ?? DEFAULT_HEALTHCHECK_PORT,
): Promise<Server> => {
  // Fail closed at startup if no auth mode is configured, rather than on the
  // first request.
  const mode = effectiveAuthMode();

  const host = process.env[HEALTHCHECK_HOST_ENV] ?? "0.0.0.0";

  const httpServer = createHttpServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const method = req.method ?? "GET";

    if (path === "/health" || path === "/healthz") {
      sendJson(res, 200, {
        status: "ok",
        server: "checkers-sixty60",
        transport: "streamable-http",
        authMode: mode,
        pid: process.pid,
        uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
      });
      return;
    }

    if (path === "/ready" || path === "/readyz") {
      sendJson(res, 200, { status: "ready" });
      return;
    }

    if (path === "/mcp" || path === "/") {
      if (method !== "POST" && method !== "GET" && method !== "DELETE") {
        sendJson(res, 405, { status: "method_not_allowed" });
        return;
      }
      handleMcp(req, res).catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        log(`http mcp request failed: ${detail}`);
        if (!res.headersSent) {
          sendJson(res, 500, rpcError(500, "Internal error", -32603));
        } else {
          res.end();
        }
      });
      return;
    }

    sendJson(res, 404, { status: "not_found" });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  log(
    `mcp streamable-http server on ${host}:${port} ` +
      `(POST /mcp, GET /health, /ready; auth=${mode}, data dir ${DATA_DIR_PATH})`,
  );
  return httpServer;
};
