import { type AddressSelection, type AuthState } from "./storage";
export declare const DEFAULT_TENANT = "default";
export type TenantStore = {
    readonly tenantId: string;
    readAuth(): Promise<AuthState | null>;
    writeAuth(state: AuthState): Promise<void>;
    readAddressSelection(): Promise<AddressSelection | null>;
    writeAddressSelection(selection: AddressSelection): Promise<void>;
    clearAddressSelection(): Promise<void>;
    getOrCreateDeviceId(): Promise<string>;
    readDeviceId(): Promise<string | null>;
    lock<T>(key: string, fn: () => Promise<T>): Promise<T>;
};
export declare const getTenantStore: (tenantId: string) => TenantStore;
