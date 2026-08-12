export type CompactOrder = {
    id: string;
    reference: string;
    status: string;
    totalPayable: number;
    createdOn: number;
};
export declare const toCompactOrders: (payload: unknown) => CompactOrder[];
export declare const toCompactSearchResults: (payload: unknown) => {
    id: string | undefined;
    name: string | undefined;
    brand: string | undefined;
    price: number | undefined;
    oldPrice: number | undefined;
    discount: number | undefined;
    priceFactor: number | undefined;
    currency: string | undefined;
    storeId: string | undefined;
    serviceOptionId: string | undefined;
    inStock: boolean | undefined;
}[];
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
