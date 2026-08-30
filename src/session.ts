import {
  type DeliveryContext,
  type LoginContext,
  type NormalizedAddress,
  completeOtpFlow,
  fetchAddresses,
  getBffToken,
  getCustomerProfile,
  getStoreIds,
  normalizeAddress,
  resolveDeliveryAddress,
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
import { HttpError } from "./http";
import type { AuthState } from "./storage";
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
