"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeEqual = exports.unseal = exports.seal = exports.encryptionEnabled = void 0;
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
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
let keyCache;
const key = () => {
    if (keyCache !== undefined) {
        return keyCache;
    }
    if (!config_1.STATE_KEY_B64) {
        keyCache = null;
        return null;
    }
    const decoded = Buffer.from(config_1.STATE_KEY_B64, "base64");
    if (decoded.length !== 32) {
        throw new Error("SIXTY60_STATE_KEY must be a base64-encoded 32-byte key (256-bit)");
    }
    keyCache = decoded;
    return decoded;
};
const encryptionEnabled = () => key() !== null;
exports.encryptionEnabled = encryptionEnabled;
const looksLikeEnvelope = (value) => {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value;
    return (candidate.__enc === "a256gcm" &&
        typeof candidate.iv === "string" &&
        typeof candidate.ct === "string" &&
        typeof candidate.tag === "string");
};
const seal = (plaintext) => {
    const k = key();
    if (!k) {
        return plaintext;
    }
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)(ALG, k, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = {
        __enc: "a256gcm",
        v: 1,
        iv: iv.toString("base64"),
        ct: ct.toString("base64"),
        tag: tag.toString("base64"),
    };
    return JSON.stringify(envelope);
};
exports.seal = seal;
const unseal = (raw) => {
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("{")) {
        return raw;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return raw;
    }
    if (!looksLikeEnvelope(parsed)) {
        // Plaintext JSON payload (or a JSON value that is not our envelope).
        return raw;
    }
    const k = key();
    if (!k) {
        throw new Error("Encrypted state file found but SIXTY60_STATE_KEY is not set");
    }
    const iv = Buffer.from(parsed.iv, "base64");
    const ct = Buffer.from(parsed.ct, "base64");
    const tag = Buffer.from(parsed.tag, "base64");
    const decipher = (0, node_crypto_1.createDecipheriv)(ALG, k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
};
exports.unseal = unseal;
// Constant-time string compare, exported for auth-adjacent checks that compare
// secrets (kept here so there is a single vetted implementation).
const safeEqual = (a, b) => {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        return false;
    }
    return (0, node_crypto_1.timingSafeEqual)(bufA, bufB);
};
exports.safeEqual = safeEqual;
