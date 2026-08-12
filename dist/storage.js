"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeLocationSettings = exports.readLocationSettings = exports.getOrCreateDeviceId = exports.writeJsonFile = exports.readJsonFile = void 0;
const promises_1 = require("node:fs/promises");
const config_1 = require("./config");
const readJsonFile = async (path) => {
    try {
        const text = await (0, promises_1.readFile)(path, "utf8");
        return JSON.parse(text);
    }
    catch (error) {
        const err = error;
        if (err.code === "ENOENT") {
            return null;
        }
        throw error;
    }
};
exports.readJsonFile = readJsonFile;
const writeJsonFile = async (path, value) => {
    const lastSlash = path.lastIndexOf("/");
    const dir = lastSlash > 0 ? path.slice(0, lastSlash) : ".";
    await (0, promises_1.mkdir)(dir, { recursive: true, mode: 0o700 });
    await (0, promises_1.writeFile)(path, JSON.stringify(value, null, 2), {
        encoding: "utf8",
        mode: 0o600,
    });
    // writeFile's mode option only applies when the file is newly created, so
    // chmod explicitly to also lock down files written by earlier versions.
    await (0, promises_1.chmod)(dir, 0o700).catch(() => { });
    await (0, promises_1.chmod)(path, 0o600).catch(() => { });
};
exports.writeJsonFile = writeJsonFile;
const getOrCreateDeviceId = async () => {
    const existing = await (0, exports.readJsonFile)(config_1.DEVICE_FILE);
    if (existing?.deviceId) {
        return existing.deviceId;
    }
    const deviceId = crypto.randomUUID();
    await (0, exports.writeJsonFile)(config_1.DEVICE_FILE, {
        deviceId,
        savedAt: new Date().toISOString(),
    });
    return deviceId;
};
exports.getOrCreateDeviceId = getOrCreateDeviceId;
const readLocationSettings = async () => {
    return (0, exports.readJsonFile)(config_1.SETTINGS_FILE);
};
exports.readLocationSettings = readLocationSettings;
const writeLocationSettings = async (latitude, longitude) => {
    const settings = {
        latitude,
        longitude,
        savedAt: new Date().toISOString(),
    };
    await (0, exports.writeJsonFile)(config_1.SETTINGS_FILE, settings);
    return settings;
};
exports.writeLocationSettings = writeLocationSettings;
