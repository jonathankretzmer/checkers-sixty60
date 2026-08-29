"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewCart = exports.removeFromBasket = exports.addToBasket = exports.searchProducts = exports.fetchOrders = exports.completeOtpFlow = exports.startOtpFlow = exports.loginFlow = exports.getStoreIds = exports.getCustomerProfile = exports.verifyOtp = exports.requestOtp = exports.verifyUser = exports.getBffToken = void 0;
const http_1 = require("./http");
const tenant_state_1 = require("./tenant-state");
const BFF_BASE = "https://dc-app-backend-for-frontend.sixty60.co.za";
const DSL_BASE = "https://api.shopritegroup.co.za/dsl/brands/checkers/countries/ZA";
const AUTH_BASE = "https://auth.sixty60.co.za";
const CATALOG_BASE = "https://catalog.sixty60.co.za";
const ORDERS_BASE = "https://orders-api.sixty60.co.za";
const X_API_KEY = "5y2GIJ8RoP8dm5FxUtsBZ66OfvAZ8Njh3Pjaj9WF";
const X_API_KEY_AUTH = "HbFTqw6RLe4T3gbgGLb7X2qM08viEJlN3Amyq40z";
const PROFILE_TOKEN = "G5tmYwwRnpfPmtJ3HT7VYV7C4x86NGDz";
const APP_VERSION = "iPadOS 2.0.99 (1769786479)";
const APP_BUILD = "1769786479";
const DEFAULT_LATITUDE = -33.9249;
const DEFAULT_LONGITUDE = 18.4241;
const getLocation = async () => {
    // Tenant-scoped: saved settings for the active tenant, with env-var override
    // for the single-user default tenant only (see tenant-state.ts).
    const loc = await (0, tenant_state_1.resolveLocation)();
    return {
        latitude: loc.latitude ?? DEFAULT_LATITUDE,
        longitude: loc.longitude ?? DEFAULT_LONGITUDE,
    };
};
const normalizePhone = (value) => {
    const digits = value.replace(/\D+/g, "");
    if (digits.startsWith("27") && digits.length === 11) {
        return `+${digits}`;
    }
    if (digits.startsWith("0") && digits.length === 10) {
        return `+27${digits.slice(1)}`;
    }
    if (digits.length === 9) {
        return `+27${digits}`;
    }
    throw new Error("Invalid phone number. Use South African format like 0821234567 or +27821234567.");
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
            "x-api-key": X_API_KEY,
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
            "x-api-key": X_API_KEY_AUTH,
        },
    });
    const reference = data.response?.reference;
    if (!reference) {
        throw new Error(`No OTP reference returned: ${JSON.stringify(data)}`);
    }
    return { phoneE164, reference };
};
exports.requestOtp = requestOtp;
const verifyOtp = async (phoneE164, reference, otp, bffToken, customerId) => {
    const data = await (0, http_1.http)(`${DSL_BASE}/otp/loginbymobile/verify`, {
        method: "POST",
        headers: {
            ...(await baseHeaders(bffToken, phoneE164, [], undefined, customerId)),
            "x-api-key": X_API_KEY_AUTH,
        },
        body: {
            target: {
                type: "SMS",
                identifier: phoneE164,
                reference,
            },
            otp,
        },
    });
    const accessToken = data.response?.accessToken;
    if (!accessToken) {
        throw new Error(`No accessToken from OTP verify: ${JSON.stringify(data)}`);
    }
    return {
        accessToken,
        refreshToken: data.response?.refreshToken,
    };
};
exports.verifyOtp = verifyOtp;
const getCustomerProfile = async (customerId, accessToken, phoneE164) => {
    const data = await (0, http_1.http)(`${AUTH_BASE}/customers/${customerId}/customer-profile/v2/${accessToken}`, {
        method: "GET",
        headers: {
            ...(await baseHeaders(accessToken, phoneE164, [])),
            Authorization: `Bearer ${PROFILE_TOKEN}`,
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
    const location = await getLocation();
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
const loginFlow = async (phoneRaw, otp, otpReference) => {
    const phoneE164 = normalizePhone(phoneRaw);
    const bffToken = await (0, exports.getBffToken)();
    const customerId = await (0, exports.verifyUser)(phoneE164, bffToken);
    const otpResult = await (0, exports.verifyOtp)(phoneE164, otpReference, otp, bffToken, customerId);
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
    };
};
exports.startOtpFlow = startOtpFlow;
const completeOtpFlow = async (phoneE164, customerId, bffToken, otpReference, otp) => {
    const otpResult = await (0, exports.verifyOtp)(phoneE164, otpReference, otp, bffToken, customerId);
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
const addToBasket = async (context, productId, quantity = 1, cartId) => {
    const location = await getLocation();
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
    const location = await getLocation();
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
    const location = await getLocation();
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
