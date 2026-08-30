export type CompactOrder = {
  id: string;
  reference: string;
  status: string;
  totalPayable: number;
  createdOn: number;
};

export const toCompactOrders = (payload: unknown): CompactOrder[] => {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const root = payload as { inactiveOrderGroupSummaries?: unknown };
  if (!Array.isArray(root.inactiveOrderGroupSummaries)) {
    return [];
  }

  return root.inactiveOrderGroupSummaries
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const order = item as {
        id?: unknown;
        reference?: unknown;
        reducedStatus?: unknown;
        customerStatus?: unknown;
        totals?: { totalPayable?: unknown };
        createdOn?: unknown;
      };

      return {
        id: String(order.id ?? ""),
        reference: String(order.reference ?? ""),
        status: String(
          order.reducedStatus ?? order.customerStatus ?? "unknown",
        ),
        totalPayable: Number(order.totals?.totalPayable ?? 0),
        createdOn: Number(order.createdOn ?? 0),
      };
    })
    .filter((order): order is CompactOrder => Boolean(order?.id));
};

export type CompactProduct = {
  id?: string;
  name?: string;
  brand?: string;
  price?: number;
  oldPrice?: number;
  discount?: number;
  priceFactor?: number;
  currency?: string;
  storeId?: string;
  serviceOptionId?: string;
  inStock?: boolean;
};

// Shared by search (`/products/product-list-page` with `search`) and my-products
// hydration (the same endpoint with `productIds`) — both return `{ products }`
// with the same item shape. `brand` reads `brandName` first (search) then `brand`
// (the raw catalog product also seen on the productIds path).
export const toCompactSearchResults = (payload: unknown): CompactProduct[] => {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const root = payload as {
    products?: Array<{
      id?: string;
      name?: string;
      brandName?: string;
      brand?: string;
      priceWithoutDecimal?: number;
      oldPrice?: number;
      discount?: number;
      priceFactor?: number;
      currency?: string;
      storeId?: string;
      serviceOptionId?: string;
      isStockAvailable?: boolean;
    }>;
  };

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

// One entry of the personalised "my products" list: a catalog product the user
// has ordered before, carried with the upstream ranking signals.
//   score — recency/frequency-weighted rank from `/api/v3/orders/my-products`
//   count — number of past orders that included it
export type MyProduct = CompactProduct & {
  score: number;
  count: number;
};

type MyProductScore = {
  productId: string;
  count?: number;
  score?: number;
};

// Join the raw `userProductScores` to a hydrated product-list-page payload,
// keeping the score order and dropping any id that did not hydrate (products
// fall out of range / get delisted but linger in the score list).
export const mergeMyProducts = (
  scores: MyProductScore[],
  hydratePayload: unknown,
): MyProduct[] => {
  const byId = new Map(
    toCompactSearchResults(hydratePayload).map((product) => [product.id, product]),
  );

  return scores
    .map((entry): MyProduct | null => {
      const product = byId.get(entry.productId);
      if (!product) {
        return null;
      }
      return { ...product, score: entry.score ?? 0, count: entry.count ?? 0 };
    })
    .filter((product): product is MyProduct => product !== null);
};

// Offline name match against the cached my-products list. Every whitespace token
// in the query must appear (substring) in the product name or brand. Input order
// is preserved, so callers that pass a score-sorted list get score-sorted hits.
export const matchCachedMyProducts = (
  products: MyProduct[],
  query: string,
  limit: number,
): MyProduct[] => {
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

export type CompactCartItem = {
  productId: string;
  quantity: number;
  price: number;
  previousPrice: number;
  status: string;
  storeId: string;
};

export type CompactCart = {
  id: string;
  serviceOptionId: string;
  itemCount: number;
  total: number;
  items: CompactCartItem[];
};

export const toCompactCarts = (payload: unknown): CompactCart[] => {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const root = payload as {
    carts?: Array<{
      item?: {
        id?: unknown;
        serviceOptionId?: unknown;
        lineItems?: Array<{
          productId?: unknown;
          product?: { id?: unknown } | null;
          quantity?: unknown;
          price?: unknown;
          previousPrice?: unknown;
          status?: unknown;
          storeId?: unknown;
        }>;
      };
    }>;
  };

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
    .filter((cart): cart is CompactCart => Boolean(cart));
};
