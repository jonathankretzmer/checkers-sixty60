#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Load `.env` from the working directory (no-op if absent) before any module
// reads process.env. Harmless under bun / Docker env_file, which set the
// environment another way.
require("dotenv/config");
const prompts_1 = require("@inquirer/prompts");
const api_1 = require("./api");
const config_1 = require("./config");
const context_1 = require("./context");
const format_1 = require("./format");
const mcp_server_1 = require("./mcp-server");
const session_1 = require("./session");
const tenant_state_1 = require("./tenant-state");
const usage = `
Usage:
  checkers-sixty60                                Interactive menu
  checkers-sixty60 login                          Interactive login (phone + OTP)
  checkers-sixty60 request-otp --phone <phone>
  checkers-sixty60 verify-otp --phone <phone> --otp <code> [--reference <ref>]
  checkers-sixty60 login --phone <phone> --otp <code> [--reference <ref>]
  checkers-sixty60 orders [--json] [--compact]
  checkers-sixty60 config                         Show local config (phone, pinned address, ...) as JSON - no secrets
  checkers-sixty60 addresses [--json]             List delivery addresses saved on the Checkers account
  checkers-sixty60 set-location --address-id <id> Pin one of those addresses for delivery coordinates
  checkers-sixty60 set-location --last-used       Follow the account's most-recently-used address
  checkers-sixty60 view-cart [--compact]
  checkers-sixty60 search --query <text> [--page <n>] [--size <n>] [--compact]
  checkers-sixty60 my-products [--limit <n>]              Fetch + cache the personalised "previously ordered" list (ranked)
  checkers-sixty60 find-product --query <text> [--size <n>] [--limit <n>] [--refresh]
  checkers-sixty60 add-to-basket --product-id <id> [--qty <n>] [--cart-id <id>]
  checkers-sixty60 remove-from-basket --product-id <id> [--qty <n>] [--cart-id <id>]
  checkers-sixty60 mcp                            Run as an MCP server over stdio
  checkers-sixty60 mcp --http [--port <n>]        Run as a Streamable HTTP MCP server (multi-tenant)

Examples:
  checkers-sixty60 request-otp --phone 0821234567
  checkers-sixty60 verify-otp --phone 0821234567 --otp 1234
  checkers-sixty60 orders --json
  checkers-sixty60 orders --compact
  checkers-sixty60 config
  checkers-sixty60 addresses
  checkers-sixty60 set-location --address-id 6a7af63360759ffcea46f2ca
  checkers-sixty60 set-location --last-used
  checkers-sixty60 view-cart --compact
  checkers-sixty60 search --query milk --compact
  checkers-sixty60 my-products --limit 50
  checkers-sixty60 find-product --query "full cream milk"
  checkers-sixty60 add-to-basket --product-id 5d3af63cf434cf8420737e3e --qty 1
  checkers-sixty60 remove-from-basket --product-id 5d3af63cf434cf8420737e3e
`;
const parseCliArgs = () => {
    const args = process.argv.slice(2);
    const first = args[0];
    const command = first && !first.startsWith("-") ? first : undefined;
    const getFlag = (name) => {
        const index = args.indexOf(name);
        if (index === -1 || index + 1 >= args.length) {
            return undefined;
        }
        return args[index + 1];
    };
    const getNumberFlag = (name) => {
        const value = getFlag(name);
        if (!value) {
            return undefined;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    return {
        command,
        phone: getFlag("--phone"),
        otp: getFlag("--otp"),
        reference: getFlag("--reference"),
        query: getFlag("--query"),
        productId: getFlag("--product-id"),
        cartId: getFlag("--cart-id"),
        addressId: getFlag("--address-id"),
        page: getNumberFlag("--page"),
        size: getNumberFlag("--size"),
        limit: getNumberFlag("--limit"),
        qty: getNumberFlag("--qty"),
        port: getNumberFlag("--port"),
        json: args.includes("--json"),
        compact: args.includes("--compact"),
        http: args.includes("--http"),
        help: args.includes("--help") || args.includes("-h"),
        lastUsed: args.includes("--last-used"),
        refresh: args.includes("--refresh"),
    };
};
const ensurePhone = (phone) => {
    if (!phone) {
        throw new Error("Missing required --phone option");
    }
    return phone;
};
const ensureOtp = (otp) => {
    if (!otp) {
        throw new Error("Missing required --otp option");
    }
    return otp;
};
const ensureQuery = (query) => {
    if (!query) {
        throw new Error("Missing required --query option");
    }
    return query;
};
const ensureProductId = (productId) => {
    if (!productId) {
        throw new Error("Missing required --product-id option");
    }
    return productId;
};
const ensureQuantity = (qty) => {
    const value = qty ?? 1;
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--qty must be a positive integer");
    }
    return value;
};
const ensureOptionalQuantity = (qty) => {
    if (qty === undefined) {
        return undefined;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error("--qty must be a positive integer");
    }
    return qty;
};
const startOtpForPhone = async (phone) => {
    const result = await (0, session_1.requestOtpForPhone)(phone);
    console.log(`OTP sent to ${result.phoneE164}`);
    console.log(`Reference: ${result.reference}`);
    console.log(result.otpIdentifier
        ? `Verify identifier: ${result.otpIdentifier}`
        : "Verify identifier: not returned; verify will try +27…, 27…, then 0… formats");
};
const runInteractiveLogin = async () => {
    const phone = await (0, prompts_1.input)({ message: "Phone number (e.g. 0821234567):" });
    const otpStart = await (0, api_1.startOtpFlow)(phone);
    console.log(`OTP sent to ${otpStart.phoneE164}`);
    const otp = await (0, prompts_1.password)({ message: "Enter OTP:" });
    const login = await (0, api_1.completeOtpFlow)(otpStart.phoneE164, otpStart.customerId, otpStart.bffToken, otpStart.reference, otp, otpStart.otpIdentifier);
    const state = (0, session_1.toAuthState)(login, otpStart.bffToken, otpStart.reference, otpStart.otpIdentifier);
    await (0, context_1.currentTenant)().store.writeAuth(state);
    return state;
};
const runOrders = async (jsonOnly, compact) => {
    const auth = await (0, session_1.requireAuth)();
    const orders = await (0, session_1.withReauthHint)(() => (0, api_1.fetchOrders)((0, session_1.toLoginContext)(auth)));
    if (compact) {
        const compactOrders = (0, format_1.toCompactOrders)(orders);
        console.log(JSON.stringify(compactOrders, null, 2));
        return;
    }
    if (!jsonOnly) {
        console.log("Fetched orders successfully.");
    }
    console.log(JSON.stringify(orders, null, 2));
};
const runSearch = async (query, page, size, compact) => {
    const auth = await (0, session_1.requireAuth)();
    const results = await (0, session_1.withReauthHint)(() => (0, api_1.searchProducts)((0, session_1.toLoginContext)(auth), query, page, size));
    if (compact) {
        console.log(JSON.stringify((0, format_1.toCompactSearchResults)(results), null, 2));
        return;
    }
    console.log(JSON.stringify(results, null, 2));
};
const runMyProducts = async (limit) => {
    const result = await (0, session_1.refreshMyProducts)({ limit });
    console.log(JSON.stringify(result, null, 2));
};
const runFindProduct = async (query, searchSize, matchLimit, refresh) => {
    const result = await (0, session_1.findProduct)(query, {
        searchSize,
        matchLimit,
        refreshMyProducts: refresh,
    });
    console.log(JSON.stringify(result, null, 2));
};
const runAddToBasket = async (productId, qty, cartId) => {
    const auth = await (0, session_1.requireAuth)();
    const result = await (0, session_1.withReauthHint)(() => (0, api_1.addToBasket)((0, session_1.toLoginContext)(auth), productId, qty, cartId));
    console.log(JSON.stringify(result, null, 2));
};
const runRemoveFromBasket = async (productId, qty, cartId) => {
    const auth = await (0, session_1.requireAuth)();
    const result = await (0, session_1.withReauthHint)(() => (0, api_1.removeFromBasket)((0, session_1.toLoginContext)(auth), productId, qty, cartId));
    console.log(JSON.stringify(result, null, 2));
};
const runViewCart = async (compact) => {
    const auth = await (0, session_1.requireAuth)();
    const result = await (0, session_1.withReauthHint)(() => (0, api_1.viewCart)((0, session_1.toLoginContext)(auth)));
    console.log(JSON.stringify(compact ? (0, format_1.toCompactCarts)(result) : result, null, 2));
};
const runSetLocation = async (cli) => {
    if (cli.addressId === undefined && !cli.lastUsed) {
        throw new Error("set-location needs --address-id <id> (pin a saved Checkers address) or --last-used (follow the account's most-recently-used address). List them with 'checkers-sixty60 addresses'.");
    }
    const { address, selection } = await (0, session_1.selectDeliveryAddress)(cli.addressId);
    const where = address.fullAddress ? ` — ${address.fullAddress}` : "";
    if (selection === "pinned") {
        console.log(`Pinned delivery address ${JSON.stringify(address.label ?? address.id)}${where}`);
        console.log(`  ${address.latitude}, ${address.longitude}`);
        console.log(`Selection saved to ${config_1.SETTINGS_FILE}`);
    }
    else {
        console.log(`Cleared the pin. The account's most-recently-used address will be used automatically (currently ${JSON.stringify(address.label ?? address.id)}${where}).`);
    }
};
const runConfig = async () => {
    const summary = await (0, session_1.getConfigSummary)();
    console.log(JSON.stringify(summary, null, 2));
};
const runAddresses = async (jsonOnly) => {
    const [addresses, pinnedId] = await Promise.all([
        (0, session_1.listSavedAddresses)(),
        (0, tenant_state_1.readSelectedAddressId)(),
    ]);
    if (jsonOnly) {
        console.log(JSON.stringify(addresses, null, 2));
        return;
    }
    if (addresses.length === 0) {
        console.log("No delivery addresses saved on this Checkers account. Add one in the Sixty60 app.");
        return;
    }
    // Which address delivery calls will actually use right now.
    const activeId = pinnedId && addresses.some((a) => a.id === pinnedId)
        ? pinnedId
        : addresses[0]?.id;
    for (const a of addresses) {
        const coords = a.latitude !== undefined && a.longitude !== undefined
            ? `${a.latitude}, ${a.longitude}`
            : "(no coordinates on file)";
        const marker = a.id === activeId
            ? pinnedId === a.id
                ? " *  (active, pinned)"
                : " *  (active, last-used)"
            : "";
        console.log(`${a.label ?? a.type ?? "address"}  [${a.id}]${marker}`);
        if (a.fullAddress) {
            console.log(`  ${a.fullAddress}`);
        }
        console.log(`  ${coords}`);
    }
    console.log("\nPin one with:   checkers-sixty60 set-location --address-id <id>\nFollow latest:  checkers-sixty60 set-location --last-used");
};
const runInteractiveMenu = async () => {
    const action = await (0, prompts_1.select)({
        message: "Select action",
        choices: [
            { value: "login", name: "Interactive login (phone + OTP)" },
            { value: "orders", name: "Fetch my orders" },
        ],
    });
    if (action === "login") {
        const state = await runInteractiveLogin();
        console.log(`Saved auth state to ${config_1.AUTH_FILE} for ${state.phoneE164}`);
        return;
    }
    await runOrders(false, false);
};
const main = async () => {
    const cli = parseCliArgs();
    if (cli.help) {
        console.log(usage.trim());
        return;
    }
    if (!cli.command) {
        await runInteractiveMenu();
        return;
    }
    if (cli.command === "mcp") {
        if (cli.http) {
            const { runHttpMcpServer } = await import("./http-server.js");
            await runHttpMcpServer(cli.port);
            return;
        }
        await (0, mcp_server_1.runMcpServer)();
        return;
    }
    if (cli.command === "login") {
        if (!cli.phone && !cli.otp) {
            const state = await runInteractiveLogin();
            console.log(`Saved auth state to ${config_1.AUTH_FILE} for ${state.phoneE164}`);
            return;
        }
        if (cli.phone && !cli.otp) {
            await startOtpForPhone(ensurePhone(cli.phone));
            return;
        }
        const state = await (0, session_1.completeOtpForPhone)(ensurePhone(cli.phone), ensureOtp(cli.otp), cli.reference);
        console.log(`Saved auth state to ${config_1.AUTH_FILE} for ${state.phoneE164}`);
        return;
    }
    if (cli.command === "request-otp") {
        await startOtpForPhone(ensurePhone(cli.phone));
        return;
    }
    if (cli.command === "verify-otp") {
        const state = await (0, session_1.completeOtpForPhone)(ensurePhone(cli.phone), ensureOtp(cli.otp), cli.reference);
        console.log(`Saved auth state to ${config_1.AUTH_FILE} for ${state.phoneE164}`);
        return;
    }
    if (cli.command === "orders") {
        await runOrders(cli.json, cli.compact);
        return;
    }
    if (cli.command === "config") {
        await runConfig();
        return;
    }
    if (cli.command === "addresses") {
        await runAddresses(cli.json);
        return;
    }
    if (cli.command === "set-location") {
        await runSetLocation(cli);
        return;
    }
    if (cli.command === "view-cart") {
        await runViewCart(cli.compact);
        return;
    }
    if (cli.command === "search") {
        await runSearch(ensureQuery(cli.query), cli.page ?? 0, cli.size ?? 20, cli.compact);
        return;
    }
    if (cli.command === "my-products") {
        await runMyProducts(cli.limit);
        return;
    }
    if (cli.command === "find-product") {
        await runFindProduct(ensureQuery(cli.query), cli.size ?? 20, cli.limit ?? 10, cli.refresh);
        return;
    }
    if (cli.command === "add-to-basket") {
        await runAddToBasket(ensureProductId(cli.productId), ensureQuantity(cli.qty), cli.cartId);
        return;
    }
    if (cli.command === "remove-from-basket") {
        await runRemoveFromBasket(ensureProductId(cli.productId), ensureOptionalQuantity(cli.qty), cli.cartId);
        return;
    }
    throw new Error(`Unknown command: ${cli.command}\n\n${usage.trim()}`);
};
// The CLI is always the single-user path; bind the default (flat-file) tenant
// for the whole run so session/state resolution matches historical behaviour.
(0, context_1.runWithTenant)((0, context_1.defaultContext)(), main).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});
