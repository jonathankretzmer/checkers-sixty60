"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
const promises_1 = require("node:fs/promises");
const config_1 = require("./config");
// stderr is always written (stdout is reserved for the MCP JSON-RPC stream, and
// `docker logs` captures stderr). When SIXTY60_LOG_DIR is set, the same line is
// also appended to <dir>/mcp-server.log for volume-based log collection.
//
// Never pass secrets here (tokens, OTPs) - lines may be persisted to disk.
let dirReady = null;
const ensureLogDir = () => {
    if (!dirReady) {
        dirReady = (0, promises_1.mkdir)(config_1.LOG_DIR_PATH, { recursive: true });
    }
    return dirReady;
};
const log = (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    process.stderr.write(line);
    const file = config_1.LOG_FILE;
    if (!file) {
        return;
    }
    void ensureLogDir()
        .then(() => (0, promises_1.appendFile)(file, line))
        .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${new Date().toISOString()} log file write failed: ${detail}\n`);
    });
};
exports.log = log;
