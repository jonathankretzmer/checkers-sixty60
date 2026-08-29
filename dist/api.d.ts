export type LoginContext = {
    phoneE164: string;
    customerId: string;
    userId: string;
    email: string;
    accessToken: string;
    refreshToken?: string;
    storeIds: string[];
};
export declare const getBffToken: () => Promise<string>;
export declare const verifyUser: (phoneE164: string, bffToken: string) => Promise<string>;
export declare const requestOtp: (phoneRaw: string, bffToken: string, customerId: string) => Promise<{
    phoneE164: string;
    reference: string;
}>;
export declare const verifyOtp: (phoneE164: string, reference: string, otp: string, bffToken: string, customerId: string) => Promise<{
    accessToken: string;
    refreshToken?: string;
}>;
export declare const getCustomerProfile: (customerId: string, accessToken: string, phoneE164: string) => Promise<{
    userId: string;
    email: string;
}>;
export declare const getStoreIds: (accessToken: string, phoneE164: string, userId: string, customerId: string, email: string) => Promise<string[]>;
export declare const loginFlow: (phoneRaw: string, otp: string, otpReference: string) => Promise<LoginContext>;
export declare const startOtpFlow: (phoneRaw: string) => Promise<{
    phoneE164: string;
    customerId: string;
    bffToken: string;
    reference: string;
}>;
export declare const completeOtpFlow: (phoneE164: string, customerId: string, bffToken: string, otpReference: string, otp: string) => Promise<LoginContext>;
export declare const fetchOrders: (context: LoginContext) => Promise<unknown>;
export declare const searchProducts: (context: LoginContext, query: string, page?: number, pageSize?: number) => Promise<unknown>;
export declare const addToBasket: (context: LoginContext, productId: string, quantity?: number, cartId?: string) => Promise<unknown>;
export declare const removeFromBasket: (context: LoginContext, productId: string, quantity?: number, cartId?: string) => Promise<unknown>;
export declare const viewCart: (context: LoginContext) => Promise<unknown>;
