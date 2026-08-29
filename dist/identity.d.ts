import type { IncomingMessage } from "node:http";
export declare class IdentityError extends Error {
    readonly status = 401;
    constructor(message: string);
}
export type ResolvedIdentity = {
    tenantId: string;
    label: string;
};
type AuthMode = "jwt" | "proxy" | "anonymous";
export declare const effectiveAuthMode: () => AuthMode;
export declare const resolveIdentity: (req: IncomingMessage) => Promise<ResolvedIdentity>;
export {};
