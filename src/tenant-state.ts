import { currentTenant } from "./context";
import { DEFAULT_TENANT } from "./store";
import type { LocationSettings } from "./storage";

// Tenant-scoped accessors used by api.ts. These replace the old module-level
// helpers in storage.ts: they resolve the active tenant from the async context
// and delegate to its store, so multi-user HTTP hosting keeps each caller's
// device id and saved location isolated.

export const getOrCreateDeviceId = (): Promise<string> =>
  currentTenant().store.getOrCreateDeviceId();

const parseCoordinate = (value: string | undefined): number | undefined => {
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
export const resolveLocation = async (): Promise<{
  latitude?: number;
  longitude?: number;
}> => {
  const ctx = currentTenant();
  const saved = await ctx.store.readLocation();

  if (ctx.tenantId !== DEFAULT_TENANT) {
    return { latitude: saved?.latitude, longitude: saved?.longitude };
  }

  return {
    latitude:
      parseCoordinate(process.env.SIXTY60_LATITUDE) ?? saved?.latitude,
    longitude:
      parseCoordinate(process.env.SIXTY60_LONGITUDE) ?? saved?.longitude,
  };
};

export const writeLocationSettings = async (
  latitude: number,
  longitude: number,
): Promise<LocationSettings> => {
  const settings: LocationSettings = {
    latitude,
    longitude,
    savedAt: new Date().toISOString(),
  };
  await currentTenant().store.writeLocation(settings);
  return settings;
};
