import { type AuthState, type LocationSettings } from "./storage";
export declare const DEFAULT_TENANT = "default";
export type TenantStore = {
    readonly tenantId: string;
    readAuth(): Promise<AuthState | null>;
    writeAuth(state: AuthState): Promise<void>;
    readLocation(): Promise<LocationSettings | null>;
    writeLocation(settings: LocationSettings): Promise<void>;
    getOrCreateDeviceId(): Promise<string>;
    lock<T>(key: string, fn: () => Promise<T>): Promise<T>;
};
export declare const getTenantStore: (tenantId: string) => TenantStore;
