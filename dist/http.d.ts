type HttpOptions = {
    method?: "GET" | "POST" | "PUT";
    headers?: Record<string, string>;
    query?: Record<string, string | boolean | number | undefined>;
    body?: unknown;
};
export declare class HttpError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string);
}
export declare const http: <T>(url: string, options?: HttpOptions) => Promise<T>;
export {};
