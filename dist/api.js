"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewCart = exports.removeFromBasket = exports.addToBasket = exports.hydrateProducts = exports.fetchMyProductScores = exports.searchProducts = exports.fetchOrders = exports.resolveDeliveryAddress = exports.fetchAddresses = exports.normalizeAddress = exports.completeOtpFlow = exports.startOtpFlow = exports.loginFlow = exports.getStoreIds = exports.getCustomerProfile = exports.verifyOtp = exports.requestOtp = exports.verifyUser = exports.getBffToken = void 0;
const config_1 = require("./config");
const http_1 = require("./http");
const logger_1 = require("./logger");
const tenant_state_1 = require("./tenant-state");
const BFF_BASE = "https://dc-app-backend-for-frontend.sixty60.co.za";
const DSL_BASE = "https://api.shopritegroup.co.za/dsl/brands/checkers/countries/ZA";
const AUTH_BASE = "https://auth.sixty60.co.za";
const CATALOG_BASE = "https://catalog.sixty60.co.za";
const ORDERS_BASE = "https://orders-api.sixty60.co.za";
// The Checkers Sixty60 app API credentials are not bundled. They are read from
// the environment (SIXTY60_API_KEY / SIXTY60_API_KEY_AUTH /
// SIXTY60_PROFILE_TOKEN via config.ts) and only the login/OTP/profile calls
// need them — `required` turns a missing value into an actionable error.
const required = (value, name) => {
    if (!value) {
        throw new Error(`${name} is not set. The Checkers Sixty60 app API credentials are not bundled — provide them via environment or a local .env file (see .env.example and the README 'Configuration' section).`);
    }
    return value;
};
const APP_VERSION = "iPadOS 2.0.99 (1769786479)";
const APP_BUILD = "1769786479";
const getLocation = async (ctx) => {
    const address = await (0, exports.resolveDeliveryAddress)(ctx);
    return { latitude: address.latitude, longitude: address.longitude };
};
// The identifier the OTP request echoed back, if any. Returns undefined when
// nothing usable is present so `verifyOtp` knows to try the format candidates.
const pickOtpIdentifier = (response) => {
    const echoed = response?.identifier ??
        response?.target?.identifier ??
        response?.mobileNumber ??
        response?.msisdn ??
        response?.to;
    return typeof echoed === "string" && echoed.trim() ? echoed.trim() : undefined;
};
// Benign response fields that don't warrant the "unexpected extra field" hint.
const KNOWN_OTP_REQUEST_FIELDS = new Set([
    "reference",
    "expiry",
    "expiresIn",
    "ttl",
]);
// Canonical 11-digit SA mobile number, `27XXXXXXXXX` (no `+`). Every request
// shape is derived from this.
const phoneDigits = (value) => {
    const digits = value.replace(/\D+/g, "");
    if (digits.startsWith("27") && digits.length === 11) {
        return digits;
    }
    if (digits.startsWith("0") && digits.length === 10) {
        return `27${digits.slice(1)}`;
    }
    if (digits.length === 9) {
        return `27${digits}`;
    }
    throw new Error("Invalid phone number. Use South African format like 0821234567 or +27821234567.");
};
// E.164, `+27XXXXXXXXX` — what the OTP request query and every `mobileNumber`
// header use.
const normalizePhone = (value) => `+${phoneDigits(value)}`;
// National, `0XXXXXXXXX`.
const toNationalPhone = (value) => `0${phoneDigits(value).slice(2)}`;
// Distinct identifier strings to try in the OTP verify `target.identifier`,
// most-likely first. The verify endpoint keys on the exact string the pending
// challenge was stored under, which is not necessarily the E.164 form.
const otpIdentifierCandidates = (phoneE164) => {
    const seen = new Set();
    const out = [];
    for (const candidate of [
        phoneE164, // +27XXXXXXXXX
        phoneDigits(phoneE164), // 27XXXXXXXXX
        toNationalPhone(phoneE164), // 0XXXXXXXXX
    ]) {
        if (!seen.has(candidate)) {
            seen.add(candidate);
            out.push(candidate);
        }
    }
    return out;
};
const baseHeaders = async (token, phoneE164, storeIds, userId, customerId, email) => {
    const deviceId = await (0, tenant_state_1.getOrCreateDeviceId)();
    const storeIdsJson = JSON.stringify(storeIds);
    const storeIdsCsv = storeIds.join(",");
    const headers = {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        mobileNumber: phoneE164,
        "device-id": deviceId,
        channel: "super-app",
        "app-version": APP_VERSION,
        "channel-os": APP_VERSION,
        appversion: APP_BUILD,
        "istio-appVersion": APP_BUILD,
        storeids: storeIdsJson,
        "istio-storeIds": storeIdsJson,
        "aws-cf-cd-storeid": storeIdsCsv,
    };
    if (userId) {
        headers.UserId = userId;
    }
    if (customerId) {
        headers["customer-id"] = customerId;
    }
    if (email) {
        headers.email = email;
    }
    return headers;
};
const buildStoreContexts = (storeIds) => {
    return storeIds.map((storeId) => ({
        storeId,
        serviceOptionIds: ["sixty-min-delivery"],
        brandPriority: 1,
        hasCapacity: ["sixty-min-delivery"],
    }));
};
const toCartUpdateLineItem = (line) => {
    const productId = line.productId ??
        line.product?.id;
    return {
        id: line.id ?? "",
        productId: productId ?? "",
        storeId: line.storeId ?? "",
        price: line.price ?? 0,
        previousPrice: line.previousPrice ?? 0,
        priceFactor: line.priceFactor ?? 100,
        quantity: line.quantity ?? 1,
        instruction: line.instruction ?? "",
        specialInstruction: line.specialInstruction ??
            line.specialInstructions ??
            "",
        replacementPreferenceId: line.replacementPreferenceId ?? "",
        missionName: line.missionName ?? "",
        missionType: line.missionType ?? "",
        addToBasketType: line.addToBasketType ?? "quick_add",
        addToBasketJourney: line.addToBasketJourney ?? "main_search_results",
        isStockAvailable: line.isStockAvailable ?? true,
        status: line.status ?? "available",
        isSponsoredProduct: line.isSponsoredProduct ?? false,
        serviceOptionId: line.serviceOptionId ?? "sixty-min-delivery",
        hasAlcohol: line.hasAlcohol ?? false,
        requiresOver18: line.requiresOver18 ?? false,
        product: null,
    };
};
const getBffToken = async () => {
    const data = await (0, http_1.http)(`${BFF_BASE}/api/v1/token/dsl`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });
    if (!data.access_token) {
        throw new Error("No access_token from BFF /token/dsl");
    }
    return data.access_token;
};
exports.getBffToken = getBffToken;
const verifyUser = async (phoneE164, bffToken) => {
    const data = await (0, http_1.http)(`${DSL_BASE}/users/verify`, {
        method: "GET",
        headers: {
            ...(await baseHeaders(bffToken, phoneE164, [])),
            "x-api-key": required(config_1.SIXTY60_API_KEY, "SIXTY60_API_KEY"),
        },
    });
    const customerId = data.response?.uid;
    if (!customerId) {
        throw new Error(`No uid returned from /users/verify: ${JSON.stringify(data)}`);
    }
    return customerId;
};
exports.verifyUser = verifyUser;
const requestOtp = async (phoneRaw, bffToken, customerId) => {
    const phoneE164 = normalizePhone(phoneRaw);
    const data = await (0, http_1.http)(`${DSL_BASE}/users/loginbymobile`, {
        method: "GET",
        query: {
            mobileNumber: phoneE164,
        },
        headers: {
            ...(await baseHeaders(bffToken, phoneE164, [], undefined, customerId)),
            "x-api-key": required(config_1.SIXTY60_API_KEY_AUTH, "SIXTY60_API_KEY_AUTH"),
        },
    });
    const reference = data.response?.reference;
    if (!reference) {
        throw new Error(`No OTP reference returned: ${JSON.stringify(data)}`);
    }
    const otpIdentifier = pickOtpIdentifier(data.response);
    if (!otpIdentifier) {
        const unexpected = Object.keys(data.response ?? {}).filter((key) => !KNOWN_OTP_REQUEST_FIELDS.has(key));
        if (unexpected.length > 0) {
            // A new field here might be the identifier verify wants — surface it.
            (0, logger_1.log)(`otp request response carried unrecognised field(s) [${unexpected.join(", ")}]`);
        }
    }
    return { phoneE164, reference, otpIdentifier };
};
exports.requestOtp = requestOtp;
const OTP_ATTEMPT_RE = /\botp\b|expired|attempts?\b/i;
const verifyOtpWithIdentifier = (identifier, reference, otp, bffToken, phoneE164, customerId) => baseHeaders(bffToken, phoneE164, [], undefined, customerId).then((headers) => (0, http_1.http)(`${DSL_BASE}/otp/loginbymobile/verify`, {
    method: "POST",
    headers: {
        ...headers,
        "x-api-key": required(config_1.SIXTY60_API_KEY_AUTH, "SIXTY60_API_KEY_AUTH"),
    },
    body: {
        target: { type: "SMS", identifier, reference },
        otp,
    },
}));
const verifyOtp = async (phoneE164, reference, otp, bffToken, customerId, 
// The exact string the pending OTP challenge is stored under. When the
// request echoed one back (rare), pass it and only it is tried. Otherwise the
// verify endpoint is retried against each SA number format, since it keys on
// that string and it is not necessarily the E.164 form we sent.
identifier) => {
    const candidates = identifier
        ? [identifier]
        : otpIdentifierCandidates(phoneE164);
    const attempts = [];
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const isLast = i === candidates.length - 1;
        try {
            const data = await verifyOtpWithIdentifier(candidate, reference, otp, bffToken, phoneE164, customerId);
            const accessToken = data.response?.accessToken;
            if (!accessToken) {
                throw new Error(`No accessToken from OTP verify: ${JSON.stringify(data)}`);
            }
            if (i > 0) {
                // E.164 is the expected format; note it if a fallback was needed.
                (0, logger_1.log)(`otp verify succeeded with identifier ${JSON.stringify(candidate)} after ${i} rejected format(s)`);
            }
            return { accessToken, refreshToken: data.response?.refreshToken };
        }
        catch (error) {
            if (!(error instanceof http_1.HttpError)) {
                throw error;
            }
            attempts.push(`${candidate} → HTTP ${error.status}: ${error.body}`);
            // If the server got far enough to complain about the OTP itself (wrong /
            // expired code, attempts exhausted), the identifier format was accepted —
            // trying other formats would only burn attempts. Stop and report.
            if (isLast || OTP_ATTEMPT_RE.test(error.body)) {
                throw new Error(`OTP verify failed for reference ${JSON.stringify(reference)}:\n${attempts.join("\n")}`);
            }
        }
    }
    // Unreachable: the loop returns or throws on the last candidate.
    throw new Error("OTP verify: no identifier candidates to try");
};
exports.verifyOtp = verifyOtp;
const getCustomerProfile = async (customerId, accessToken, phoneE164) => {
    const data = await (0, http_1.http)(`${AUTH_BASE}/customers/${customerId}/customer-profile/v2/${accessToken}`, {
        method: "GET",
        headers: {
            ...(await baseHeaders(accessToken, phoneE164, [])),
            Authorization: `Bearer ${required(config_1.SIXTY60_PROFILE_TOKEN, "SIXTY60_PROFILE_TOKEN")}`,
        },
    });
    const userId = data.userProfile?.id ?? data.userProfile?.identifier;
    const email = data.userProfile?.email;
    if (!userId || !email) {
        throw new Error(`Could not resolve user profile context: ${JSON.stringify(data)}`);
    }
    return { userId, email };
};
exports.getCustomerProfile = getCustomerProfile;
const getStoreIds = async (accessToken, phoneE164, userId, customerId, email) => {
    const location = await getLocation({
        accessToken,
        phoneE164,
        userId,
        customerId,
        email,
    });
    const data = await (0, http_1.http)(`${CATALOG_BASE}/api/v3/store-contexts`, {
        method: "POST",
        headers: await baseHeaders(accessToken, phoneE164, [], userId, customerId, email),
        body: {
            latitude: location.latitude,
            longitude: location.longitude,
        },
    });
    const storeIds = (data.items ?? [])
        .map((item) => item.storeId)
        .filter((value) => Boolean(value));
    if (storeIds.length === 0) {
        throw new Error(`No store contexts returned: ${JSON.stringify(data)}`);
    }
    return storeIds;
};
exports.getStoreIds = getStoreIds;
const loginFlow = async (phoneRaw, otp, otpReference, otpIdentifier) => {
    const phoneE164 = normalizePhone(phoneRaw);
    const bffToken = await (0, exports.getBffToken)();
    const customerId = await (0, exports.verifyUser)(phoneE164, bffToken);
    const otpResult = await (0, exports.verifyOtp)(phoneE164, otpReference, otp, bffToken, customerId, otpIdentifier);
    const profile = await (0, exports.getCustomerProfile)(customerId, otpResult.accessToken, phoneE164);
    const storeIds = await (0, exports.getStoreIds)(otpResult.accessToken, phoneE164, profile.userId, customerId, profile.email);
    return {
        phoneE164,
        customerId,
        userId: profile.userId,
        email: profile.email,
        accessToken: otpResult.accessToken,
        refreshToken: otpResult.refreshToken,
        storeIds,
    };
};
exports.loginFlow = loginFlow;
const startOtpFlow = async (phoneRaw) => {
    const phoneE164 = normalizePhone(phoneRaw);
    const bffToken = await (0, exports.getBffToken)();
    const customerId = await (0, exports.verifyUser)(phoneE164, bffToken);
    const otpRequest = await (0, exports.requestOtp)(phoneE164, bffToken, customerId);
    return {
        phoneE164,
        customerId,
        bffToken,
        reference: otpRequest.reference,
        otpIdentifier: otpRequest.otpIdentifier,
    };
};
exports.startOtpFlow = startOtpFlow;
const completeOtpFlow = async (phoneE164, customerId, bffToken, otpReference, otp, otpIdentifier) => {
    const otpResult = await (0, exports.verifyOtp)(phoneE164, otpReference, otp, bffToken, customerId, otpIdentifier);
    const profile = await (0, exports.getCustomerProfile)(customerId, otpResult.accessToken, phoneE164);
    const storeIds = await (0, exports.getStoreIds)(otpResult.accessToken, phoneE164, profile.userId, customerId, profile.email);
    return {
        phoneE164,
        customerId,
        userId: profile.userId,
        email: profile.email,
        accessToken: otpResult.accessToken,
        refreshToken: otpResult.refreshToken,
        storeIds,
    };
};
exports.completeOtpFlow = completeOtpFlow;
const pickCoord = (...candidates) => {
    for (const value of candidates) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
};
const normalizeAddress = (raw) => ({
    id: raw.identifier ?? raw._id ?? "",
    label: raw.name,
    type: raw.type,
    fullAddress: raw.fullAddress,
    suburb: raw.suburb,
    city: raw.city,
    latitude: pickCoord(raw.coordinates?.latitude, raw.geoLocation?.latitude, raw.latitude),
    longitude: pickCoord(raw.coordinates?.longitude, raw.geoLocation?.longitude, raw.longitude),
    active: raw.active !== false,
    lastUsedOn: typeof raw.lastUsedOn === "number" ? raw.lastUsedOn : undefined,
});
exports.normalizeAddress = normalizeAddress;
// Read-only: list the delivery addresses already saved on the Checkers account.
// The path takes the mongo profile id (context.userId), NOT the short
// customer-id, and authenticates with the ordinary user access token.
// Creating / editing addresses is intentionally left to the official app.
const fetchAddresses = async (context) => {
    const data = await (0, http_1.http)(`${AUTH_BASE}/customers/${context.userId}/addresses`, {
        method: "GET",
        headers: await baseHeaders(context.accessToken, context.phoneE164, context.storeIds ?? [], context.userId, context.customerId, context.email),
    });
    return data.items ?? [];
};
exports.fetchAddresses = fetchAddresses;
// The single source of delivery coordinates: whichever saved Checkers address
// is pinned (settings.json), else the account's most-recently-used one. Throws
// an actionable error if the account has no usable address — there is no
// coordinate fallback by design.
const resolveDeliveryAddress = async (context) => {
    const pinnedId = await (0, tenant_state_1.readSelectedAddressId)();
    const usable = (await (0, exports.fetchAddresses)(context))
        .map(exports.normalizeAddress)
        .filter((a) => a.latitude !== undefined && a.longitude !== undefined);
    if (usable.length === 0) {
        throw new Error("No delivery address with coordinates is saved on this Checkers account. Add one in the Sixty60 app, then retry.");
    }
    if (pinnedId) {
        const chosen = usable.find((a) => a.id === pinnedId);
        if (!chosen) {
            throw new Error(`Pinned delivery address ${JSON.stringify(pinnedId)} is no longer on the Checkers account. Run 'checkers-sixty60 addresses' to list current ones, then 'checkers-sixty60 set-location --address-id <id>' or '--last-used'.`);
        }
        return { ...chosen, selection: "pinned" };
    }
    const mostRecent = [...usable].sort((a, b) => (b.lastUsedOn ?? 0) - (a.lastUsedOn ?? 0))[0];
    return { ...mostRecent, selection: "last-used" };
};
exports.resolveDeliveryAddress = resolveDeliveryAddress;
const fetchOrders = async (context) => {
    return (0, http_1.http)(`${ORDERS_BASE}/api/v2/orders/history`, {
        method: "GET",
        headers: await baseHeaders(context.accessToken, context.phoneE164, context.storeIds, context.userId, context.customerId, context.email),
    });
};
exports.fetchOrders = fetchOrders;
const searchProducts = async (context, query, page = 0, pageSize = 20) => {
    const url = `${CATALOG_BASE}/api/v3/products/product-list-page`;
    const headers = await baseHeaders(context.accessToken, context.phoneE164, context.storeIds, context.userId, context.customerId, context.email);
    const storeIdsCsv = context.storeIds.join(",");
    headers.storeids = storeIdsCsv;
    headers["istio-storeIds"] = storeIdsCsv;
    return (0, http_1.http)(url, {
        method: "POST",
        query: {
            isCarousel: true,
            includePromotions: true,
            promotionChannel: "sixty60",
            isXtraSavingsMember: true,
            particularMemberBonusBuyIds: "",
            t: Date.now(),
        },
        headers,
        body: {
            filter: {
                productListSource: {
                    search: query,
                },
                paginationOptions: {
                    page,
                    pageSize,
                },
                filterOptions: {
                    dealsOnly: false,
                    brandOptions: [],
                    departmentOptions: [],
                    facetOptions: [],
                    serviceOptions: [],
                    filterIds: [],
                },
                showNotRangedProducts: false,
            },
            userContext: {
                storeContexts: buildStoreContexts(context.storeIds),
                userId: context.userId,
            },
        },
    });
};
exports.searchProducts = searchProducts;
// The personalised reorder list: every product the account has ordered before,
// each with a purchase `count` and a recency/frequency-weighted `score`.
// `GET orders-api.sixty60.co.za/api/v3/orders/my-products?storeIds=<csv>` — the
// store ids MUST be a comma-separated query param (a JSON array fails an
// upstream ObjectID decode). The response is not reliably pre-sorted, so this
// returns it sorted by `score` descending.
const fetchMyProductScores = async (context) => {
    const storeIdsCsv = context.storeIds.join(",");
    const headers = await baseHeaders(context.accessToken, context.phoneE164, context.storeIds, context.userId, context.customerId, context.email);
    headers.storeids = storeIdsCsv;
    headers["istio-storeIds"] = storeIdsCsv;
    const data = await (0, http_1.http)(`${ORDERS_BASE}/api/v3/orders/my-products`, {
        method: "GET",
        query: { storeIds: storeIdsCsv },
        headers,
    });
    return [...(data.userProductScores ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
};
exports.fetchMyProductScores = fetchMyProductScores;
// Resolve a set of product ids to full catalog products in the current store
// context (name, price, stock). Same endpoint as `searchProducts` with a
// `productIds` source instead of `search`. Upstream does not preserve the input
// order and silently omits ids that are no longer ranged, so callers must
// re-join by id (see `mergeMyProducts`).
const hydrateProducts = async (context, productIds) => {
    if (productIds.length === 0) {
        return { products: [] };
    }
    const headers = await baseHeaders(context.accessToken, context.phoneE164, context.storeIds, context.userId, context.customerId, context.email);
    const storeIdsCsv = context.storeIds.join(",");
    headers.storeids = storeIdsCsv;
    headers["istio-storeIds"] = storeIdsCsv;
    return (0, http_1.http)(`${CATALOG_BASE}/api/v3/products/product-list-page`, {
        method: "POST",
        query: {
            isCarousel: true,
            includePromotions: true,
            promotionChannel: "sixty60",
            isXtraSavingsMember: true,
            particularMemberBonusBuyIds: "",
            t: Date.now(),
        },
        headers,
        body: {
            filter: {
                productListSource: {
                    productIds,
                },
                paginationOptions: {
                    page: 0,
                    pageSize: Math.max(productIds.length, 1),
                },
                filterOptions: {
                    dealsOnly: false,
                    brandOptions: [],
                    departmentOptions: [],
                    facetOptions: [],
                    serviceOptions: [],
                    filterIds: [],
                },
                showNotRangedProducts: false,
            },
            userContext: {
                storeContexts: buildStoreContexts(context.storeIds),
                userId: context.userId,
            },
        },
    });
};
exports.hydrateProducts = hydrateProducts;
const addToBasket = async (context, productId, quantity = 1, cartId) => {
    const location = await getLocation(context);
    const storeContextResponse = await (0, http_1.http)(`${CATALOG_BASE}/api/v3/store-contexts`, {
        method: "POST",
        headers: await baseHeaders(context.accessToken, context.phoneE164, [], context.userId, context.customerId, context.email),
        body: {
            latitude: location.latitude,
            longitude: location.longitude,
        },
    });
    const storeContexts = (storeContextResponse.items ?? []).filter((item) => Boolean(item.storeId));
    const updateStoreIds = storeContexts.map((item) => item.storeId);
    const cartsResponse = await (0, http_1.http)(`${ORDERS_BASE}/api/v2/carts/user?useProductMinInfoAnnotation=true`, {
        method: "POST",
        headers: {
            ...(await baseHeaders(context.accessToken, context.phoneE164, updateStoreIds, context.userId, context.customerId, context.email)),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: {
            storeContexts,
            includeV2ReplacementOptions: true,
        },
    });
    const carts = (cartsResponse.carts ?? []).filter((cart) => Boolean(cart.item?.id));
    const selected = cartId
        ? carts.find((cart) => cart.item?.id === cartId)
        : (carts.find((cart) => cart.item?.serviceOptionId === "sixty-min-delivery") ?? carts[0]);
    if (!selected?.item?.id || !selected.item.serviceOptionId) {
        throw new Error("Could not locate a cart to update");
    }
    const productLookupHeaders = await baseHeaders(context.accessToken, context.phoneE164, updateStoreIds, context.userId, context.customerId, context.email);
    const storeIdsCsv = updateStoreIds.join(",");
    productLookupHeaders.storeids = storeIdsCsv;
    productLookupHeaders["istio-storeIds"] = storeIdsCsv;
    const productLookup = await (0, http_1.http)(`${CATALOG_BASE}/api/v3/products/product-list-page`, {
        method: "POST",
        query: {
            isCarousel: true,
            includePromotions: true,
            promotionChannel: "sixty60",
            isXtraSavingsMember: true,
            particularMemberBonusBuyIds: "",
            t: Date.now(),
        },
        headers: productLookupHeaders,
        body: {
            filter: {
                productListSource: {
                    productIds: [productId],
                },
                paginationOptions: {
                    page: 0,
                    pageSize: 20,
                },
                filterOptions: {
                    dealsOnly: false,
                    brandOptions: [],
                    departmentOptions: [],
                    facetOptions: [],
                    serviceOptions: [],
                    filterIds: [],
                },
                showNotRangedProducts: false,
            },
            userContext: {
                storeContexts,
                userId: context.userId,
            },
        },
    });
    const productData = productLookup.products?.find((product) => product.id === productId);
    if (!productData) {
        throw new Error(`Product ${productId} not found in current store context`);
    }
    const currentLineItems = [...(selected.item.lineItems ?? [])];
    const existingIndex = currentLineItems.findIndex((line) => line.productId === productId || line.product?.id === productId);
    const nextLineItems = [...currentLineItems];
    const defaultStoreId = productData.storeId ?? updateStoreIds[0] ?? "";
    if (existingIndex >= 0) {
        const existing = nextLineItems[existingIndex];
        nextLineItems[existingIndex] = {
            ...existing,
            quantity: (existing.quantity ?? 0) + quantity,
        };
    }
    else {
        nextLineItems.push({
            id: "",
            productId,
            price: productData.priceWithoutDecimal ?? 0,
            priceFactor: productData.priceFactor ?? 100,
            previousPrice: productData.oldPrice ?? productData.priceWithoutDecimal ?? 0,
            quantity,
            specialInstructions: "",
            storeId: defaultStoreId,
            replacementPreferenceId: "",
            optionSelections: [],
            selectedWeightRange: null,
            missionName: "",
            missionType: "",
            addToBasketType: "quick_add",
            addToBasketJourney: "main_search_results",
            serviceOptionId: productData.serviceOptionId ?? selected.item.serviceOptionId,
            isStockAvailable: productData.isStockAvailable ?? true,
            ranged: false,
            requiresOver18: productData.requiresOver18 ?? false,
            isSponsoredProduct: productData.isSponsored ?? false,
            hasAlcohol: productData.hasAlcohol ?? false,
        });
    }
    const normalizedTargetLineItems = nextLineItems.map((line) => toCartUpdateLineItem(line));
    const cartsForUpdate = [];
    for (const cart of carts) {
        const item = cart.item;
        if (!item?.id || !item.serviceOptionId) {
            continue;
        }
        if (item.id === selected.item?.id) {
            cartsForUpdate.push({
                id: item.id,
                serviceOptionId: item.serviceOptionId,
                lineItems: normalizedTargetLineItems,
            });
            continue;
        }
        cartsForUpdate.push({
            id: item.id,
            serviceOptionId: item.serviceOptionId,
            lineItems: (item.lineItems ?? []),
        });
    }
    const deliveryAddressId = selected.item.deliveryAddress?.identifier ??
        carts
            .map((cart) => cart.item?.deliveryAddress?.identifier)
            .find((identifier) => Boolean(identifier)) ??
        "";
    const updateHeaders = await baseHeaders(context.accessToken, context.phoneE164, updateStoreIds, context.userId, context.customerId, context.email);
    updateHeaders.storeids = storeIdsCsv;
    updateHeaders["istio-storeIds"] = storeIdsCsv;
    updateHeaders["aws-cf-cd-storeid"] = storeIdsCsv;
    updateHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    const updated = await (0, http_1.http)(`${ORDERS_BASE}/api/v3/carts/update?useProductMinInfoAnnotation=true`, {
        method: "POST",
        headers: updateHeaders,
        body: {
            carts: cartsForUpdate,
            deliveryAddressId,
            storeContexts,
        },
    });
    for (const cart of cartsForUpdate) {
        const promotionHeaders = await baseHeaders(context.accessToken, context.phoneE164, updateStoreIds, context.userId, context.customerId, context.email);
        promotionHeaders.storeids = JSON.stringify(updateStoreIds);
        promotionHeaders["istio-storeIds"] = JSON.stringify(updateStoreIds);
        promotionHeaders["aws-cf-cd-storeid"] = storeIdsCsv;
        promotionHeaders["Content-Type"] = "application/x-www-form-urlencoded";
        await (0, http_1.http)(`${ORDERS_BASE}/api/v1/carts/${cart.id}/update-promotions?include_v2_replacement_preferences=true&useProductMinInfoAnnotation=true`, {
            method: "POST",
            headers: promotionHeaders,
            body: {
                storeContexts,
            },
        });
    }
    return updated;
};
exports.addToBasket = addToBasket;
const removeFromBasket = async (context, productId, quantity, cartId) => {
    const location = await getLocation(context);
    const storeContextResponse = await (0, http_1.http)(`${CATALOG_BASE}/api/v3/store-contexts`, {
        method: "POST",
        headers: await baseHeaders(context.accessToken, context.phoneE164, [], context.userId, context.customerId, context.email),
        body: {
            latitude: location.latitude,
            longitude: location.longitude,
        },
    });
    const storeContexts = (storeContextResponse.items ?? []).filter((item) => Boolean(item.storeId));
    const updateStoreIds = storeContexts.map((item) => item.storeId);
    const cartsResponse = await (0, http_1.http)(`${ORDERS_BASE}/api/v2/carts/user?useProductMinInfoAnnotation=true`, {
        method: "POST",
        headers: {
            ...(await baseHeaders(context.accessToken, context.phoneE164, updateStoreIds, context.userId, context.customerId, context.email)),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: {
            storeContexts,
            includeV2ReplacementOptions: true,
        },
    });
    const carts = (cartsResponse.carts ?? []).filter((cart) => Boolean(cart.item?.id));
    const selected = cartId
        ? carts.find((cart) => cart.item?.id === cartId)
        : (carts.find((cart) => cart.item?.serviceOptionId === "sixty-min-delivery") ?? carts[0]);
    if (!selected?.item?.id || !selected.item.serviceOptionId) {
        throw new Error("Could not locate a cart to update");
    }
    const currentLineItems = [...(selected.item.lineItems ?? [])];
    const existingIndex = currentLineItems.findIndex((line) => line.productId === productId || line.product?.id === productId);
    if (existingIndex < 0) {
        throw new Error(`Product ${productId} not found in cart`);
    }
    const nextLineItems = [...currentLineItems];
    const existing = nextLineItems[existingIndex];
    const existingQty = existing.quantity ?? 0;
    if (quantity === undefined) {
        nextLineItems[existingIndex] = {
            ...existing,
            quantity: 0,
            status: "removed",
        };
    }
    else {
        const nextQty = existingQty - quantity;
        if (nextQty > 0) {
            nextLineItems[existingIndex] = {
                ...existing,
                quantity: nextQty,
            };
        }
        else {
            nextLineItems[existingIndex] = {
                ...existing,
                quantity: 0,
                status: "removed",
            };
        }
    }
    const normalizedTargetLineItems = nextLineItems.map((line) => toCartUpdateLineItem(line));
    const cartsForUpdate = [];
    for (const cart of carts) {
        const item = cart.item;
        if (!item?.id || !item.serviceOptionId) {
            continue;
        }
        if (item.id === selected.item?.id) {
            cartsForUpdate.push({
                id: item.id,
                serviceOptionId: item.serviceOptionId,
                lineItems: normalizedTargetLineItems,
            });
            continue;
        }
        cartsForUpdate.push({
            id: item.id,
            serviceOptionId: item.serviceOptionId,
            lineItems: (item.lineItems ?? []),
        });
    }
    const deliveryAddressId = selected.item.deliveryAddress?.identifier ??
        carts
            .map((cart) => cart.item?.deliveryAddress?.identifier)
            .find((identifier) => Boolean(identifier)) ??
        "";
    const updateHeaders = await baseHeaders(context.accessToken, context.phoneE164, updateStoreIds, context.userId, context.customerId, context.email);
    const storeIdsCsv = updateStoreIds.join(",");
    updateHeaders.storeids = storeIdsCsv;
    updateHeaders["istio-storeIds"] = storeIdsCsv;
    updateHeaders["aws-cf-cd-storeid"] = storeIdsCsv;
    updateHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    const updated = await (0, http_1.http)(`${ORDERS_BASE}/api/v3/carts/update?useProductMinInfoAnnotation=true`, {
        method: "POST",
        headers: updateHeaders,
        body: {
            carts: cartsForUpdate,
            deliveryAddressId,
            storeContexts,
        },
    });
    for (const cart of cartsForUpdate) {
        const promotionHeaders = await baseHeaders(context.accessToken, context.phoneE164, updateStoreIds, context.userId, context.customerId, context.email);
        promotionHeaders.storeids = JSON.stringify(updateStoreIds);
        promotionHeaders["istio-storeIds"] = JSON.stringify(updateStoreIds);
        promotionHeaders["aws-cf-cd-storeid"] = storeIdsCsv;
        promotionHeaders["Content-Type"] = "application/x-www-form-urlencoded";
        await (0, http_1.http)(`${ORDERS_BASE}/api/v1/carts/${cart.id}/update-promotions?include_v2_replacement_preferences=true&useProductMinInfoAnnotation=true`, {
            method: "POST",
            headers: promotionHeaders,
            body: {
                storeContexts,
            },
        });
    }
    return updated;
};
exports.removeFromBasket = removeFromBasket;
const viewCart = async (context) => {
    const location = await getLocation(context);
    const storeContextResponse = await (0, http_1.http)(`${CATALOG_BASE}/api/v3/store-contexts`, {
        method: "POST",
        headers: await baseHeaders(context.accessToken, context.phoneE164, [], context.userId, context.customerId, context.email),
        body: {
            latitude: location.latitude,
            longitude: location.longitude,
        },
    });
    const storeContexts = (storeContextResponse.items ?? []).filter((item) => Boolean(item.storeId));
    const updateStoreIds = storeContexts.map((item) => item.storeId);
    return (0, http_1.http)(`${ORDERS_BASE}/api/v2/carts/user?useProductMinInfoAnnotation=true`, {
        method: "POST",
        headers: {
            ...(await baseHeaders(context.accessToken, context.phoneE164, updateStoreIds, context.userId, context.customerId, context.email)),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: {
            storeContexts,
            includeV2ReplacementOptions: true,
        },
    });
};
exports.viewCart = viewCart;
