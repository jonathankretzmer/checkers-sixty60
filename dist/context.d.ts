import { type TenantStore } from "./store";
export type TenantContext = {
    tenantId: string;
    store: TenantStore;
    label?: string;
};
export declare const defaultContext: () => TenantContext;
export declare const makeContext: (tenantId: string, label?: string) => TenantContext;
export declare const runWithTenant: <T>(ctx: TenantContext, fn: () => Promise<T>) => Promise<T>;
export declare const currentTenant: () => TenantContext;
