import { type LoginContext, type NormalizedAddress } from "./api";
import type { AuthState } from "./storage";
export declare const toLoginContext: (auth: AuthState) => LoginContext;
export declare const toAuthState: (context: LoginContext, bffToken: string, otpReference: string) => AuthState;
export declare const savePendingAuth: (phoneE164: string, bffToken: string, customerId: string, reference: string) => Promise<AuthState>;
export declare const requestOtpForPhone: (phoneRaw: string) => Promise<{
    phoneE164: string;
    reference: string;
}>;
export declare const completeOtpForPhone: (phone: string, otpCode: string, reference?: string) => Promise<AuthState>;
export declare const withReauthHint: <T>(fn: () => Promise<T>) => Promise<T>;
export declare const hydrateAuth: (auth: AuthState) => Promise<AuthState>;
export type ConfigSummary = {
    dataDir: string;
    tenant: string;
    account: {
        loggedIn: boolean;
        phoneE164?: string;
        email?: string;
        customerId?: string;
        userId?: string;
        storeIds?: string[];
        savedAt?: string;
    };
    location: {
        pinnedAddressId: string | null;
        active: {
            id: string;
            label?: string;
            fullAddress?: string;
            suburb?: string;
            city?: string;
            latitude: number;
            longitude: number;
            selection: "pinned" | "last-used";
        } | null;
        note?: string;
    };
    deviceId: string | null;
    apiCredentials: {
        SIXTY60_API_KEY: boolean;
        SIXTY60_API_KEY_AUTH: boolean;
        SIXTY60_PROFILE_TOKEN: boolean;
    };
    stateEncryption: boolean;
};
export declare const getConfigSummary: () => Promise<ConfigSummary>;
export declare const requireAuth: () => Promise<AuthState>;
export declare const listSavedAddresses: () => Promise<NormalizedAddress[]>;
export type DeliverySelection = {
    address: NormalizedAddress;
    selection: "pinned" | "last-used";
};
export declare const selectDeliveryAddress: (addressId?: string) => Promise<DeliverySelection>;
