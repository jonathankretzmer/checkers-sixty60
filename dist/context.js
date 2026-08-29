"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentTenant = exports.runWithTenant = exports.makeContext = exports.defaultContext = void 0;
const node_async_hooks_1 = require("node:async_hooks");
const store_1 = require("./store");
const storage = new node_async_hooks_1.AsyncLocalStorage();
let defaultCtx = null;
const defaultContext = () => {
    if (!defaultCtx) {
        defaultCtx = {
            tenantId: store_1.DEFAULT_TENANT,
            store: (0, store_1.getTenantStore)(store_1.DEFAULT_TENANT),
        };
    }
    return defaultCtx;
};
exports.defaultContext = defaultContext;
const makeContext = (tenantId, label) => {
    const id = tenantId.trim();
    if (!id || id === store_1.DEFAULT_TENANT) {
        return (0, exports.defaultContext)();
    }
    return { tenantId: id, store: (0, store_1.getTenantStore)(id), label: label ?? id };
};
exports.makeContext = makeContext;
const runWithTenant = (ctx, fn) => storage.run(ctx, fn);
exports.runWithTenant = runWithTenant;
// Falls back to the single-user default context when nothing is bound (CLI,
// tests, direct module use). The HTTP path always binds explicitly.
const currentTenant = () => storage.getStore() ?? (0, exports.defaultContext)();
exports.currentTenant = currentTenant;
