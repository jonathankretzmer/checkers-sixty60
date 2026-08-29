import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type AuthState = {
  phoneE164: string;
  bffToken?: string;
  userAccessToken?: string;
  refreshToken?: string;
  otpReference?: string;
  customerId?: string;
  userId?: string;
  email?: string;
  storeIds?: string[];
  savedAt: string;
};

export type DeviceState = {
  deviceId: string;
  savedAt: string;
};

export type LocationSettings = {
  latitude: number;
  longitude: number;
  savedAt: string;
};

// Low-level filesystem primitives. All typed state IO goes through the
// per-tenant store in `store.ts`, which layers JSON + optional encryption on
// top of these. State files stay 0600 and their directory 0700 (enforced here,
// re-applied on every write so files from older versions get locked down too).

export const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const writeTextFileAtomic = async (
  path: string,
  text: string,
): Promise<void> => {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  // Write to a unique temp file in the same directory, then rename over the
  // target. rename(2) is atomic within a filesystem, so concurrent readers
  // never observe a half-written file.
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {});
  await rename(tmp, path);

  await chmod(dir, 0o700).catch(() => {});
  await chmod(path, 0o600).catch(() => {});
};
