"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectDeliveryAddress = exports.listSavedAddresses = exports.requireAuth = exports.getConfigSummary = exports.hydrateAuth = exports.withReauthHint = exports.completeOtpForPhone = exports.requestOtpForPhone = exports.savePendingAuth = exports.toAuthState = exports.toLoginContext = void 0;
const api_1 = require("./api");
const config_1 = require("./config");
const context_1 = require("./context");
const crypto_1 = require("./crypto");
const http_1 = require("./http");
const tenant_state_1 = require("./tenant-state");
const toLoginContext = (auth) => {
    if (!auth.customerId ||
        !auth.userId ||
        !auth.email ||
        !auth.userAccessToken ||
        !auth.storeIds) {
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
exports.toLoginContext = toLoginContext;
// Best-effort DeliveryContext from a raw (already-persisted) AuthState — no
// hydration / network. Returns null when the stored session lacks the fields
// the addresses call needs, so callers can degrade gracefully.
const toDeliveryContext = (auth) => {
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
const toAuthState = (context, bffToken, otpReference, otpIdentifier) => {
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
exports.toAuthState = toAuthState;
const savePendingAuth = async (phoneE164, bffToken, customerId, reference, otpIdentifier) => {
    const { store } = (0, context_1.currentTenant)();
    return store.lock("auth", async () => {
        const existing = await store.readAuth();
        const next = {
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
exports.savePendingAuth = savePendingAuth;
const requestOtpForPhone = async (phoneRaw) => {
    const started = await (0, api_1.startOtpFlow)(phoneRaw);
    await (0, exports.savePendingAuth)(started.phoneE164, started.bffToken, started.customerId, started.reference, started.otpIdentifier);
    return {
        phoneE164: started.phoneE164,
        reference: started.reference,
        otpIdentifier: started.otpIdentifier,
    };
};
exports.requestOtpForPhone = requestOtpForPhone;
const completeOtpForPhone = async (phone, otpCode, reference) => {
    const { store } = (0, context_1.currentTenant)();
    return store.lock("auth", async () => {
        const existing = await store.readAuth();
        const phoneFromState = existing?.phoneE164;
        const bffToken = existing?.bffToken;
        const customerId = existing?.customerId;
        const otpReference = reference ?? existing?.otpReference;
        const otpIdentifier = existing?.otpIdentifier;
        if (!phoneFromState || !bffToken || !customerId || !otpReference) {
            throw new Error("Missing pending auth context. Run request-otp first (or pass --reference).");
        }
        const login = await (0, api_1.completeOtpFlow)(phone, customerId, bffToken, otpReference, otpCode, otpIdentifier);
        const state = (0, exports.toAuthState)(login, bffToken, otpReference, otpIdentifier);
        await store.writeAuth(state);
        return state;
    });
};
exports.completeOtpForPhone = completeOtpForPhone;
const REAUTH_MESSAGE = "Access token expired or invalid. Re-authenticate with 'checkers-sixty60 login' (or request_otp/verify_otp).";
// Checkers rejects an expired/invalid access token with 401 or 403; there is
// no refresh-token exchange implemented upstream, so the only recovery path
// is running the OTP flow again. This turns that opaque HTTP failure into an
// actionable message for both the CLI and MCP callers.
const withReauthHint = async (fn) => {
    try {
        return await fn();
    }
    catch (error) {
        if (error instanceof http_1.HttpError && (error.status === 401 || error.status === 403)) {
            throw new Error(REAUTH_MESSAGE);
        }
        throw error;
    }
};
exports.withReauthHint = withReauthHint;
// Fills in any missing derived context (bff token, customer id, profile, store
// ids) and persists the result. Callers hold the tenant lock (see requireAuth).
const hydrateAuth = async (auth) => {
    const { store } = (0, context_1.currentTenant)();
    const next = { ...auth };
    if (!next.bffToken) {
        next.bffToken = await (0, api_1.getBffToken)();
    }
    if (!next.customerId) {
        next.customerId = await (0, api_1.verifyUser)(next.phoneE164, next.bffToken);
    }
    if (!next.userAccessToken) {
        throw new Error("Missing user access token. Run login first.");
    }
    const accessToken = next.userAccessToken;
    const customerId = next.customerId;
    if (!next.userId || !next.email) {
        const profile = await (0, exports.withReauthHint)(() => (0, api_1.getCustomerProfile)(customerId, accessToken, next.phoneE164));
        next.userId = profile.userId;
        next.email = profile.email;
    }
    if (!next.storeIds || next.storeIds.length === 0) {
        const userId = next.userId;
        const email = next.email;
        next.storeIds = await (0, exports.withReauthHint)(() => (0, api_1.getStoreIds)(accessToken, next.phoneE164, userId, customerId, email));
    }
    next.savedAt = new Date().toISOString();
    await store.writeAuth(next);
    return next;
};
exports.hydrateAuth = hydrateAuth;
// A redacted snapshot of local configuration and session state so a user can
// confirm which account / address the CLI (or MCP server) will act as.
// Deliberately omits every secret: access / refresh / bff tokens, the OTP
// reference, and the API credential values (only their presence is reported).
// Does not hydrate auth or mint a device id; when a saved session is present it
// does one lightweight read-only call to resolve the active delivery address,
// degrading to `location.note` if that is not possible.
const resolveActiveAddressForConfig = async (auth, pinnedAddressId) => {
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
        const a = await (0, api_1.resolveDeliveryAddress)(delivery);
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
    }
    catch (error) {
        return {
            pinnedAddressId,
            active: null,
            note: error instanceof Error ? error.message : String(error),
        };
    }
};
const getConfigSummary = async () => {
    const ctx = (0, context_1.currentTenant)();
    const auth = await ctx.store.readAuth();
    const pinnedAddressId = await (0, tenant_state_1.readSelectedAddressId)();
    const deviceId = await (0, tenant_state_1.readDeviceId)();
    const location = await resolveActiveAddressForConfig(auth, pinnedAddressId);
    return {
        dataDir: config_1.DATA_DIR_PATH,
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
            SIXTY60_API_KEY: Boolean(config_1.SIXTY60_API_KEY),
            SIXTY60_API_KEY_AUTH: Boolean(config_1.SIXTY60_API_KEY_AUTH),
            SIXTY60_PROFILE_TOKEN: Boolean(config_1.SIXTY60_PROFILE_TOKEN),
        },
        stateEncryption: (0, crypto_1.encryptionEnabled)(),
    };
};
exports.getConfigSummary = getConfigSummary;
const requireAuth = async () => {
    const { store } = (0, context_1.currentTenant)();
    return store.lock("auth", async () => {
        const auth = await store.readAuth();
        if (!auth) {
            throw new Error("No local auth found. Run login first.");
        }
        return (0, exports.hydrateAuth)(auth);
    });
};
exports.requireAuth = requireAuth;
// Read-only listing of the delivery addresses already saved on the Checkers
// account, normalized and sorted most-recently-used first. Adding / editing
// addresses is intentionally out of scope — do that in the Sixty60 app.
const listSavedAddresses = async () => {
    const auth = await (0, exports.requireAuth)();
    const raw = await (0, exports.withReauthHint)(() => (0, api_1.fetchAddresses)((0, exports.toLoginContext)(auth)));
    return raw
        .map(api_1.normalizeAddress)
        .sort((a, b) => (b.lastUsedOn ?? 0) - (a.lastUsedOn ?? 0));
};
exports.listSavedAddresses = listSavedAddresses;
// Choose which Checkers-account address supplies delivery coordinates. With an
// id: pin that address. Without: clear the pin so the account's
// most-recently-used address is followed automatically.
const selectDeliveryAddress = async (addressId) => {
    const addresses = await (0, exports.listSavedAddresses)();
    if (addresses.length === 0) {
        throw new Error("No delivery addresses saved on this Checkers account. Add one in the Sixty60 app first.");
    }
    if (!addressId) {
        await (0, tenant_state_1.clearSelectedAddress)();
        // listSavedAddresses is sorted most-recently-used first.
        return { address: addresses[0], selection: "last-used" };
    }
    const chosen = addresses.find((a) => a.id === addressId);
    if (!chosen) {
        throw new Error(`No saved address matches id ${JSON.stringify(addressId)}. Run 'checkers-sixty60 addresses' to list them.`);
    }
    if (chosen.latitude === undefined || chosen.longitude === undefined) {
        throw new Error(`Saved address ${JSON.stringify(chosen.label ?? chosen.id)} has no coordinates on file; pick another.`);
    }
    await (0, tenant_state_1.writeSelectedAddressId)(addressId);
    return { address: chosen, selection: "pinned" };
};
exports.selectDeliveryAddress = selectDeliveryAddress;
