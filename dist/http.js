"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.http = exports.HttpError = void 0;
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
    };
    const response = await fetch(fullUrl, requestInit);
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
