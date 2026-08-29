"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeLocationSettings = exports.resolveLocation = exports.getOrCreateDeviceId = void 0;
const context_1 = require("./context");
const store_1 = require("./store");
// Tenant-scoped accessors used by api.ts. These replace the old module-level
// helpers in storage.ts: they resolve the active tenant from the async context
// and delegate to its store, so multi-user HTTP hosting keeps each caller's
// device id and saved location isolated.
const getOrCreateDeviceId = () => (0, context_1.currentTenant)().store.getOrCreateDeviceId();
exports.getOrCreateDeviceId = getOrCreateDeviceId;
const parseCoordinate = (value) => {
    if (!value) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};
// Saved (and, for the single-user default tenant only, env-overridden)
// location. Returns partial coords; api.ts applies the generic fallback. The
// SIXTY60_LATITUDE / SIXTY60_LONGITUDE env vars are process-global and would be
// wrong for a shared multi-tenant server, so they apply to DEFAULT_TENANT only.
const resolveLocation = async () => {
    const ctx = (0, context_1.currentTenant)();
    const saved = await ctx.store.readLocation();
    if (ctx.tenantId !== store_1.DEFAULT_TENANT) {
        return { latitude: saved?.latitude, longitude: saved?.longitude };
    }
    return {
        latitude: parseCoordinate(process.env.SIXTY60_LATITUDE) ?? saved?.latitude,
        longitude: parseCoordinate(process.env.SIXTY60_LONGITUDE) ?? saved?.longitude,
    };
};
exports.resolveLocation = resolveLocation;
const writeLocationSettings = async (latitude, longitude) => {
    const settings = {
        latitude,
        longitude,
        savedAt: new Date().toISOString(),
    };
    await (0, context_1.currentTenant)().store.writeLocation(settings);
    return settings;
};
exports.writeLocationSettings = writeLocationSettings;
