/**
 * The one fetch wrapper under the backend, beacon and keymanager adapters.
 * It parses bodies leniently (JSON, else text), maps failures to ApiError
 * kinds and applies a time limit.
 *
 * Query strings are deliberately unsupported: both the deno and the monitor
 * `/rest/*` and `/keymanager/*` proxies forward only the path and drop `?...`.
 *
 * Bodies through the proxies: the deno proxy (Nimbus `server.ts`) runs
 * `JSON.parse` on the body of every non-GET request, and oak reports a body
 * even when none was sent, so a bodiless POST/DELETE fails there with a 500
 * before the client is ever contacted. Every non-GET call through `/rest` or
 * `/keymanager` must therefore send a JSON body; a `proxied` Http sends `{}`
 * when the caller gave none, as a safety net.
 */
import { ApiError, type ApiService } from "./errors";

export type FetchLike = typeof fetch;

/** Injection points for tests. */
export interface AdapterDeps {
  fetch?: FetchLike;
}

export interface HttpOptions {
  baseUrl: string;
  service: ApiService;
  fetch?: FetchLike;
  /** Default time limit per request. */
  timeoutMs?: number;
  /**
   * The base URL is a package-backend proxy to the client (`/rest`,
   * `/keymanager`). A 5xx without a client error body then means the client
   * behind the proxy is not answering (`upstream`).
   */
  proxied?: boolean;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  timeoutMs?: number;
  /** Statuses outside 2xx to return instead of throwing (e.g. 404 → null). */
  accept?: (status: number) => boolean;
}

export interface HttpResponse {
  status: number;
  data: unknown;
}

export interface Http {
  request(path: string, opts?: RequestOptions): Promise<HttpResponse>;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

/** Parse as JSON when possible; keep other text; empty → undefined. */
export function parseBody(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The server's own message: beacon/keymanager `message`, deno proxy `error`, or a plain text body. */
export function errorDetail(data: unknown): string | undefined {
  if (typeof data === "string") return data.trim() ? data.trim().slice(0, 300) : undefined;
  if (isObject(data)) {
    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string") return data.error;
  }
  return undefined;
}

/** A beacon (`{code, message}`) or keymanager (`{message}`) error body: the client itself answered. */
const isClientErrorBody = (data: unknown) =>
  isObject(data) && (typeof data.code === "number" || typeof data.message === "string");

export function createHttp(opts: HttpOptions): Http {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = opts.fetch ?? ((...args) => globalThis.fetch(...args));

  return {
    async request(path, ro = {}) {
      const method = ro.method ?? "GET";
      const headers: Record<string, string> = { Accept: "application/json" };
      let body: string | undefined;
      const payload = ro.body === undefined && opts.proxied === true && method !== "GET" ? {} : ro.body;
      if (payload !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(payload);
      }

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ro.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      let res: Response;
      let text: string;
      try {
        res = await doFetch(`${base}${path}`, { method, headers, body, signal: controller.signal });
        text = await res.text();
      } catch (cause) {
        throw new ApiError({ kind: timedOut ? "timeout" : "unreachable", service: opts.service, path, cause });
      } finally {
        clearTimeout(timer);
      }

      const data = parseBody(text);
      if (res.ok || ro.accept?.(res.status)) return { status: res.status, data };

      const upstream = opts.proxied === true && res.status >= 500 && !isClientErrorBody(data);
      throw new ApiError({
        kind: upstream ? "upstream" : "http",
        service: opts.service,
        path,
        status: res.status,
        detail: errorDetail(data),
      });
    },
  };
}

/** GET a standard `{data: ...}` response and return `data`. */
export async function getData<T>(http: Http, service: ApiService, path: string): Promise<T> {
  const { status, data } = await http.request(path);
  return unwrapData<T>(data, service, path, status);
}

export function unwrapData<T>(body: unknown, service: ApiService, path: string, status?: number): T {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new ApiError({ kind: "invalid", service, path, status, detail: "response has no data" });
  }
  return (body as { data: T }).data;
}
