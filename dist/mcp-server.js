#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMcpServer = exports.createServer = void 0;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const api_1 = require("./api");
const format_1 = require("./format");
const session_1 = require("./session");
const storage_1 = require("./storage");
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
        version: "0.1.0",
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
    server.registerTool("set_location", {
        description: "Persist a delivery latitude/longitude used to resolve store contexts for search, cart, and basket calls.",
        inputSchema: {
            lat: zod_1.z.number().min(-90).max(90),
            lng: zod_1.z.number().min(-180).max(180),
        },
    }, async ({ lat, lng }) => {
        try {
            const saved = await (0, storage_1.writeLocationSettings)(lat, lng);
            return ok(saved);
        }
        catch (error) {
            return fail(error);
        }
    });
    return server;
};
exports.createServer = createServer;
const runMcpServer = async () => {
    const server = (0, exports.createServer)();
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
};
exports.runMcpServer = runMcpServer;
// Allows this module to be launched directly (`node dist/mcp-server.js`),
// not only via the `checkers-sixty60 mcp` CLI subcommand.
if (require.main === module) {
    (0, exports.runMcpServer)().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
