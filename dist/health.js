"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHealthProbe = exports.startHealthServer = exports.healthcheckPort = exports.DEFAULT_HEALTHCHECK_PORT = exports.HEALTHCHECK_HOST_ENV = exports.HEALTHCHECK_PORT_ENV = void 0;
const node_http_1 = require("node:http");
exports.HEALTHCHECK_PORT_ENV = "SIXTY60_HEALTHCHECK_PORT";
exports.HEALTHCHECK_HOST_ENV = "SIXTY60_HEALTHCHECK_HOST";
exports.DEFAULT_HEALTHCHECK_PORT = 8080;
const healthcheckPort = () => {
    const raw = process.env[exports.HEALTHCHECK_PORT_ENV];
    if (raw === undefined || raw === "") {
        return null;
    }
    const port = Number.parseInt(raw, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid ${exports.HEALTHCHECK_PORT_ENV}: ${JSON.stringify(raw)}`);
    }
    return port;
};
exports.healthcheckPort = healthcheckPort;
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
const startHealthServer = (provider, port, host = process.env[exports.HEALTHCHECK_HOST_ENV] ?? "0.0.0.0") => {
    const server = (0, node_http_1.createServer)((req, res) => {
        const send = (code, body) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        if ((req.method ?? "GET") !== "GET") {
            send(405, { status: "method_not_allowed" });
            return;
        }
        let snapshot;
        try {
            snapshot = provider();
        }
        catch (error) {
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
exports.startHealthServer = startHealthServer;
// Backs `mcp-server.js --healthcheck` (the Docker HEALTHCHECK command): probe
// the local endpoint and resolve with a process exit code. Defaults to /ready,
// so a passing check means the MCP transport is actually connected.
const runHealthProbe = (port, path = "/ready") => new Promise((resolve) => {
    const req = (0, node_http_1.get)({ host: "127.0.0.1", port, path, timeout: 3000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200 ? 0 : 1);
    });
    req.on("error", () => resolve(1));
    req.on("timeout", () => {
        req.destroy();
        resolve(1);
    });
});
exports.runHealthProbe = runHealthProbe;
