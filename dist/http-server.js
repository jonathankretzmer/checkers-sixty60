"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHttpMcpServer = void 0;
const node_http_1 = require("node:http");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const config_1 = require("./config");
const context_1 = require("./context");
const health_1 = require("./health");
const identity_1 = require("./identity");
const logger_1 = require("./logger");
const mcp_server_1 = require("./mcp-server");
// Streamable HTTP MCP host for multi-tenant deployment behind a gateway.
//
// Stateless: every request builds its own McpServer + transport, resolves the
// caller's identity, and runs the whole exchange inside a tenant-bound async
// context so session.ts / tenant-state.ts read the right per-user state. No
// session state is retained between requests, which is what a gateway that may
// fan requests across replicas wants.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const bootedAt = Date.now();
const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
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
const sendJson = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
};
const rpcError = (status, message, code) => ({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
});
const handleMcp = async (req, res) => {
    let identity;
    try {
        identity = await (0, identity_1.resolveIdentity)(req);
    }
    catch (error) {
        if (error instanceof identity_1.IdentityError) {
            res.setHeader("www-authenticate", 'Bearer realm="checkers-sixty60"');
            sendJson(res, 401, rpcError(401, error.message, -32001));
            return;
        }
        throw error;
    }
    let parsedBody;
    if (req.method === "POST") {
        const raw = await readBody(req);
        parsedBody = raw.length > 0 ? JSON.parse(raw) : undefined;
    }
    const ctx = (0, context_1.makeContext)(identity.tenantId, identity.label);
    const server = (0, mcp_server_1.createServer)();
    const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    res.on("close", () => {
        void transport.close();
        void server.close();
    });
    await server.connect(transport);
    await (0, context_1.runWithTenant)(ctx, () => transport.handleRequest(req, res, parsedBody));
};
const runHttpMcpServer = async (port = config_1.MCP_HTTP_PORT ?? health_1.DEFAULT_HEALTHCHECK_PORT) => {
    // Fail closed at startup if no auth mode is configured, rather than on the
    // first request.
    const mode = (0, identity_1.effectiveAuthMode)();
    const host = process.env[health_1.HEALTHCHECK_HOST_ENV] ?? "0.0.0.0";
    const httpServer = (0, node_http_1.createServer)((req, res) => {
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
            handleMcp(req, res).catch((error) => {
                const detail = error instanceof Error ? error.message : String(error);
                (0, logger_1.log)(`http mcp request failed: ${detail}`);
                if (!res.headersSent) {
                    sendJson(res, 500, rpcError(500, "Internal error", -32603));
                }
                else {
                    res.end();
                }
            });
            return;
        }
        sendJson(res, 404, { status: "not_found" });
    });
    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => resolve());
    });
    (0, logger_1.log)(`mcp streamable-http server on ${host}:${port} ` +
        `(POST /mcp, GET /health, /ready; auth=${mode}, data dir ${config_1.DATA_DIR_PATH})`);
    return httpServer;
};
exports.runHttpMcpServer = runHttpMcpServer;
