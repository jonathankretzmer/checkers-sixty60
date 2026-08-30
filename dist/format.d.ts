export type CompactOrder = {
    id: string;
    reference: string;
    status: string;
    totalPayable: number;
    createdOn: number;
};
export declare const toCompactOrders: (payload: unknown) => CompactOrder[];
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
export declare const toCompactSearchResults: (payload: unknown) => CompactProduct[];
export type MyProduct = CompactProduct & {
    score: number;
    count: number;
};
type MyProductScore = {
    productId: string;
    count?: number;
    score?: number;
};
export declare const mergeMyProducts: (scores: MyProductScore[], hydratePayload: unknown) => MyProduct[];
export declare const matchCachedMyProducts: (products: MyProduct[], query: string, limit: number) => MyProduct[];
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
export declare const toCompactCarts: (payload: unknown) => CompactCart[];
export {};
