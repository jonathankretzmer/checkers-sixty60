"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearSelectedAddress = exports.writeSelectedAddressId = exports.readSelectedAddressId = exports.readDeviceId = exports.getOrCreateDeviceId = void 0;
const context_1 = require("./context");
// Tenant-scoped accessors used by api.ts / session.ts. They resolve the active
// tenant from the async context and delegate to its store, so multi-user HTTP
// hosting keeps each caller's device id and delivery-address selection isolated.
const getOrCreateDeviceId = () => (0, context_1.currentTenant)().store.getOrCreateDeviceId();
exports.getOrCreateDeviceId = getOrCreateDeviceId;
const readDeviceId = () => (0, context_1.currentTenant)().store.readDeviceId();
exports.readDeviceId = readDeviceId;
// The delivery address is always one of the addresses saved on the Checkers
// account. `settings.json` only records which one is pinned; an absent/empty
// selection means "use the account's most-recently-used address". There is no
// local coordinate storage and no env-var / default fallback.
const readSelectedAddressId = async () => {
    const selection = await (0, context_1.currentTenant)().store.readAddressSelection();
    return selection?.addressId ? selection.addressId : null;
};
exports.readSelectedAddressId = readSelectedAddressId;
const writeSelectedAddressId = async (addressId) => {
    const selection = {
        addressId,
        savedAt: new Date().toISOString(),
    };
    await (0, context_1.currentTenant)().store.writeAddressSelection(selection);
    return selection;
};
exports.writeSelectedAddressId = writeSelectedAddressId;
const clearSelectedAddress = () => (0, context_1.currentTenant)().store.clearAddressSelection();
exports.clearSelectedAddress = clearSelectedAddress;
