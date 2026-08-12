#!/usr/bin/env node

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
import { toCompactCarts, toCompactOrders, toCompactSearchResults } from "./format";
import { runMcpServer } from "./mcp-server";
import {
  completeOtpForPhone,
  requestOtpForPhone,
  requireAuth,
  toAuthState,
  toLoginContext,
  withReauthHint,
} from "./session";
import { type AuthState, writeJsonFile, writeLocationSettings } from "./storage";

type ParsedCli = {
  command?: string;
  phone?: string;
  otp?: string;
  reference?: string;
  query?: string;
  productId?: string;
  cartId?: string;
  page?: number;
  size?: number;
  qty?: number;
  lat?: number;
  lng?: number;
  json: boolean;
  compact: boolean;
  help: boolean;
};

const usage = `
Usage:
  checkers-sixty60                                Interactive menu
  checkers-sixty60 login                          Interactive login (phone + OTP)
  checkers-sixty60 request-otp --phone <phone>
  checkers-sixty60 verify-otp --phone <phone> --otp <code> [--reference <ref>]
  checkers-sixty60 login --phone <phone> --otp <code> [--reference <ref>]
  checkers-sixty60 orders [--json] [--compact]
  checkers-sixty60 set-location --lat <value> --lng <value>
  checkers-sixty60 view-cart [--compact]
  checkers-sixty60 search --query <text> [--page <n>] [--size <n>] [--compact]
  checkers-sixty60 add-to-basket --product-id <id> [--qty <n>] [--cart-id <id>]
  checkers-sixty60 remove-from-basket --product-id <id> [--qty <n>] [--cart-id <id>]
  checkers-sixty60 mcp                            Run as an MCP server over stdio

Examples:
  checkers-sixty60 request-otp --phone 0821234567
  checkers-sixty60 verify-otp --phone 0821234567 --otp 1234
  checkers-sixty60 orders --json
  checkers-sixty60 orders --compact
  checkers-sixty60 set-location --lat -26.2041 --lng 28.0473
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
    page: getNumberFlag("--page"),
    size: getNumberFlag("--size"),
    qty: getNumberFlag("--qty"),
    lat: getNumberFlag("--lat"),
    lng: getNumberFlag("--lng"),
    json: args.includes("--json"),
    compact: args.includes("--compact"),
    help: args.includes("--help") || args.includes("-h"),
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

const ensureLatitude = (value?: number): number => {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error("Missing required --lat option");
  }
  if (value < -90 || value > 90) {
    throw new Error("--lat must be between -90 and 90");
  }
  return value;
};

const ensureLongitude = (value?: number): number => {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error("Missing required --lng option");
  }
  if (value < -180 || value > 180) {
    throw new Error("--lng must be between -180 and 180");
  }
  return value;
};

const startOtpForPhone = async (phone: string): Promise<void> => {
  const result = await requestOtpForPhone(phone);
  console.log(`OTP sent to ${result.phoneE164}`);
  console.log(`Reference: ${result.reference}`);
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
  );

  const state = toAuthState(login, otpStart.bffToken, otpStart.reference);
  await writeJsonFile(AUTH_FILE, state);
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

const runSetLocation = async (lat: number, lng: number): Promise<void> => {
  const saved = await writeLocationSettings(lat, lng);
  console.log(
    `Saved location ${saved.latitude}, ${saved.longitude} to ${SETTINGS_FILE}`,
  );
  console.log(
    "Env vars SIXTY60_LATITUDE/SIXTY60_LONGITUDE still override saved values when set.",
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

  if (cli.command === "set-location") {
    await runSetLocation(ensureLatitude(cli.lat), ensureLongitude(cli.lng));
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
