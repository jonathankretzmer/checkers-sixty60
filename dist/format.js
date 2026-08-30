"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCompactCarts = exports.matchCachedMyProducts = exports.mergeMyProducts = exports.toCompactSearchResults = exports.toCompactOrders = void 0;
const toCompactOrders = (payload) => {
    if (typeof payload !== "object" || payload === null) {
        return [];
    }
    const root = payload;
    if (!Array.isArray(root.inactiveOrderGroupSummaries)) {
        return [];
    }
    return root.inactiveOrderGroupSummaries
        .map((item) => {
        if (typeof item !== "object" || item === null) {
            return null;
        }
        const order = item;
        return {
            id: String(order.id ?? ""),
            reference: String(order.reference ?? ""),
            status: String(order.reducedStatus ?? order.customerStatus ?? "unknown"),
            totalPayable: Number(order.totals?.totalPayable ?? 0),
            createdOn: Number(order.createdOn ?? 0),
        };
    })
        .filter((order) => Boolean(order?.id));
};
exports.toCompactOrders = toCompactOrders;
// Shared by search (`/products/product-list-page` with `search`) and my-products
// hydration (the same endpoint with `productIds`) — both return `{ products }`
// with the same item shape. `brand` reads `brandName` first (search) then `brand`
// (the raw catalog product also seen on the productIds path).
const toCompactSearchResults = (payload) => {
    if (typeof payload !== "object" || payload === null) {
        return [];
    }
    const root = payload;
    return (root.products ?? []).map((product) => ({
        id: product.id,
        name: product.name,
        brand: product.brandName ?? product.brand,
        price: product.priceWithoutDecimal,
        oldPrice: product.oldPrice,
        discount: product.discount,
        priceFactor: product.priceFactor,
        currency: product.currency,
        storeId: product.storeId,
        serviceOptionId: product.serviceOptionId,
        inStock: product.isStockAvailable,
    }));
};
exports.toCompactSearchResults = toCompactSearchResults;
// Join the raw `userProductScores` to a hydrated product-list-page payload,
// keeping the score order and dropping any id that did not hydrate (products
// fall out of range / get delisted but linger in the score list).
const mergeMyProducts = (scores, hydratePayload) => {
    const byId = new Map((0, exports.toCompactSearchResults)(hydratePayload).map((product) => [product.id, product]));
    return scores
        .map((entry) => {
        const product = byId.get(entry.productId);
        if (!product) {
            return null;
        }
        return { ...product, score: entry.score ?? 0, count: entry.count ?? 0 };
    })
        .filter((product) => product !== null);
};
exports.mergeMyProducts = mergeMyProducts;
// Offline name match against the cached my-products list. Every whitespace token
// in the query must appear (substring) in the product name or brand. Input order
// is preserved, so callers that pass a score-sorted list get score-sorted hits.
const matchCachedMyProducts = (products, query, limit) => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        return [];
    }
    const matches = products.filter((product) => {
        const haystack = `${product.name ?? ""} ${product.brand ?? ""}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
    });
    return limit > 0 ? matches.slice(0, limit) : matches;
};
exports.matchCachedMyProducts = matchCachedMyProducts;
const toCompactCarts = (payload) => {
    if (typeof payload !== "object" || payload === null) {
        return [];
    }
    const root = payload;
    if (!Array.isArray(root.carts)) {
        return [];
    }
    return root.carts
        .map((cart) => {
        const item = cart.item;
        if (!item?.id) {
            return null;
        }
        const items = (item.lineItems ?? [])
            .filter((line) => line.status !== "removed" && Number(line.quantity ?? 0) > 0)
            .map((line) => ({
            productId: String(line.productId ?? line.product?.id ?? ""),
            quantity: Number(line.quantity ?? 0),
            price: Number(line.price ?? 0),
            previousPrice: Number(line.previousPrice ?? 0),
            status: String(line.status ?? "unknown"),
            storeId: String(line.storeId ?? ""),
        }));
        return {
            id: String(item.id),
            serviceOptionId: String(item.serviceOptionId ?? ""),
            itemCount: items.length,
            total: items.reduce((sum, line) => sum + line.price * line.quantity, 0),
            items,
        };
    })
        .filter((cart) => Boolean(cart));
};
exports.toCompactCarts = toCompactCarts;
