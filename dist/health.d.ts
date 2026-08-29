import { type Server } from "node:http";
export declare const HEALTHCHECK_PORT_ENV = "SIXTY60_HEALTHCHECK_PORT";
export declare const HEALTHCHECK_HOST_ENV = "SIXTY60_HEALTHCHECK_HOST";
export declare const DEFAULT_HEALTHCHECK_PORT = 8080;
export type McpHealth = {
    ok: boolean;
    ready: boolean;
    detail: Record<string, unknown>;
};
export type HealthProvider = () => McpHealth;
export declare const healthcheckPort: () => number | null;
export declare const startHealthServer: (provider: HealthProvider, port: number, host?: string) => Promise<Server>;
export declare const runHealthProbe: (port: number, path?: string) => Promise<number>;
