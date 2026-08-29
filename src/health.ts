import {
  createServer as createHttpServer,
  get as httpGet,
  type Server,
} from "node:http";

export const HEALTHCHECK_PORT_ENV = "SIXTY60_HEALTHCHECK_PORT";
export const HEALTHCHECK_HOST_ENV = "SIXTY60_HEALTHCHECK_HOST";
export const DEFAULT_HEALTHCHECK_PORT = 8080;

// Snapshot of the MCP server's live runtime state, supplied by mcp-server.ts.
export type McpHealth = {
  // Liveness: the process is up and has not hit an internal MCP error.
  ok: boolean;
  // Readiness: the MCP transport is connected and tools are registered.
  ready: boolean;
  // Extra fields merged into the JSON response body.
  detail: Record<string, unknown>;
};

export type HealthProvider = () => McpHealth;

export const healthcheckPort = (): number | null => {
  const raw = process.env[HEALTHCHECK_PORT_ENV];
  if (raw === undefined || raw === "") {
    return null;
  }

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${HEALTHCHECK_PORT_ENV}: ${JSON.stringify(raw)}`);
  }

  return port;
};

// The MCP server speaks JSON-RPC over stdio and has no network port. This
// endpoint is an opt-in side channel for orchestrators, enabled only when
// SIXTY60_HEALTHCHECK_PORT is set. It reports the live MCP server state (via
// `provider`) rather than a static string, so a probe genuinely confirms the
// service process is running and wired up.
//
//   GET /health, /healthz, /  -> 200 while `ok`   (liveness), else 503
//   GET /ready,  /readyz       -> 200 while `ready` (readiness), else 503
//
// Every response body carries the full status snapshot for debugging.
export const startHealthServer = (
  provider: HealthProvider,
  port: number,
  host = process.env[HEALTHCHECK_HOST_ENV] ?? "0.0.0.0",
): Promise<Server> => {
  const server = createHttpServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if ((req.method ?? "GET") !== "GET") {
      send(405, { status: "method_not_allowed" });
      return;
    }

    let snapshot: McpHealth;
    try {
      snapshot = provider();
    } catch (error) {
      send(500, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const body = {
      status: snapshot.ok ? "ok" : "error",
      ready: snapshot.ready,
      ...snapshot.detail,
    };
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/health" || path === "/healthz" || path === "/") {
      send(snapshot.ok ? 200 : 503, body);
      return;
    }
    if (path === "/ready" || path === "/readyz") {
      send(snapshot.ready ? 200 : 503, body);
      return;
    }

    send(404, { status: "not_found" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
};

// Backs `mcp-server.js --healthcheck` (the Docker HEALTHCHECK command): probe
// the local endpoint and resolve with a process exit code. Defaults to /ready,
// so a passing check means the MCP transport is actually connected.
export const runHealthProbe = (port: number, path = "/ready"): Promise<number> =>
  new Promise((resolve) => {
    const req = httpGet(
      { host: "127.0.0.1", port, path, timeout: 3000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200 ? 0 : 1);
      },
    );
    req.on("error", () => resolve(1));
    req.on("timeout", () => {
      req.destroy();
      resolve(1);
    });
  });
