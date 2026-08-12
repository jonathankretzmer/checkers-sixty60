"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTINGS_FILE = exports.DEVICE_FILE = exports.AUTH_FILE = void 0;
const node_os_1 = require("node:os");
const HOME = process.env.HOME ?? (0, node_os_1.homedir)();
exports.AUTH_FILE = `${HOME}/.checkers-sixty60/auth.json`;
exports.DEVICE_FILE = `${HOME}/.checkers-sixty60/device.json`;
exports.SETTINGS_FILE = `${HOME}/.checkers-sixty60/settings.json`;
