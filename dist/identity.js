"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveIdentity = exports.effectiveAuthMode = exports.IdentityError = void 0;
const config_1 = require("./config");
const store_1 = require("./store");
// Derives a tenant identity from an inbound HTTP request. See config.ts for the
// mode semantics. Configuration errors (server misconfigured) throw plain
// Error; caller-fixable auth failures throw IdentityError (-> HTTP 401).
//
// `jose` is ESM-only and this package compiles to CommonJS, so it is loaded via
// dynamic import() the first time a token is verified, and typed structurally
// here to avoid cross-module-system type-import friction.
class IdentityError extends Error {
    status = 401;
    constructor(message) {
        super(message);
        this.name = "IdentityError";
    }
}
exports.IdentityError = IdentityError;
let josePromise = null;
const loadJose = () => {
    if (!josePromise) {
        josePromise = import("jose");
    }
    return josePromise;
};
let jwksResolver = null;
const getJwks = async () => {
    if (!config_1.OIDC_JWKS_URL) {
        throw new Error("jwt auth mode requires SIXTY60_OIDC_JWKS_URL (the IdP's JWKS endpoint)");
    }
    if (!jwksResolver) {
        const { createRemoteJWKSet } = await loadJose();
        jwksResolver = createRemoteJWKSet(new URL(config_1.OIDC_JWKS_URL));
    }
    return jwksResolver;
};
const effectiveAuthMode = () => {
    if (config_1.AUTH_MODE === "jwt" || config_1.AUTH_MODE === "proxy" || config_1.AUTH_MODE === "anonymous") {
        return config_1.AUTH_MODE;
    }
    if (config_1.AUTH_MODE) {
        throw new Error(`Invalid SIXTY60_AUTH_MODE: ${JSON.stringify(config_1.AUTH_MODE)} (jwt|proxy|anonymous)`);
    }
    if (config_1.OIDC_ISSUER || config_1.OIDC_JWKS_URL) {
        return "jwt";
    }
    if (config_1.TRUST_PROXY_AUTH) {
        return "proxy";
    }
    if (config_1.ALLOW_ANONYMOUS) {
        return "anonymous";
    }
    throw new Error("HTTP MCP hosting needs an auth mode. Set SIXTY60_AUTH_MODE=jwt with " +
        "SIXTY60_OIDC_JWKS_URL/SIXTY60_OIDC_ISSUER, or SIXTY60_AUTH_MODE=proxy " +
        "with SIXTY60_TRUST_PROXY_AUTH=1, or SIXTY60_AUTH_MODE=anonymous with " +
        "SIXTY60_ALLOW_ANONYMOUS=1 for local dev.");
};
exports.effectiveAuthMode = effectiveAuthMode;
const headerValue = (req, name) => {
    const raw = req.headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
};
const bearerToken = (req) => {
    const header = headerValue(req, "authorization");
    if (!header) {
        return null;
    }
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : null;
};
const labelFromClaims = (payload, fallback) => {
    const email = typeof payload.email === "string" ? payload.email : null;
    const preferred = typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : null;
    return email ?? preferred ?? fallback;
};
const resolveIdentity = async (req) => {
    const mode = (0, exports.effectiveAuthMode)();
    if (mode === "anonymous") {
        return { tenantId: store_1.DEFAULT_TENANT, label: "anonymous" };
    }
    if (mode === "proxy") {
        const value = headerValue(req, config_1.AUTH_HEADER)?.trim();
        if (!value) {
            throw new IdentityError(`Missing ${config_1.AUTH_HEADER} header (proxy auth mode)`);
        }
        return { tenantId: value, label: value };
    }
    const token = bearerToken(req);
    if (!token) {
        throw new IdentityError("Missing bearer token");
    }
    try {
        const { jwtVerify } = await loadJose();
        const { payload } = await jwtVerify(token, await getJwks(), {
            issuer: config_1.OIDC_ISSUER ?? undefined,
            audience: config_1.OIDC_AUDIENCE ?? undefined,
        });
        const sub = typeof payload.sub === "string" ? payload.sub : null;
        if (!sub) {
            throw new IdentityError("Token has no `sub` claim to key the tenant on");
        }
        return { tenantId: sub, label: labelFromClaims(payload, sub) };
    }
    catch (error) {
        if (error instanceof IdentityError) {
            throw error;
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new IdentityError(`Token verification failed: ${detail}`);
    }
};
exports.resolveIdentity = resolveIdentity;
