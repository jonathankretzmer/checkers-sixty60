"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTenantStore = exports.DEFAULT_TENANT = void 0;
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
const storage_1 = require("./storage");
// The single-user CLI / stdio path runs as this tenant and keeps reading and
// writing the flat `~/.checkers-sixty60/{auth,device,settings}.json` files, so
// existing installs and Claude Desktop configs are untouched.
exports.DEFAULT_TENANT = "default";
const legacyPaths = {
    auth: config_1.AUTH_FILE,
    device: config_1.DEVICE_FILE,
    settings: config_1.SETTINGS_FILE,
};
const tenantPaths = (tenantId) => {
    // Hash the identity so raw emails / subjects never land in a path, and the
    // directory name is always filesystem-safe regardless of the id's shape.
    const slug = (0, node_crypto_1.createHash)("sha256").update(tenantId).digest("hex").slice(0, 32);
    const dir = (0, node_path_1.join)(config_1.TENANTS_DIR_PATH, slug);
    return {
        auth: (0, node_path_1.join)(dir, "auth.json"),
        device: (0, node_path_1.join)(dir, "device.json"),
        settings: (0, node_path_1.join)(dir, "settings.json"),
    };
};
class FileStore {
    tenantId;
    paths;
    chains = new Map();
    constructor(tenantId) {
        this.tenantId = tenantId;
        this.paths =
            tenantId === exports.DEFAULT_TENANT ? legacyPaths : tenantPaths(tenantId);
    }
    lock(key, fn) {
        const prev = this.chains.get(key) ?? Promise.resolve();
        const run = prev.then(fn, fn);
        this.chains.set(key, run.then(() => undefined, () => undefined));
        return run;
    }
    async readJson(path) {
        const raw = await (0, storage_1.readTextFile)(path);
        if (raw === null) {
            return null;
        }
        const text = (0, crypto_1.unseal)(raw);
        const value = JSON.parse(text);
        return value ?? null;
    }
    async writeJson(path, value) {
        await (0, storage_1.writeTextFileAtomic)(path, (0, crypto_1.seal)(JSON.stringify(value, null, 2)));
    }
    readAuth() {
        return this.readJson(this.paths.auth);
    }
    writeAuth(state) {
        return this.writeJson(this.paths.auth, state);
    }
    readAddressSelection() {
        return this.readJson(this.paths.settings);
    }
    writeAddressSelection(selection) {
        return this.writeJson(this.paths.settings, selection);
    }
    clearAddressSelection() {
        return (0, storage_1.removeFile)(this.paths.settings);
    }
    async readDeviceId() {
        const existing = await this.readJson(this.paths.device);
        return existing?.deviceId ?? null;
    }
    getOrCreateDeviceId() {
        return this.lock("device", async () => {
            const existing = await this.readJson(this.paths.device);
            if (existing?.deviceId) {
                return existing.deviceId;
            }
            const deviceId = (0, node_crypto_1.randomUUID)();
            await this.writeJson(this.paths.device, {
                deviceId,
                savedAt: new Date().toISOString(),
            });
            return deviceId;
        });
    }
}
// One store instance per tenant, kept for the process lifetime so each tenant's
// lock chain persists across requests.
const registry = new Map();
const getTenantStore = (tenantId) => {
    let store = registry.get(tenantId);
    if (!store) {
        store = new FileStore(tenantId);
        registry.set(tenantId, store);
    }
    return store;
};
exports.getTenantStore = getTenantStore;
