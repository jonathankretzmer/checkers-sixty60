import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_TENANT, type TenantStore, getTenantStore } from "./store";

// Request-scoped tenant context. The HTTP transport binds one of these per
// request (see http-server.ts); the CLI and stdio MCP server bind the single
// DEFAULT_TENANT context once at startup. Everything downstream — session.ts,
// tenant-state.ts — reads `currentTenant()` instead of taking a tenant
// parameter, so api.ts and the tool handlers stay unchanged.

export type TenantContext = {
  tenantId: string;
  store: TenantStore;
  // Human-readable identity for logs (email / subject); never a secret.
  label?: string;
};

const storage = new AsyncLocalStorage<TenantContext>();

let defaultCtx: TenantContext | null = null;

export const defaultContext = (): TenantContext => {
  if (!defaultCtx) {
    defaultCtx = {
      tenantId: DEFAULT_TENANT,
      store: getTenantStore(DEFAULT_TENANT),
    };
  }
  return defaultCtx;
};

export const makeContext = (tenantId: string, label?: string): TenantContext => {
  const id = tenantId.trim();
  if (!id || id === DEFAULT_TENANT) {
    return defaultContext();
  }
  return { tenantId: id, store: getTenantStore(id), label: label ?? id };
};

export const runWithTenant = <T>(
  ctx: TenantContext,
  fn: () => Promise<T>,
): Promise<T> => storage.run(ctx, fn);

// Falls back to the single-user default context when nothing is bound (CLI,
// tests, direct module use). The HTTP path always binds explicitly.
export const currentTenant = (): TenantContext =>
  storage.getStore() ?? defaultContext();
