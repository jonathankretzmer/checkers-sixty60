import { currentTenant } from "./context";
import type { AddressSelection } from "./storage";

// Tenant-scoped accessors used by api.ts / session.ts. They resolve the active
// tenant from the async context and delegate to its store, so multi-user HTTP
// hosting keeps each caller's device id and delivery-address selection isolated.

export const getOrCreateDeviceId = (): Promise<string> =>
  currentTenant().store.getOrCreateDeviceId();

export const readDeviceId = (): Promise<string | null> =>
  currentTenant().store.readDeviceId();

// The delivery address is always one of the addresses saved on the Checkers
// account. `settings.json` only records which one is pinned; an absent/empty
// selection means "use the account's most-recently-used address". There is no
// local coordinate storage and no env-var / default fallback.

export const readSelectedAddressId = async (): Promise<string | null> => {
  const selection = await currentTenant().store.readAddressSelection();
  return selection?.addressId ? selection.addressId : null;
};

export const writeSelectedAddressId = async (
  addressId: string,
): Promise<AddressSelection> => {
  const selection: AddressSelection = {
    addressId,
    savedAt: new Date().toISOString(),
  };
  await currentTenant().store.writeAddressSelection(selection);
  return selection;
};

export const clearSelectedAddress = (): Promise<void> =>
  currentTenant().store.clearAddressSelection();
