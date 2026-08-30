#!/usr/bin/env node

// Load `.env` from the working directory (no-op if absent) before any module
// reads process.env. Harmless under bun / Docker env_file, which set the
// environment another way.
import "dotenv/config";
import { input, password, select } from "@inquirer/prompts";
import {
  addToBasket,
  completeOtpFlow,
  fetchOrders,
  removeFromBasket,
  searchProducts,
  startOtpFlow,
  viewCart,
} from "./api";
import { AUTH_FILE, SETTINGS_FILE } from "./config";
import { currentTenant, defaultContext, runWithTenant } from "./context";
import { toCompactCarts, toCompactOrders, toCompactSearchResults } from "./format";
import { runMcpServer } from "./mcp-server";
import {
  completeOtpForPhone,
  getConfigSummary,
  listSavedAddresses,
  requestOtpForPhone,
  requireAuth,
  selectDeliveryAddress,
  toAuthState,
  toLoginContext,
  withReauthHint,
} from "./session";
import type { AuthState } from "./storage";
import { readSelectedAddressId } from "./tenant-state";

type ParsedCli = {
  command?: string;
  phone?: string;
  otp?: string;
  reference?: string;
  query?: string;
  productId?: string;
  cartId?: string;
  addressId?: string;
  page?: number;
  size?: number;
  qty?: number;
  port?: number;
  json: boolean;
  compact: boolean;
  http: boolean;
  help: boolean;
  lastUsed: boolean;
};

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
  checkers-sixty60 add-to-basket --product-id 5d3af63cf434cf8420737e3e --qty 1
  checkers-sixty60 remove-from-basket --product-id 5d3af63cf434cf8420737e3e
`;

const parseCliArgs = (): ParsedCli => {
  const args = process.argv.slice(2);
  const first = args[0];
  const command = first && !first.startsWith("-") ? first : undefined;

  const getFlag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    if (index === -1 || index + 1 >= args.length) {
      return undefined;
    }
    return args[index + 1];
  };

  const getNumberFlag = (name: string): number | undefined => {
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
    qty: getNumberFlag("--qty"),
    port: getNumberFlag("--port"),
    json: args.includes("--json"),
    compact: args.includes("--compact"),
    http: args.includes("--http"),
    help: args.includes("--help") || args.includes("-h"),
    lastUsed: args.includes("--last-used"),
  };
};

const ensurePhone = (phone?: string): string => {
  if (!phone) {
    throw new Error("Missing required --phone option");
  }
  return phone;
};

const ensureOtp = (otp?: string): string => {
  if (!otp) {
    throw new Error("Missing required --otp option");
  }
  return otp;
};

const ensureQuery = (query?: string): string => {
  if (!query) {
    throw new Error("Missing required --query option");
  }
  return query;
};

const ensureProductId = (productId?: string): string => {
  if (!productId) {
    throw new Error("Missing required --product-id option");
  }
  return productId;
};

const ensureQuantity = (qty?: number): number => {
  const value = qty ?? 1;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--qty must be a positive integer");
  }
  return value;
};

const ensureOptionalQuantity = (qty?: number): number | undefined => {
  if (qty === undefined) {
    return undefined;
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("--qty must be a positive integer");
  }
  return qty;
};

const startOtpForPhone = async (phone: string): Promise<void> => {
  const result = await requestOtpForPhone(phone);
  console.log(`OTP sent to ${result.phoneE164}`);
  console.log(`Reference: ${result.reference}`);
  console.log(
    result.otpIdentifier
      ? `Verify identifier: ${result.otpIdentifier}`
      : "Verify identifier: not returned; verify will try +27…, 27…, then 0… formats",
  );
};

const runInteractiveLogin = async (): Promise<AuthState> => {
  const phone = await input({ message: "Phone number (e.g. 0821234567):" });
  const otpStart = await startOtpFlow(phone);

  console.log(`OTP sent to ${otpStart.phoneE164}`);
  const otp = await password({ message: "Enter OTP:" });

  const login = await completeOtpFlow(
    otpStart.phoneE164,
    otpStart.customerId,
    otpStart.bffToken,
    otpStart.reference,
    otp,
    otpStart.otpIdentifier,
  );

  const state = toAuthState(
    login,
    otpStart.bffToken,
    otpStart.reference,
    otpStart.otpIdentifier,
  );
  await currentTenant().store.writeAuth(state);
  return state;
};

const runOrders = async (
  jsonOnly: boolean,
  compact: boolean,
): Promise<void> => {
  const auth = await requireAuth();
  const orders = await withReauthHint(() => fetchOrders(toLoginContext(auth)));

  if (compact) {
    const compactOrders = toCompactOrders(orders);
    console.log(JSON.stringify(compactOrders, null, 2));
    return;
  }

  if (!jsonOnly) {
    console.log("Fetched orders successfully.");
  }
  console.log(JSON.stringify(orders, null, 2));
};

const runSearch = async (
  query: string,
  page: number,
  size: number,
  compact: boolean,
): Promise<void> => {
  const auth = await requireAuth();
  const results = await withReauthHint(() =>
    searchProducts(toLoginContext(auth), query, page, size),
  );
  if (compact) {
    console.log(JSON.stringify(toCompactSearchResults(results), null, 2));
    return;
  }

  console.log(JSON.stringify(results, null, 2));
};

const runAddToBasket = async (
  productId: string,
  qty: number,
  cartId?: string,
): Promise<void> => {
  const auth = await requireAuth();
  const result = await withReauthHint(() =>
    addToBasket(toLoginContext(auth), productId, qty, cartId),
  );
  console.log(JSON.stringify(result, null, 2));
};

const runRemoveFromBasket = async (
  productId: string,
  qty: number | undefined,
  cartId?: string,
): Promise<void> => {
  const auth = await requireAuth();
  const result = await withReauthHint(() =>
    removeFromBasket(toLoginContext(auth), productId, qty, cartId),
  );
  console.log(JSON.stringify(result, null, 2));
};

const runViewCart = async (compact: boolean): Promise<void> => {
  const auth = await requireAuth();
  const result = await withReauthHint(() => viewCart(toLoginContext(auth)));
  console.log(JSON.stringify(compact ? toCompactCarts(result) : result, null, 2));
};

const runSetLocation = async (cli: ParsedCli): Promise<void> => {
  if (cli.addressId === undefined && !cli.lastUsed) {
    throw new Error(
      "set-location needs --address-id <id> (pin a saved Checkers address) or --last-used (follow the account's most-recently-used address). List them with 'checkers-sixty60 addresses'.",
    );
  }

  const { address, selection } = await selectDeliveryAddress(cli.addressId);
  const where = address.fullAddress ? ` — ${address.fullAddress}` : "";
  if (selection === "pinned") {
    console.log(
      `Pinned delivery address ${JSON.stringify(address.label ?? address.id)}${where}`,
    );
    console.log(`  ${address.latitude}, ${address.longitude}`);
    console.log(`Selection saved to ${SETTINGS_FILE}`);
  } else {
    console.log(
      `Cleared the pin. The account's most-recently-used address will be used automatically (currently ${JSON.stringify(address.label ?? address.id)}${where}).`,
    );
  }
};

const runConfig = async (): Promise<void> => {
  const summary = await getConfigSummary();
  console.log(JSON.stringify(summary, null, 2));
};

const runAddresses = async (jsonOnly: boolean): Promise<void> => {
  const [addresses, pinnedId] = await Promise.all([
    listSavedAddresses(),
    readSelectedAddressId(),
  ]);

  if (jsonOnly) {
    console.log(JSON.stringify(addresses, null, 2));
    return;
  }

  if (addresses.length === 0) {
    console.log(
      "No delivery addresses saved on this Checkers account. Add one in the Sixty60 app.",
    );
    return;
  }

  // Which address delivery calls will actually use right now.
  const activeId =
    pinnedId && addresses.some((a) => a.id === pinnedId)
      ? pinnedId
      : addresses[0]?.id;

  for (const a of addresses) {
    const coords =
      a.latitude !== undefined && a.longitude !== undefined
        ? `${a.latitude}, ${a.longitude}`
        : "(no coordinates on file)";
    const marker =
      a.id === activeId
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
  console.log(
    "\nPin one with:   checkers-sixty60 set-location --address-id <id>\nFollow latest:  checkers-sixty60 set-location --last-used",
  );
};

const runInteractiveMenu = async (): Promise<void> => {
  const action = await select({
    message: "Select action",
    choices: [
      { value: "login", name: "Interactive login (phone + OTP)" },
      { value: "orders", name: "Fetch my orders" },
    ],
  });

  if (action === "login") {
    const state = await runInteractiveLogin();
    console.log(`Saved auth state to ${AUTH_FILE} for ${state.phoneE164}`);
    return;
  }

  await runOrders(false, false);
};

const main = async (): Promise<void> => {
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
    await runMcpServer();
    return;
  }

  if (cli.command === "login") {
    if (!cli.phone && !cli.otp) {
      const state = await runInteractiveLogin();
      console.log(`Saved auth state to ${AUTH_FILE} for ${state.phoneE164}`);
      return;
    }

    if (cli.phone && !cli.otp) {
      await startOtpForPhone(ensurePhone(cli.phone));
      return;
    }

    const state = await completeOtpForPhone(
      ensurePhone(cli.phone),
      ensureOtp(cli.otp),
      cli.reference,
    );
    console.log(`Saved auth state to ${AUTH_FILE} for ${state.phoneE164}`);
    return;
  }

  if (cli.command === "request-otp") {
    await startOtpForPhone(ensurePhone(cli.phone));
    return;
  }

  if (cli.command === "verify-otp") {
    const state = await completeOtpForPhone(
      ensurePhone(cli.phone),
      ensureOtp(cli.otp),
      cli.reference,
    );
    console.log(`Saved auth state to ${AUTH_FILE} for ${state.phoneE164}`);
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
    await runSearch(
      ensureQuery(cli.query),
      cli.page ?? 0,
      cli.size ?? 20,
      cli.compact,
    );
    return;
  }

  if (cli.command === "add-to-basket") {
    await runAddToBasket(
      ensureProductId(cli.productId),
      ensureQuantity(cli.qty),
      cli.cartId,
    );
    return;
  }

  if (cli.command === "remove-from-basket") {
    await runRemoveFromBasket(
      ensureProductId(cli.productId),
      ensureOptionalQuantity(cli.qty),
      cli.cartId,
    );
    return;
  }

  throw new Error(`Unknown command: ${cli.command}\n\n${usage.trim()}`);
};

// The CLI is always the single-user path; bind the default (flat-file) tenant
// for the whole run so session/state resolution matches historical behaviour.
runWithTenant(defaultContext(), main).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
