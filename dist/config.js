"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIXTY60_PROFILE_TOKEN = exports.SIXTY60_API_KEY_AUTH = exports.SIXTY60_API_KEY = exports.ALLOW_ANONYMOUS = exports.TRUST_PROXY_AUTH = exports.AUTH_HEADER = exports.OIDC_AUDIENCE = exports.OIDC_JWKS_URL = exports.OIDC_ISSUER = exports.AUTH_MODE = exports.STATE_KEY_B64 = exports.MCP_HTTP_PORT = exports.LOG_FILE = exports.LOG_DIR_PATH = exports.TENANTS_DIR_PATH = exports.SETTINGS_FILE = exports.DEVICE_FILE = exports.AUTH_FILE = exports.DATA_DIR_PATH = void 0;
const node_os_1 = require("node:os");
// All persistent state lives under a single base directory so a container can
// mount one volume for it. Override with SIXTY60_DATA_DIR (e.g. `/data`);
// defaults to ~/.checkers-sixty60 so plain CLI installs are unchanged.
const DATA_DIR = process.env.SIXTY60_DATA_DIR?.trim() ||
    `${process.env.HOME ?? (0, node_os_1.homedir)()}/.checkers-sixty60`;
exports.DATA_DIR_PATH = DATA_DIR;
exports.AUTH_FILE = `${DATA_DIR}/auth.json`;
exports.DEVICE_FILE = `${DATA_DIR}/device.json`;
// Holds the pinned delivery-address selection (see src/tenant-state.ts). All
// coordinates come from the addresses saved on the Checkers account itself —
// there is no local coordinate storage or fallback.
exports.SETTINGS_FILE = `${DATA_DIR}/settings.json`;
// Per-tenant state (multi-user HTTP hosting) lives under DATA_DIR/tenants/<slug>.
// The single-user CLI / stdio path keeps writing the flat files above.
exports.TENANTS_DIR_PATH = `${DATA_DIR}/tenants`;
// Optional directory for file logs, kept separate from state so it can be a
// distinct volume. Unset -> logs go to stderr only (the Docker default,
// captured by `docker logs`). Set SIXTY60_LOG_DIR to also append to a file.
const LOG_DIR = process.env.SIXTY60_LOG_DIR?.trim();
exports.LOG_DIR_PATH = LOG_DIR || null;
exports.LOG_FILE = LOG_DIR
    ? `${LOG_DIR}/mcp-server.log`
    : null;
const port = (name) => {
    const raw = process.env[name]?.trim();
    if (!raw) {
        return null;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid ${name}: ${JSON.stringify(raw)}`);
    }
    return parsed;
};
// --- Streamable HTTP MCP hosting (multi-tenant) ------------------------------
//
// The CLI and Claude Desktop use the stdio transport and never touch any of
// this. `checkers-sixty60 mcp --http` (or `dist/mcp-server.js --http`) starts a
// Streamable HTTP server intended to run behind an MCP gateway (e.g. Obot) that
// terminates OAuth and forwards the caller's identity.
// Port for the Streamable HTTP server. When set, `--http` uses it; otherwise it
// falls back to the healthcheck port / 8080.
exports.MCP_HTTP_PORT = port("SIXTY60_MCP_HTTP_PORT");
// Base64-encoded 32-byte key enabling envelope encryption of at-rest tenant
// state. Unset -> plaintext JSON (historical CLI behaviour).
exports.STATE_KEY_B64 = process.env.SIXTY60_STATE_KEY?.trim() || null;
// How the HTTP server derives a tenant identity from each request:
//   "jwt"       validate a Bearer token against SIXTY60_OIDC_* and key by `sub`
//   "proxy"     trust SIXTY60_AUTH_HEADER injected by a front proxy/gateway
//   "anonymous" single shared "default" tenant (dev only)
// Unset -> inferred: jwt if SIXTY60_OIDC_* is set, else proxy if the proxy
// header is trusted, else anonymous if explicitly allowed, else the server
// refuses to start (fail closed).
exports.AUTH_MODE = process.env.SIXTY60_AUTH_MODE?.trim() || null;
exports.OIDC_ISSUER = process.env.SIXTY60_OIDC_ISSUER?.trim() || null;
exports.OIDC_JWKS_URL = process.env.SIXTY60_OIDC_JWKS_URL?.trim() || null;
exports.OIDC_AUDIENCE = process.env.SIXTY60_OIDC_AUDIENCE?.trim() || null;
exports.AUTH_HEADER = (process.env.SIXTY60_AUTH_HEADER?.trim() || "x-forwarded-user").toLowerCase();
exports.TRUST_PROXY_AUTH = process.env.SIXTY60_TRUST_PROXY_AUTH === "1";
exports.ALLOW_ANONYMOUS = process.env.SIXTY60_ALLOW_ANONYMOUS === "1";
// --- Checkers Sixty60 app API credentials -----------------------------------
//
// Values the official mobile app sends on its login / OTP / customer-profile
// calls. They are NOT bundled with the source — supply them via environment or
// a local `.env` (see `.env.example`). Only the auth flow reads them; a saved
// session works without. `api.ts` throws a clear error if one is needed but
// missing.
exports.SIXTY60_API_KEY = process.env.SIXTY60_API_KEY?.trim() || null;
exports.SIXTY60_API_KEY_AUTH = process.env.SIXTY60_API_KEY_AUTH?.trim() || null;
exports.SIXTY60_PROFILE_TOKEN = process.env.SIXTY60_PROFILE_TOKEN?.trim() || null;
