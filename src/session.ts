import {
  type DeliveryContext,
  type LoginContext,
  type NormalizedAddress,
  completeOtpFlow,
  fetchAddresses,
  fetchMyProductScores,
  getBffToken,
  getCustomerProfile,
  getStoreIds,
  hydrateProducts,
  normalizeAddress,
  resolveDeliveryAddress,
  searchProducts,
  startOtpFlow,
  verifyUser,
} from "./api";
import {
  DATA_DIR_PATH,
  SIXTY60_API_KEY,
  SIXTY60_API_KEY_AUTH,
  SIXTY60_PROFILE_TOKEN,
} from "./config";
import { currentTenant } from "./context";
import { encryptionEnabled } from "./crypto";
import {
  type CompactProduct,
  type MyProduct,
  matchCachedMyProducts,
  mergeMyProducts,
  toCompactSearchResults,
} from "./format";
import { HttpError } from "./http";
import type { AuthState, MyProductsCache } from "./storage";
import {
  clearSelectedAddress,
  readDeviceId,
  readSelectedAddressId,
  writeSelectedAddressId,
} from "./tenant-state";

export const toLoginContext = (auth: AuthState): LoginContext => {
  if (
    !auth.customerId ||
    !auth.userId ||
    !auth.email ||
    !auth.userAccessToken ||
    !auth.storeIds
  ) {
    throw new Error("Auth context is incomplete. Run login first.");
  }

  return {
    phoneE164: auth.phoneE164,
    customerId: auth.customerId,
    userId: auth.userId,
    email: auth.email,
    accessToken: auth.userAccessToken,
    refreshToken: auth.refreshToken,
    storeIds: auth.storeIds,
  };
};

// Best-effort DeliveryContext from a raw (already-persisted) AuthState — no
// hydration / network. Returns null when the stored session lacks the fields
// the addresses call needs, so callers can degrade gracefully.
const toDeliveryContext = (auth: AuthState | null): DeliveryContext | null => {
  if (!auth?.userAccessToken || !auth.customerId || !auth.userId || !auth.email) {
    return null;
  }
  return {
    phoneE164: auth.phoneE164,
    customerId: auth.customerId,
    userId: auth.userId,
    email: auth.email,
    accessToken: auth.userAccessToken,
    storeIds: auth.storeIds,
  };
};

export const toAuthState = (
  context: LoginContext,
  bffToken: string,
  otpReference: string,
  otpIdentifier?: string,
): AuthState => {
  return {
    phoneE164: context.phoneE164,
    bffToken,
    userAccessToken: context.accessToken,
    refreshToken: context.refreshToken,
    otpReference,
    otpIdentifier,
    customerId: context.customerId,
    userId: context.userId,
    email: context.email,
    storeIds: context.storeIds,
    savedAt: new Date().toISOString(),
  };
};

export const savePendingAuth = async (
  phoneE164: string,
  bffToken: string,
  customerId: string,
  reference: string,
  otpIdentifier?: string,
): Promise<AuthState> => {
  const { store } = currentTenant();
  return store.lock("auth", async () => {
    const existing = await store.readAuth();
    const next: AuthState = {
      ...(existing ?? { phoneE164, savedAt: new Date().toISOString() }),
      phoneE164,
      bffToken,
      customerId,
      otpReference: reference,
      otpIdentifier,
      savedAt: new Date().toISOString(),
    };
    await store.writeAuth(next);
    return next;
  });
};

export const requestOtpForPhone = async (
  phoneRaw: string,
): Promise<{ phoneE164: string; reference: string; otpIdentifier?: string }> => {
  const started = await startOtpFlow(phoneRaw);
  await savePendingAuth(
    started.phoneE164,
    started.bffToken,
    started.customerId,
    started.reference,
    started.otpIdentifier,
  );
  return {
    phoneE164: started.phoneE164,
    reference: started.reference,
    otpIdentifier: started.otpIdentifier,
  };
};

export const completeOtpForPhone = async (
  phone: string,
  otpCode: string,
  reference?: string,
): Promise<AuthState> => {
  const { store } = currentTenant();
  return store.lock("auth", async () => {
    const existing = await store.readAuth();

    const phoneFromState = existing?.phoneE164;
    const bffToken = existing?.bffToken;
    const customerId = existing?.customerId;
    const otpReference = reference ?? existing?.otpReference;
    const otpIdentifier = existing?.otpIdentifier;

    if (!phoneFromState || !bffToken || !customerId || !otpReference) {
      throw new Error(
        "Missing pending auth context. Run request-otp first (or pass --reference).",
      );
    }

    const login = await completeOtpFlow(
      phone,
      customerId,
      bffToken,
      otpReference,
      otpCode,
      otpIdentifier,
    );

    const state = toAuthState(login, bffToken, otpReference, otpIdentifier);
    await store.writeAuth(state);
    return state;
  });
};

const REAUTH_MESSAGE =
  "Access token expired or invalid. Re-authenticate with 'checkers-sixty60 login' (or request_otp/verify_otp).";

// Checkers rejects an expired/invalid access token with 401 or 403; there is
// no refresh-token exchange implemented upstream, so the only recovery path
// is running the OTP flow again. This turns that opaque HTTP failure into an
// actionable message for both the CLI and MCP callers.
export const withReauthHint = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      throw new Error(REAUTH_MESSAGE);
    }
    throw error;
  }
};

// Fills in any missing derived context (bff token, customer id, profile, store
// ids) and persists the result. Callers hold the tenant lock (see requireAuth).
export const hydrateAuth = async (auth: AuthState): Promise<AuthState> => {
  const { store } = currentTenant();
  const next = { ...auth };

  if (!next.bffToken) {
    next.bffToken = await getBffToken();
  }

  if (!next.customerId) {
    next.customerId = await verifyUser(next.phoneE164, next.bffToken);
  }

  if (!next.userAccessToken) {
    throw new Error("Missing user access token. Run login first.");
  }

  const accessToken = next.userAccessToken;
  const customerId = next.customerId;

  if (!next.userId || !next.email) {
    const profile = await withReauthHint(() =>
      getCustomerProfile(customerId, accessToken, next.phoneE164),
    );
    next.userId = profile.userId;
    next.email = profile.email;
  }

  if (!next.storeIds || next.storeIds.length === 0) {
    const userId = next.userId;
    const email = next.email;
    next.storeIds = await withReauthHint(() =>
      getStoreIds(accessToken, next.phoneE164, userId, customerId, email),
    );
  }

  next.savedAt = new Date().toISOString();
  await store.writeAuth(next);
  return next;
};

export type ConfigSummary = {
  dataDir: string;
  tenant: string;
  account: {
    loggedIn: boolean;
    phoneE164?: string;
    email?: string;
    customerId?: string;
    userId?: string;
    storeIds?: string[];
    savedAt?: string;
  };
  // Which Checkers-account address supplies delivery coordinates.
  // `pinnedAddressId` null => the account's most-recently-used address is used.
  // `active` is the resolved address (label, formatted address, coordinates)
  // when it could be looked up; otherwise `note` explains why not.
  location: {
    pinnedAddressId: string | null;
    active: {
      id: string;
      label?: string;
      fullAddress?: string;
      suburb?: string;
      city?: string;
      latitude: number;
      longitude: number;
      selection: "pinned" | "last-used";
    } | null;
    note?: string;
  };
  deviceId: string | null;
  // Presence only — never the values. `false` means the login/OTP flow will
  // fail until the corresponding env var / .env entry is supplied.
  apiCredentials: {
    SIXTY60_API_KEY: boolean;
    SIXTY60_API_KEY_AUTH: boolean;
    SIXTY60_PROFILE_TOKEN: boolean;
  };
  stateEncryption: boolean;
};

// A redacted snapshot of local configuration and session state so a user can
// confirm which account / address the CLI (or MCP server) will act as.
// Deliberately omits every secret: access / refresh / bff tokens, the OTP
// reference, and the API credential values (only their presence is reported).
// Does not hydrate auth or mint a device id; when a saved session is present it
// does one lightweight read-only call to resolve the active delivery address,
// degrading to `location.note` if that is not possible.
const resolveActiveAddressForConfig = async (
  auth: AuthState | null,
  pinnedAddressId: string | null,
): Promise<ConfigSummary["location"]> => {
  const delivery = toDeliveryContext(auth);
  if (!delivery) {
    return {
      pinnedAddressId,
      active: null,
      note: auth?.userAccessToken
        ? "Session context is incomplete; run login again to resolve the active address."
        : "Not logged in — run login to resolve the active delivery address.",
    };
  }

  try {
    const a = await resolveDeliveryAddress(delivery);
    return {
      pinnedAddressId,
      active: {
        id: a.id,
        label: a.label,
        fullAddress: a.fullAddress,
        suburb: a.suburb,
        city: a.city,
        latitude: a.latitude,
        longitude: a.longitude,
        selection: a.selection,
      },
    };
  } catch (error) {
    return {
      pinnedAddressId,
      active: null,
      note: error instanceof Error ? error.message : String(error),
    };
  }
};

export const getConfigSummary = async (): Promise<ConfigSummary> => {
  const ctx = currentTenant();
  const auth = await ctx.store.readAuth();
  const pinnedAddressId = await readSelectedAddressId();
  const deviceId = await readDeviceId();

  const location = await resolveActiveAddressForConfig(auth, pinnedAddressId);

  return {
    dataDir: DATA_DIR_PATH,
    tenant: ctx.tenantId,
    account: {
      loggedIn: Boolean(auth?.userAccessToken),
      phoneE164: auth?.phoneE164,
      email: auth?.email,
      customerId: auth?.customerId,
      userId: auth?.userId,
      storeIds: auth?.storeIds,
      savedAt: auth?.savedAt,
    },
    location,
    deviceId,
    apiCredentials: {
      SIXTY60_API_KEY: Boolean(SIXTY60_API_KEY),
      SIXTY60_API_KEY_AUTH: Boolean(SIXTY60_API_KEY_AUTH),
      SIXTY60_PROFILE_TOKEN: Boolean(SIXTY60_PROFILE_TOKEN),
    },
    stateEncryption: encryptionEnabled(),
  };
};

export const requireAuth = async (): Promise<AuthState> => {
  const { store } = currentTenant();
  return store.lock("auth", async () => {
    const auth = await store.readAuth();
    if (!auth) {
      throw new Error("No local auth found. Run login first.");
    }
    return hydrateAuth(auth);
  });
};

// Read-only listing of the delivery addresses already saved on the Checkers
// account, normalized and sorted most-recently-used first. Adding / editing
// addresses is intentionally out of scope — do that in the Sixty60 app.
export const listSavedAddresses = async (): Promise<NormalizedAddress[]> => {
  const auth = await requireAuth();
  const raw = await withReauthHint(() => fetchAddresses(toLoginContext(auth)));
  return raw
    .map(normalizeAddress)
    .sort((a, b) => (b.lastUsedOn ?? 0) - (a.lastUsedOn ?? 0));
};

export type DeliverySelection = {
  address: NormalizedAddress;
  selection: "pinned" | "last-used";
};

// Choose which Checkers-account address supplies delivery coordinates. With an
// id: pin that address. Without: clear the pin so the account's
// most-recently-used address is followed automatically.
export const selectDeliveryAddress = async (
  addressId?: string,
): Promise<DeliverySelection> => {
  const addresses = await listSavedAddresses();
  if (addresses.length === 0) {
    throw new Error(
      "No delivery addresses saved on this Checkers account. Add one in the Sixty60 app first.",
    );
  }

  if (!addressId) {
    await clearSelectedAddress();
    // listSavedAddresses is sorted most-recently-used first.
    return { address: addresses[0], selection: "last-used" };
  }

  const chosen = addresses.find((a) => a.id === addressId);
  if (!chosen) {
    throw new Error(
      `No saved address matches id ${JSON.stringify(addressId)}. Run 'checkers-sixty60 addresses' to list them.`,
    );
  }
  if (chosen.latitude === undefined || chosen.longitude === undefined) {
    throw new Error(
      `Saved address ${JSON.stringify(chosen.label ?? chosen.id)} has no coordinates on file; pick another.`,
    );
  }

  await writeSelectedAddressId(addressId);
  return { address: chosen, selection: "pinned" };
};

// --- Personalised "my products" (previously ordered, ranked) -----------------

// How many top-scored products to hydrate with name/price/stock and cache.
// The upstream score list runs to hundreds of entries; the top slice covers a
// household's actual repertoire while keeping the cache and the single
// hydration call small.
const MY_PRODUCTS_HYDRATE_LIMIT = 100;

// A cache older than this (or fetched for different store ids) is refreshed by
// `findProduct` before it is used. `refreshMyProducts` always ignores it.
const MY_PRODUCTS_TTL_MS = 24 * 60 * 60 * 1000;

const sameStoreIds = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
};

const myProductsCacheStale = (
  cache: MyProductsCache,
  storeIds: string[],
): boolean =>
  Number.isNaN(Date.parse(cache.fetchedAt)) ||
  Date.now() - Date.parse(cache.fetchedAt) > MY_PRODUCTS_TTL_MS ||
  !sameStoreIds(cache.storeIds, storeIds);

// Fetch the score list, hydrate the top slice, cache it, return it. Always hits
// the network — this is the "get the latest" path behind the `my-products`
// command / `list_my_products` tool. Pass `context` to reuse an already
// hydrated auth (findProduct does); otherwise it calls requireAuth itself.
export const refreshMyProducts = async (
  opts: { limit?: number; context?: LoginContext } = {},
): Promise<MyProductsCache> => {
  const context = opts.context ?? toLoginContext(await requireAuth());
  const limit = Math.max(opts.limit ?? MY_PRODUCTS_HYDRATE_LIMIT, 0);

  const scores = await withReauthHint(() => fetchMyProductScores(context));
  const top = scores.slice(0, limit);
  const hydrated = await withReauthHint(() =>
    hydrateProducts(
      context,
      top.map((entry) => entry.productId),
    ),
  );
  const products = mergeMyProducts(top, hydrated);

  const cache: MyProductsCache = {
    products,
    fetchedAt: new Date().toISOString(),
    storeIds: context.storeIds,
    totalScored: scores.length,
    hydrated: products.length,
  };
  await currentTenant().store.writeMyProductsCache(cache);
  return cache;
};

const loadMyProducts = async (
  context: LoginContext,
  opts: { refresh?: boolean; limit?: number },
): Promise<{ cache: MyProductsCache; source: "fresh" | "cache" }> => {
  if (!opts.refresh) {
    const cached = await currentTenant().store.readMyProductsCache();
    if (cached && !myProductsCacheStale(cached, context.storeIds)) {
      return { cache: cached, source: "cache" };
    }
  }
  return {
    cache: await refreshMyProducts({ context, limit: opts.limit }),
    source: "fresh",
  };
};

export type FindProductResult = {
  query: string;
  myProducts: {
    // "cache" = served from the stored snapshot; "fresh" = (re)fetched now
    // because it was missing, older than 24h, for different store ids, or
    // a refresh was forced.
    source: "fresh" | "cache";
    fetchedAt: string;
    totalScored: number;
    matches: MyProduct[];
  };
  search: {
    resultCount: number;
    results: CompactProduct[];
  };
  recommendation: string;
};

// One call for an add-to-cart decision: name-match the query against the cached
// personalised list AND run a fresh catalog search, returned together so an
// agent can prefer a previously-ordered item and fall back to search without a
// second round-trip.
export const findProduct = async (
  query: string,
  opts: {
    matchLimit?: number;
    searchSize?: number;
    refreshMyProducts?: boolean;
  } = {},
): Promise<FindProductResult> => {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("find-product needs a non-empty query.");
  }

  const context = toLoginContext(await requireAuth());
  const matchLimit = opts.matchLimit ?? 10;
  const searchSize = opts.searchSize ?? 20;

  const { cache, source } = await loadMyProducts(context, {
    refresh: opts.refreshMyProducts,
  });
  const matches = matchCachedMyProducts(cache.products, trimmed, matchLimit);

  const searchRaw = await withReauthHint(() =>
    searchProducts(context, trimmed, 0, searchSize),
  );
  const results = toCompactSearchResults(searchRaw);

  const top = matches[0];
  const recommendation = top
    ? `Previously ordered: "${top.name}" (${top.count}x past orders). Add productId ${top.id} unless the user clearly means something else, then fall back to search.results.`
    : "No previously-ordered match; choose from search.results.";

  return {
    query: trimmed,
    myProducts: {
      source,
      fetchedAt: cache.fetchedAt,
      totalScored: cache.totalScored,
      matches,
    },
    search: { resultCount: results.length, results },
    recommendation,
  };
};
