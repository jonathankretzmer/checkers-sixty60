export type AuthState = {
    phoneE164: string;
    bffToken?: string;
    userAccessToken?: string;
    refreshToken?: string;
    otpReference?: string;
    customerId?: string;
    userId?: string;
    email?: string;
    storeIds?: string[];
    savedAt: string;
};
export type LocationSettings = {
    latitude: number;
    longitude: number;
    savedAt: string;
};
export declare const readJsonFile: <T>(path: string) => Promise<T | null>;
export declare const writeJsonFile: (path: string, value: unknown) => Promise<void>;
export declare const getOrCreateDeviceId: () => Promise<string>;
export declare const readLocationSettings: () => Promise<LocationSettings | null>;
export declare const writeLocationSettings: (latitude: number, longitude: number) => Promise<LocationSettings>;
