#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMcpServer = exports.createServer = void 0;
// Load `.env` from the working directory (no-op if absent) before any module
// reads process.env. Harmless under bun / Docker env_file.
require("dotenv/config");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const api_1 = require("./api");
const config_1 = require("./config");
const context_1 = require("./context");
const format_1 = require("./format");
const health_1 = require("./health");
const logger_1 = require("./logger");
const session_1 = require("./session");
const ok = (value) => ({
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const fail = (error) => ({
    content: [
        { type: "text", text: error instanceof Error ? error.message : String(error) },
    ],
    isError: true,
});
// Never echo tokens back to an MCP client - only the non-sensitive session
// summary is useful to a caller deciding what to do next.
const toSessionSummary = (auth) => ({
    phoneE164: auth.phoneE164,
    customerId: auth.customerId,
    userId: auth.userId,
    email: auth.email,
    storeIds: auth.storeIds,
    savedAt: auth.savedAt,
});
const createServer = () => {
    const server = new mcp_js_1.McpServer({
        name: "checkers-sixty60",
        version: "0.3.0",
    });
    server.registerTool("request_otp", {
        description: "Start login for a Checkers Sixty60 account by requesting an OTP for a South African phone number.",
        inputSchema: {
            phone: zod_1.z
                .string()
                .describe("SA phone number, e.g. 0821234567 or +27821234567"),
        },
    }, async ({ phone }) => {
        try {
            const result = await (0, session_1.requestOtpForPhone)(phone);
            return ok(result);
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("verify_otp", {
        description: "Complete login by verifying the OTP code sent via request_otp. Persists the session for later tool calls.",
        inputSchema: {
            phone: zod_1.z.string().describe("SA phone number, same one used in request_otp"),
            otp: zod_1.z.string().describe("The OTP code received by SMS"),
            reference: zod_1.z
                .string()
                .optional()
                .describe("OTP reference, only needed if the pending session was lost"),
        },
    }, async ({ phone, otp, reference }) => {
        try {
            const state = await (0, session_1.completeOtpForPhone)(phone, otp, reference);
            return ok(toSessionSummary(state));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("list_orders", {
        description: "Fetch the authenticated user's Checkers Sixty60 order history.",
        inputSchema: {
            compact: zod_1.z
                .boolean()
                .optional()
                .default(true)
                .describe("Return a compact summary instead of the raw API payload"),
        },
    }, async ({ compact }) => {
        try {
            const auth = await (0, session_1.requireAuth)();
            const orders = await (0, session_1.withReauthHint)(() => (0, api_1.fetchOrders)((0, session_1.toLoginContext)(auth)));
            return ok(compact ? (0, format_1.toCompactOrders)(orders) : orders);
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("view_cart", {
        description: "View the authenticated user's current cart(s).",
        inputSchema: {
            compact: zod_1.z
                .boolean()
                .optional()
                .default(true)
                .describe("Return a compact summary instead of the raw API payload"),
        },
    }, async ({ compact }) => {
        try {
            const auth = await (0, session_1.requireAuth)();
            const result = await (0, session_1.withReauthHint)(() => (0, api_1.viewCart)((0, session_1.toLoginContext)(auth)));
            return ok(compact ? (0, format_1.toCompactCarts)(result) : result);
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("search_products", {
        description: "Search the Checkers Sixty60 product catalog.",
        inputSchema: {
            query: zod_1.z.string().describe("Search text, e.g. 'milk'"),
            page: zod_1.z.number().int().min(0).optional().default(0),
            size: zod_1.z.number().int().min(1).max(100).optional().default(20),
            compact: zod_1.z
                .boolean()
                .optional()
                .default(true)
                .describe("Return a compact summary instead of the raw API payload"),
        },
    }, async ({ query, page, size, compact }) => {
        try {
            const auth = await (0, session_1.requireAuth)();
            const results = await (0, session_1.withReauthHint)(() => (0, api_1.searchProducts)((0, session_1.toLoginContext)(auth), query, page, size));
            return ok(compact ? (0, format_1.toCompactSearchResults)(results) : results);
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("list_my_products", {
        description: "Fetch and cache the authenticated user's personalised 'my products' list: catalog products they have ordered before, ranked by a recency/frequency score, each with a past-order count. Always hits the network and overwrites the local cache that find_product reads. Use it to seed reorder / 'add my usuals' flows. Returns { products (score-desc, hydrated with name/price/stock), fetchedAt, storeIds, totalScored, hydrated }.",
        inputSchema: {
            limit: zod_1.z
                .number()
                .int()
                .min(1)
                .max(200)
                .optional()
                .default(100)
                .describe("How many of the top-ranked products to hydrate and cache (the raw score list can be hundreds long)"),
        },
    }, async ({ limit }) => {
        try {
            return ok(await (0, session_1.refreshMyProducts)({ limit }));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("find_product", {
        description: "One-shot product lookup for add-to-cart flows. Name-matches the query against the user's cached 'my products' (previously ordered, ranked) AND runs a fresh catalog search, returning both in one response so you can prefer a previously-ordered item and fall back to search without a second call. `myProducts.matches` is score-ordered; when non-empty, `recommendation` names the best previously-ordered candidate. The my-products cache auto-refreshes if missing, older than 24h, or for a different delivery store; pass refreshMyProducts to force it.",
        inputSchema: {
            query: zod_1.z.string().describe("Product to look for, e.g. 'full cream milk'"),
            matchLimit: zod_1.z
                .number()
                .int()
                .min(1)
                .max(50)
                .optional()
                .default(10)
                .describe("Max previously-ordered matches to return"),
            searchSize: zod_1.z
                .number()
                .int()
                .min(1)
                .max(100)
                .optional()
                .default(20)
                .describe("Fresh catalog search page size"),
            refreshMyProducts: zod_1.z
                .boolean()
                .optional()
                .default(false)
                .describe("Force-refresh the my-products cache before matching"),
        },
    }, async ({ query, matchLimit, searchSize, refreshMyProducts }) => {
        try {
            return ok(await (0, session_1.findProduct)(query, {
                matchLimit,
                searchSize,
                refreshMyProducts,
            }));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("add_to_basket", {
        description: "Add a product to the authenticated user's basket.",
        inputSchema: {
            productId: zod_1.z.string(),
            qty: zod_1.z.number().int().min(1).optional().default(1),
            cartId: zod_1.z.string().optional(),
        },
    }, async ({ productId, qty, cartId }) => {
        try {
            const auth = await (0, session_1.requireAuth)();
            const result = await (0, session_1.withReauthHint)(() => (0, api_1.addToBasket)((0, session_1.toLoginContext)(auth), productId, qty, cartId));
            return ok(result);
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("remove_from_basket", {
        description: "Remove a product from the authenticated user's basket, fully or by a quantity decrement.",
        inputSchema: {
            productId: zod_1.z.string(),
            qty: zod_1.z
                .number()
                .int()
                .min(1)
                .optional()
                .describe("Omit to remove the product entirely"),
            cartId: zod_1.z.string().optional(),
        },
    }, async ({ productId, qty, cartId }) => {
        try {
            const auth = await (0, session_1.requireAuth)();
            const result = await (0, session_1.withReauthHint)(() => (0, api_1.removeFromBasket)((0, session_1.toLoginContext)(auth), productId, qty, cartId));
            return ok(result);
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("list_addresses", {
        description: "List the delivery addresses saved on the authenticated Checkers Sixty60 account, most-recently-used first (read-only; add or edit addresses in the Sixty60 app). Each entry includes its coordinates and id for use with set_location.",
        inputSchema: {},
    }, async () => {
        try {
            return ok(await (0, session_1.listSavedAddresses)());
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("set_location", {
        description: "Choose which saved Checkers address supplies the delivery coordinates for search, cart, and basket calls. Pass addressId (from list_addresses) to pin one; omit it (or pass useLastUsed) to clear the pin and always follow the account's most-recently-used address. There is no way to set arbitrary coordinates — manage addresses in the Sixty60 app.",
        inputSchema: {
            addressId: zod_1.z
                .string()
                .optional()
                .describe("id of a saved Checkers address (from list_addresses) to pin; omit to follow the most-recently-used address"),
            useLastUsed: zod_1.z
                .boolean()
                .optional()
                .describe("Explicitly clear any pin so the account's most-recently-used address is followed (same as omitting addressId)"),
        },
    }, async ({ addressId }) => {
        try {
            const { address, selection } = await (0, session_1.selectDeliveryAddress)(addressId);
            return ok({ selection, address });
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool("get_config", {
        description: "Show the current local configuration and session state (data dir, logged-in account phone/email, device id, which API credentials are present) plus the resolved active delivery address (label, formatted address, coordinates, pinned vs last-used). Never returns tokens or credential values.",
        inputSchema: {},
    }, async () => {
        try {
            return ok(await (0, session_1.getConfigSummary)());
        }
        catch (error) {
            return fail(error);
        }
    });
    return server;
};
exports.createServer = createServer;
const bootedAt = Date.now();
const runMcpServer = async () => {
    // stdio is always the single-user path: bind the default (flat-file) tenant
    // for the life of the process so session.ts / tenant-state.ts resolve state
    // exactly as the CLI does.
    await (0, context_1.runWithTenant)((0, context_1.defaultContext)(), runStdioMcpServer);
};
exports.runMcpServer = runMcpServer;
const runStdioMcpServer = async () => {
    const server = (0, exports.createServer)();
    // Track the MCP server lifecycle so the health endpoint reports real state
    // instead of a hard-coded "ok".
    //
    // `transportClosed` is a hard failure: the stdio transport tore down (parse
    // failure it could not recover from, or an explicit close) and the server is
    // no longer serving. `errorCount` / `lastError` are advisory - the SDK keeps
    // serving after a bad client frame, so a single protocol error does not by
    // itself make the process unhealthy, but it is surfaced for debugging.
    let transportClosed = false;
    let errorCount = 0;
    let lastError = null;
    server.server.onerror = (error) => {
        errorCount += 1;
        lastError = error.message;
        (0, logger_1.log)(`mcp error: ${error.message}`);
    };
    server.server.onclose = () => {
        transportClosed = true;
        (0, logger_1.log)("mcp transport closed");
    };
    // Tool count; guarded in case the SDK internal changes shape.
    const registered = server._registeredTools;
    const toolCount = registered && typeof registered === "object"
        ? Object.keys(registered).length
        : null;
    const health = () => {
        const connected = server.isConnected() && !transportClosed;
        return {
            ok: !transportClosed,
            ready: connected && (toolCount === null || toolCount > 0),
            detail: {
                server: "checkers-sixty60",
                transport: "stdio",
                pid: process.pid,
                uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
                mcp: {
                    connected,
                    tools: toolCount,
                    transportClosed,
                    errorCount,
                    lastError,
                },
            },
        };
    };
    const port = (0, health_1.healthcheckPort)();
    if (port !== null) {
        await (0, health_1.startHealthServer)(health, port);
        (0, logger_1.log)(`health endpoint on :${port} (GET /health, /ready)`);
    }
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    (0, logger_1.log)(`mcp server ready (stdio, ${toolCount ?? "?"} tools, data dir ${config_1.DATA_DIR_PATH})`);
};
// Allows this module to be launched directly (`node dist/mcp-server.js`),
// not only via the `checkers-sixty60 mcp` CLI subcommand.
if (require.main === module) {
    const fail = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        (0, logger_1.log)(`fatal: ${message}`);
        process.exit(1);
    };
    if (process.argv.includes("--healthcheck")) {
        // Docker HEALTHCHECK entrypoint: probe the running server's endpoint. In
        // --http mode that endpoint is the Streamable HTTP server's port.
        const port = config_1.MCP_HTTP_PORT ?? (0, health_1.healthcheckPort)() ?? health_1.DEFAULT_HEALTHCHECK_PORT;
        (0, health_1.runHealthProbe)(port).then((code) => process.exit(code));
    }
    else if (process.argv.includes("--http")) {
        // Multi-tenant Streamable HTTP host (e.g. behind an Obot gateway). Loaded
        // lazily so the stdio path never pulls in the HTTP stack.
        import("./http-server.js")
            .then((m) => m.runHttpMcpServer())
            .catch(fail);
    }
    else {
        (0, exports.runMcpServer)().catch(fail);
    }
}
