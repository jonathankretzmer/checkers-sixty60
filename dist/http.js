"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.http = exports.HttpError = void 0;
const DEFAULT_TIMEOUT_MS = 20_000;
class HttpError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`HTTP ${status}: ${body}`);
        this.name = "HttpError";
        this.status = status;
        this.body = body;
    }
}
exports.HttpError = HttpError;
const withQuery = (url, query) => {
    if (!query) {
        return url;
    }
    const u = new URL(url);
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
            u.searchParams.set(key, String(value));
        }
    }
    return u.toString();
};
const http = async (url, options = {}) => {
    const fullUrl = withQuery(url, options.query);
    const method = options.method ?? "GET";
    const requestInit = {
        method,
        headers: options.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    };
    let response;
    try {
        response = await fetch(fullUrl, requestInit);
    }
    catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
            throw new Error(`Request to ${new URL(fullUrl).host} timed out`);
        }
        throw error;
    }
    const text = await response.text();
    if (!response.ok) {
        throw new HttpError(response.status, text);
    }
    if (!text) {
        return {};
    }
    return JSON.parse(text);
};
exports.http = http;
