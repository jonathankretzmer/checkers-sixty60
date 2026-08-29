import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { STATE_KEY_B64 } from "./config";

// Optional envelope encryption for at-rest tenant state (auth tokens, device
// ids, saved location). Enabled only when SIXTY60_STATE_KEY is set to a
// base64-encoded 32-byte key. When unset, files are written as plaintext JSON,
// which is the historical single-user CLI behaviour.
//
// On-disk format when enabled: a JSON object
//   { "__enc": "a256gcm", "v": 1, "iv": <b64>, "ct": <b64>, "tag": <b64> }
// Plaintext JSON is still read back transparently, so turning the key on for an
// existing install is a no-op until each file is next written.

const ALG = "aes-256-gcm";

type Envelope = {
  __enc: "a256gcm";
  v: 1;
  iv: string;
  ct: string;
  tag: string;
};

let keyCache: Buffer | null | undefined;

const key = (): Buffer | null => {
  if (keyCache !== undefined) {
    return keyCache;
  }
  if (!STATE_KEY_B64) {
    keyCache = null;
    return null;
  }
  const decoded = Buffer.from(STATE_KEY_B64, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      "SIXTY60_STATE_KEY must be a base64-encoded 32-byte key (256-bit)",
    );
  }
  keyCache = decoded;
  return decoded;
};

export const encryptionEnabled = (): boolean => key() !== null;

const looksLikeEnvelope = (value: unknown): value is Envelope => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.__enc === "a256gcm" &&
    typeof candidate.iv === "string" &&
    typeof candidate.ct === "string" &&
    typeof candidate.tag === "string"
  );
};

export const seal = (plaintext: string): string => {
  const k = key();
  if (!k) {
    return plaintext;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: Envelope = {
    __enc: "a256gcm",
    v: 1,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
  return JSON.stringify(envelope);
};

export const unseal = (raw: string): string => {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("{")) {
    return raw;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  if (!looksLikeEnvelope(parsed)) {
    // Plaintext JSON payload (or a JSON value that is not our envelope).
    return raw;
  }

  const k = key();
  if (!k) {
    throw new Error(
      "Encrypted state file found but SIXTY60_STATE_KEY is not set",
    );
  }

  const iv = Buffer.from(parsed.iv, "base64");
  const ct = Buffer.from(parsed.ct, "base64");
  const tag = Buffer.from(parsed.tag, "base64");
  const decipher = createDecipheriv(ALG, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
};

// Constant-time string compare, exported for auth-adjacent checks that compare
// secrets (kept here so there is a single vetted implementation).
export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
};
