import type { MyProduct } from "./format";
export type AuthState = {
    phoneE164: string;
    bffToken?: string;
    userAccessToken?: string;
    refreshToken?: string;
    otpReference?: string;
    otpIdentifier?: string;
    customerId?: string;
    userId?: string;
    email?: string;
    storeIds?: string[];
    savedAt: string;
};
export type DeviceState = {
    deviceId: string;
    savedAt: string;
};
export type AddressSelection = {
    addressId: string;
    savedAt: string;
};
export type MyProductsCache = {
    products: MyProduct[];
    fetchedAt: string;
    storeIds: string[];
    totalScored: number;
    hydrated: number;
};
export declare const readTextFile: (path: string) => Promise<string | null>;
export declare const writeTextFileAtomic: (path: string, text: string) => Promise<void>;
export declare const removeFile: (path: string) => Promise<void>;
