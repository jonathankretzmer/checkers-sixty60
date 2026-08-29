import type { IncomingMessage } from "node:http";
import {
  ALLOW_ANONYMOUS,
  AUTH_HEADER,
  AUTH_MODE,
  OIDC_AUDIENCE,
  OIDC_ISSUER,
  OIDC_JWKS_URL,
  TRUST_PROXY_AUTH,
} from "./config";
import { DEFAULT_TENANT } from "./store";

// Derives a tenant identity from an inbound HTTP request. See config.ts for the
// mode semantics. Configuration errors (server misconfigured) throw plain
// Error; caller-fixable auth failures throw IdentityError (-> HTTP 401).
//
// `jose` is ESM-only and this package compiles to CommonJS, so it is loaded via
// dynamic import() the first time a token is verified, and typed structurally
// here to avoid cross-module-system type-import friction.

export class IdentityError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

export type ResolvedIdentity = {
  tenantId: string;
  label: string;
};

type AuthMode = "jwt" | "proxy" | "anonymous";

type JwtPayload = {
  sub?: unknown;
  email?: unknown;
  preferred_username?: unknown;
  [claim: string]: unknown;
};

type JwksResolver = (
  protectedHeader?: unknown,
  token?: unknown,
) => Promise<unknown>;

type JoseLike = {
  createRemoteJWKSet: (url: URL) => JwksResolver;
  jwtVerify: (
    jwt: string,
    key: JwksResolver,
    options?: { issuer?: string; audience?: string },
  ) => Promise<{ payload: JwtPayload }>;
};

let josePromise: Promise<JoseLike> | null = null;
const loadJose = (): Promise<JoseLike> => {
  if (!josePromise) {
    josePromise = import("jose") as unknown as Promise<JoseLike>;
  }
  return josePromise;
};

let jwksResolver: JwksResolver | null = null;
const getJwks = async (): Promise<JwksResolver> => {
  if (!OIDC_JWKS_URL) {
    throw new Error(
      "jwt auth mode requires SIXTY60_OIDC_JWKS_URL (the IdP's JWKS endpoint)",
    );
  }
  if (!jwksResolver) {
    const { createRemoteJWKSet } = await loadJose();
    jwksResolver = createRemoteJWKSet(new URL(OIDC_JWKS_URL));
  }
  return jwksResolver;
};

export const effectiveAuthMode = (): AuthMode => {
  if (AUTH_MODE === "jwt" || AUTH_MODE === "proxy" || AUTH_MODE === "anonymous") {
    return AUTH_MODE;
  }
  if (AUTH_MODE) {
    throw new Error(
      `Invalid SIXTY60_AUTH_MODE: ${JSON.stringify(AUTH_MODE)} (jwt|proxy|anonymous)`,
    );
  }
  if (OIDC_ISSUER || OIDC_JWKS_URL) {
    return "jwt";
  }
  if (TRUST_PROXY_AUTH) {
    return "proxy";
  }
  if (ALLOW_ANONYMOUS) {
    return "anonymous";
  }
  throw new Error(
    "HTTP MCP hosting needs an auth mode. Set SIXTY60_AUTH_MODE=jwt with " +
      "SIXTY60_OIDC_JWKS_URL/SIXTY60_OIDC_ISSUER, or SIXTY60_AUTH_MODE=proxy " +
      "with SIXTY60_TRUST_PROXY_AUTH=1, or SIXTY60_AUTH_MODE=anonymous with " +
      "SIXTY60_ALLOW_ANONYMOUS=1 for local dev.",
  );
};

const headerValue = (req: IncomingMessage, name: string): string | undefined => {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
};

const bearerToken = (req: IncomingMessage): string | null => {
  const header = headerValue(req, "authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
};

const labelFromClaims = (payload: JwtPayload, fallback: string): string => {
  const email = typeof payload.email === "string" ? payload.email : null;
  const preferred =
    typeof payload.preferred_username === "string"
      ? payload.preferred_username
      : null;
  return email ?? preferred ?? fallback;
};

export const resolveIdentity = async (
  req: IncomingMessage,
): Promise<ResolvedIdentity> => {
  const mode = effectiveAuthMode();

  if (mode === "anonymous") {
    return { tenantId: DEFAULT_TENANT, label: "anonymous" };
  }

  if (mode === "proxy") {
    const value = headerValue(req, AUTH_HEADER)?.trim();
    if (!value) {
      throw new IdentityError(`Missing ${AUTH_HEADER} header (proxy auth mode)`);
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
      issuer: OIDC_ISSUER ?? undefined,
      audience: OIDC_AUDIENCE ?? undefined,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) {
      throw new IdentityError("Token has no `sub` claim to key the tenant on");
    }
    return { tenantId: sub, label: labelFromClaims(payload, sub) };
  } catch (error) {
    if (error instanceof IdentityError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new IdentityError(`Token verification failed: ${detail}`);
  }
};
