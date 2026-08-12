import { homedir } from "node:os";

const HOME = process.env.HOME ?? homedir();

export const AUTH_FILE = `${HOME}/.checkers-sixty60/auth.json`;
export const DEVICE_FILE = `${HOME}/.checkers-sixty60/device.json`;
export const SETTINGS_FILE = `${HOME}/.checkers-sixty60/settings.json`;
