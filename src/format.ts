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

export const toCompactSearchResults = (payload: unknown) => {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const root = payload as {
    products?: Array<{
      id?: string;
      name?: string;
      brandName?: string;
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
