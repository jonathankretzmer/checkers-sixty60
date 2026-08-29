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
export type DeviceState = {
    deviceId: string;
    savedAt: string;
};
export type LocationSettings = {
    latitude: number;
    longitude: number;
    savedAt: string;
};
export declare const readTextFile: (path: string) => Promise<string | null>;
export declare const writeTextFileAtomic: (path: string, text: string) => Promise<void>;
