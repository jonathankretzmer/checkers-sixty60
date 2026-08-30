"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeFile = exports.writeTextFileAtomic = exports.readTextFile = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
// Low-level filesystem primitives. All typed state IO goes through the
// per-tenant store in `store.ts`, which layers JSON + optional encryption on
// top of these. State files stay 0600 and their directory 0700 (enforced here,
// re-applied on every write so files from older versions get locked down too).
const readTextFile = async (path) => {
    try {
        return await (0, promises_1.readFile)(path, "utf8");
    }
    catch (error) {
        const err = error;
        if (err.code === "ENOENT") {
            return null;
        }
        throw error;
    }
};
exports.readTextFile = readTextFile;
const writeTextFileAtomic = async (path, text) => {
    const dir = (0, node_path_1.dirname)(path);
    await (0, promises_1.mkdir)(dir, { recursive: true, mode: 0o700 });
    // Write to a unique temp file in the same directory, then rename over the
    // target. rename(2) is atomic within a filesystem, so concurrent readers
    // never observe a half-written file.
    const tmp = `${path}.${process.pid}.${(0, node_crypto_1.randomBytes)(6).toString("hex")}.tmp`;
    await (0, promises_1.writeFile)(tmp, text, { encoding: "utf8", mode: 0o600 });
    await (0, promises_1.chmod)(tmp, 0o600).catch(() => { });
    await (0, promises_1.rename)(tmp, path);
    await (0, promises_1.chmod)(dir, 0o700).catch(() => { });
    await (0, promises_1.chmod)(path, 0o600).catch(() => { });
};
exports.writeTextFileAtomic = writeTextFileAtomic;
const removeFile = async (path) => {
    try {
        await (0, promises_1.rm)(path);
    }
    catch (error) {
        const err = error;
        if (err.code !== "ENOENT") {
            throw error;
        }
    }
};
exports.removeFile = removeFile;
