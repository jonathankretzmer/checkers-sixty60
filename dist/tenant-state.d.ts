import type { AddressSelection } from "./storage";
export declare const getOrCreateDeviceId: () => Promise<string>;
export declare const readDeviceId: () => Promise<string | null>;
export declare const readSelectedAddressId: () => Promise<string | null>;
export declare const writeSelectedAddressId: (addressId: string) => Promise<AddressSelection>;
export declare const clearSelectedAddress: () => Promise<void>;
