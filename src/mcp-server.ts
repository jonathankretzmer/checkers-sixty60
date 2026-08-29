#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addToBasket,
  fetchOrders,
  removeFromBasket,
  searchProducts,
  viewCart,
} from "./api";
import { DATA_DIR_PATH, MCP_HTTP_PORT } from "./config";
import { defaultContext, runWithTenant } from "./context";
import { toCompactCarts, toCompactOrders, toCompactSearchResults } from "./format";
import {
  DEFAULT_HEALTHCHECK_PORT,
  healthcheckPort,
  type McpHealth,
  runHealthProbe,
  startHealthServer,
} from "./health";
import { log } from "./logger";
import {
  completeOtpForPhone,
  requestOtpForPhone,
  requireAuth,
  toLoginContext,
  withReauthHint,
} from "./session";
import { writeLocationSettings } from "./tenant-state";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const fail = (error: unknown): ToolResult => ({
  content: [
    { type: "text", text: error instanceof Error ? error.message : String(error) },
  ],
  isError: true,
});

// Never echo tokens back to an MCP client - only the non-sensitive session
// summary is useful to a caller deciding what to do next.
const toSessionSummary = (auth: {
  phoneE164: string;
  customerId?: string;
  userId?: string;
  email?: string;
  storeIds?: string[];
  savedAt: string;
}) => ({
  phoneE164: auth.phoneE164,
  customerId: auth.customerId,
  userId: auth.userId,
  email: auth.email,
  storeIds: auth.storeIds,
  savedAt: auth.savedAt,
});

export const createServer = (): McpServer => {
  const server = new McpServer({
    name: "checkers-sixty60",
    version: "0.1.0",
  });

  server.registerTool(
    "request_otp",
    {
      description:
        "Start login for a Checkers Sixty60 account by requesting an OTP for a South African phone number.",
      inputSchema: {
        phone: z
          .string()
          .describe("SA phone number, e.g. 0821234567 or +27821234567"),
      },
    },
    async ({ phone }) => {
      try {
        const result = await requestOtpForPhone(phone);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "verify_otp",
    {
      description:
        "Complete login by verifying the OTP code sent via request_otp. Persists the session for later tool calls.",
      inputSchema: {
        phone: z.string().describe("SA phone number, same one used in request_otp"),
        otp: z.string().describe("The OTP code received by SMS"),
        reference: z
          .string()
          .optional()
          .describe("OTP reference, only needed if the pending session was lost"),
      },
    },
    async ({ phone, otp, reference }) => {
      try {
        const state = await completeOtpForPhone(phone, otp, reference);
        return ok(toSessionSummary(state));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_orders",
    {
      description: "Fetch the authenticated user's Checkers Sixty60 order history.",
      inputSchema: {
        compact: z
          .boolean()
          .optional()
          .default(true)
          .describe("Return a compact summary instead of the raw API payload"),
      },
    },
    async ({ compact }) => {
      try {
        const auth = await requireAuth();
        const orders = await withReauthHint(() => fetchOrders(toLoginContext(auth)));
        return ok(compact ? toCompactOrders(orders) : orders);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "view_cart",
    {
      description: "View the authenticated user's current cart(s).",
      inputSchema: {
        compact: z
          .boolean()
          .optional()
          .default(true)
          .describe("Return a compact summary instead of the raw API payload"),
      },
    },
    async ({ compact }) => {
      try {
        const auth = await requireAuth();
        const result = await withReauthHint(() => viewCart(toLoginContext(auth)));
        return ok(compact ? toCompactCarts(result) : result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "search_products",
    {
      description: "Search the Checkers Sixty60 product catalog.",
      inputSchema: {
        query: z.string().describe("Search text, e.g. 'milk'"),
        page: z.number().int().min(0).optional().default(0),
        size: z.number().int().min(1).max(100).optional().default(20),
        compact: z
          .boolean()
          .optional()
          .default(true)
          .describe("Return a compact summary instead of the raw API payload"),
      },
    },
    async ({ query, page, size, compact }) => {
      try {
        const auth = await requireAuth();
        const results = await withReauthHint(() =>
          searchProducts(toLoginContext(auth), query, page, size),
        );
        return ok(compact ? toCompactSearchResults(results) : results);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "add_to_basket",
    {
      description: "Add a product to the authenticated user's basket.",
      inputSchema: {
        productId: z.string(),
        qty: z.number().int().min(1).optional().default(1),
        cartId: z.string().optional(),
      },
    },
    async ({ productId, qty, cartId }) => {
      try {
        const auth = await requireAuth();
        const result = await withReauthHint(() =>
          addToBasket(toLoginContext(auth), productId, qty, cartId),
        );
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "remove_from_basket",
    {
      description:
        "Remove a product from the authenticated user's basket, fully or by a quantity decrement.",
      inputSchema: {
        productId: z.string(),
        qty: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Omit to remove the product entirely"),
        cartId: z.string().optional(),
      },
    },
    async ({ productId, qty, cartId }) => {
      try {
        const auth = await requireAuth();
        const result = await withReauthHint(() =>
          removeFromBasket(toLoginContext(auth), productId, qty, cartId),
        );
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "set_location",
    {
      description:
        "Persist a delivery latitude/longitude used to resolve store contexts for search, cart, and basket calls.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      },
    },
    async ({ lat, lng }) => {
      try {
        const saved = await writeLocationSettings(lat, lng);
        return ok(saved);
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
};

const bootedAt = Date.now();

export const runMcpServer = async (): Promise<void> => {
  // stdio is always the single-user path: bind the default (flat-file) tenant
  // for the life of the process so session.ts / tenant-state.ts resolve state
  // exactly as the CLI does.
  await runWithTenant(defaultContext(), runStdioMcpServer);
};

const runStdioMcpServer = async (): Promise<void> => {
  const server = createServer();

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
  let lastError: string | null = null;
  server.server.onerror = (error: Error) => {
    errorCount += 1;
    lastError = error.message;
    log(`mcp error: ${error.message}`);
  };
  server.server.onclose = () => {
    transportClosed = true;
    log("mcp transport closed");
  };

  // Tool count; guarded in case the SDK internal changes shape.
  const registered = (
    server as unknown as { _registeredTools?: Record<string, unknown> }
  )._registeredTools;
  const toolCount =
    registered && typeof registered === "object"
      ? Object.keys(registered).length
      : null;

  const health = (): McpHealth => {
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

  const port = healthcheckPort();
  if (port !== null) {
    await startHealthServer(health, port);
    log(`health endpoint on :${port} (GET /health, /ready)`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(
    `mcp server ready (stdio, ${toolCount ?? "?"} tools, data dir ${DATA_DIR_PATH})`,
  );
};

// Allows this module to be launched directly (`node dist/mcp-server.js`),
// not only via the `checkers-sixty60 mcp` CLI subcommand.
if (require.main === module) {
  const fail = (error: unknown): never => {
    const message = error instanceof Error ? error.message : String(error);
    log(`fatal: ${message}`);
    process.exit(1);
  };

  if (process.argv.includes("--healthcheck")) {
    // Docker HEALTHCHECK entrypoint: probe the running server's endpoint. In
    // --http mode that endpoint is the Streamable HTTP server's port.
    const port =
      MCP_HTTP_PORT ?? healthcheckPort() ?? DEFAULT_HEALTHCHECK_PORT;
    runHealthProbe(port).then((code) => process.exit(code));
  } else if (process.argv.includes("--http")) {
    // Multi-tenant Streamable HTTP host (e.g. behind an Obot gateway). Loaded
    // lazily so the stdio path never pulls in the HTTP stack.
    import("./http-server.js")
      .then((m) => m.runHttpMcpServer())
      .catch(fail);
  } else {
    runMcpServer().catch(fail);
  }
}
