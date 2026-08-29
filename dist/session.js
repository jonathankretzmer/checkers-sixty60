"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = exports.hydrateAuth = exports.withReauthHint = exports.completeOtpForPhone = exports.requestOtpForPhone = exports.savePendingAuth = exports.toAuthState = exports.toLoginContext = void 0;
const api_1 = require("./api");
const context_1 = require("./context");
const http_1 = require("./http");
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
const toAuthState = (context, bffToken, otpReference) => {
    return {
        phoneE164: context.phoneE164,
        bffToken,
        userAccessToken: context.accessToken,
        refreshToken: context.refreshToken,
        otpReference,
        customerId: context.customerId,
        userId: context.userId,
        email: context.email,
        storeIds: context.storeIds,
        savedAt: new Date().toISOString(),
    };
};
exports.toAuthState = toAuthState;
const savePendingAuth = async (phoneE164, bffToken, customerId, reference) => {
    const { store } = (0, context_1.currentTenant)();
    return store.lock("auth", async () => {
        const existing = await store.readAuth();
        const next = {
            ...(existing ?? { phoneE164, savedAt: new Date().toISOString() }),
            phoneE164,
            bffToken,
            customerId,
            otpReference: reference,
            savedAt: new Date().toISOString(),
        };
        await store.writeAuth(next);
        return next;
    });
};
exports.savePendingAuth = savePendingAuth;
const requestOtpForPhone = async (phoneRaw) => {
    const started = await (0, api_1.startOtpFlow)(phoneRaw);
    await (0, exports.savePendingAuth)(started.phoneE164, started.bffToken, started.customerId, started.reference);
    return { phoneE164: started.phoneE164, reference: started.reference };
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
        if (!phoneFromState || !bffToken || !customerId || !otpReference) {
            throw new Error("Missing pending auth context. Run request-otp first (or pass --reference).");
        }
        const login = await (0, api_1.completeOtpFlow)(phone, customerId, bffToken, otpReference, otpCode);
        const state = (0, exports.toAuthState)(login, bffToken, otpReference);
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
