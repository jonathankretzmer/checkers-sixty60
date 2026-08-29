type HttpOptions = {
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  query?: Record<string, string | boolean | number | undefined>;
  body?: unknown;
  // Abort the request after this many ms (default 20s). Guards against a slow
  // or hung upstream pinning a connection / request indefinitely.
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

export class HttpError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

const withQuery = (url: string, query?: HttpOptions["query"]): string => {
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

export const http = async <T>(
  url: string,
  options: HttpOptions = {},
): Promise<T> => {
  const fullUrl = withQuery(url, options.query);
  const method = options.method ?? "GET";
  const requestInit: RequestInit = {
    method,
    headers: options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };

  let response: Response;
  try {
    response = await fetch(fullUrl, requestInit);
  } catch (error) {
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
    return {} as T;
  }

  return JSON.parse(text) as T;
};
