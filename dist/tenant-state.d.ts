import type { LocationSettings } from "./storage";
export declare const getOrCreateDeviceId: () => Promise<string>;
export declare const resolveLocation: () => Promise<{
    latitude?: number;
    longitude?: number;
}>;
export declare const writeLocationSettings: (latitude: number, longitude: number) => Promise<LocationSettings>;
