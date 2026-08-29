"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCompactCarts = exports.toCompactSearchResults = exports.toCompactOrders = void 0;
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
const toCompactSearchResults = (payload) => {
    if (typeof payload !== "object" || payload === null) {
        return [];
    }
    const root = payload;
    return (root.products ?? []).map((product) => ({
        id: product.id,
        name: product.name,
        brand: product.brandName,
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
