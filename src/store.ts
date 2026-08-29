import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AUTH_FILE,
  DEVICE_FILE,
  SETTINGS_FILE,
  TENANTS_DIR_PATH,
} from "./config";
import { seal, unseal } from "./crypto";
import {
  type AuthState,
  type DeviceState,
  type LocationSettings,
  readTextFile,
  writeTextFileAtomic,
} from "./storage";

// The single-user CLI / stdio path runs as this tenant and keeps reading and
// writing the flat `~/.checkers-sixty60/{auth,device,settings}.json` files, so
// existing installs and Claude Desktop configs are untouched.
export const DEFAULT_TENANT = "default";

// A tenant is one Checkers Sixty60 login. In multi-user HTTP hosting the
// tenant id is the gateway-authenticated caller (OIDC `sub` or a trusted proxy
// header); in single-user mode it is always DEFAULT_TENANT.
export type TenantStore = {
  readonly tenantId: string;
  readAuth(): Promise<AuthState | null>;
  writeAuth(state: AuthState): Promise<void>;
  readLocation(): Promise<LocationSettings | null>;
  writeLocation(settings: LocationSettings): Promise<void>;
  getOrCreateDeviceId(): Promise<string>;
  // Serialises read-modify-write sequences for one tenant so parallel tool
  // calls can't clobber each other. Chains are keyed (e.g. "auth", "device")
  // and are NOT reentrant: never call lock(k) from inside lock(k). Nesting
  // different keys is fine (auth hydration acquires "device" internally).
  lock<T>(key: string, fn: () => Promise<T>): Promise<T>;
};

type StatePaths = {
  auth: string;
  device: string;
  settings: string;
};

const legacyPaths: StatePaths = {
  auth: AUTH_FILE,
  device: DEVICE_FILE,
  settings: SETTINGS_FILE,
};

const tenantPaths = (tenantId: string): StatePaths => {
  // Hash the identity so raw emails / subjects never land in a path, and the
  // directory name is always filesystem-safe regardless of the id's shape.
  const slug = createHash("sha256").update(tenantId).digest("hex").slice(0, 32);
  const dir = join(TENANTS_DIR_PATH, slug);
  return {
    auth: join(dir, "auth.json"),
    device: join(dir, "device.json"),
    settings: join(dir, "settings.json"),
  };
};

class FileStore implements TenantStore {
  readonly tenantId: string;
  private readonly paths: StatePaths;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    this.paths =
      tenantId === DEFAULT_TENANT ? legacyPaths : tenantPaths(tenantId);
  }

  lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.chains.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run as Promise<T>;
  }

  private async readJson<T>(path: string): Promise<T | null> {
    const raw = await readTextFile(path);
    if (raw === null) {
      return null;
    }
    const text = unseal(raw);
    const value = JSON.parse(text) as T | null;
    return value ?? null;
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await writeTextFileAtomic(path, seal(JSON.stringify(value, null, 2)));
  }

  readAuth(): Promise<AuthState | null> {
    return this.readJson<AuthState>(this.paths.auth);
  }

  writeAuth(state: AuthState): Promise<void> {
    return this.writeJson(this.paths.auth, state);
  }

  readLocation(): Promise<LocationSettings | null> {
    return this.readJson<LocationSettings>(this.paths.settings);
  }

  writeLocation(settings: LocationSettings): Promise<void> {
    return this.writeJson(this.paths.settings, settings);
  }

  getOrCreateDeviceId(): Promise<string> {
    return this.lock("device", async () => {
      const existing = await this.readJson<DeviceState>(this.paths.device);
      if (existing?.deviceId) {
        return existing.deviceId;
      }
      const deviceId = randomUUID();
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
const registry = new Map<string, TenantStore>();

export const getTenantStore = (tenantId: string): TenantStore => {
  let store = registry.get(tenantId);
  if (!store) {
    store = new FileStore(tenantId);
    registry.set(tenantId, store);
  }
  return store;
};
