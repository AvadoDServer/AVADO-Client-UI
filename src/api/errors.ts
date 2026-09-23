/**
 * Typed errors from the real adapters, so pages can tell "the client is
 * starting" apart from "the package is down" and from a real refusal.
 */

/** Which adapter raised the error. */
export type ApiService = "backend" | "beacon" | "keymanager" | "dappmanager";

/**
 * - `unreachable`: no answer from the package backend (:9999) or the WAMP
 *   router at all: network error, DNS, CORS, connection refused or closed.
 * - `upstream`: the package backend answered, but the client behind its
 *   `/rest` or `/keymanager` proxy did not (for example Nimbus is starting or
 *   stopped). The proxies report this as a 5xx without a beacon/keymanager
 *   error body.
 * - `http`: the backend or the client answered with an error status (or, for
 *   the service routes, a "failed" body).
 * - `timeout`: no answer within the time limit.
 * - `invalid`: an answer arrived but its shape is not what the API promises.
 * - `rejected`: DAPPMANAGER returned `success: false`, or the WAMP router
 *   refused the call or the session.
 */
export type ApiErrorKind = "unreachable" | "upstream" | "http" | "timeout" | "invalid" | "rejected";

export interface ApiErrorInit {
  kind: ApiErrorKind;
  service: ApiService;
  /** Request path or WAMP procedure. */
  path?: string;
  /** HTTP status, when there was a response. */
  status?: number;
  /** The server's own message, when it gave one. */
  detail?: string;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly service: ApiService;
  readonly path?: string;
  readonly status?: number;
  readonly detail?: string;

  constructor(init: ApiErrorInit) {
    super(buildMessage(init));
    this.name = "ApiError";
    this.kind = init.kind;
    this.service = init.service;
    this.path = init.path;
    this.status = init.status;
    this.detail = init.detail;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }
}

function buildMessage({ kind, service, path, status, detail }: ApiErrorInit): string {
  const where = path ? `${service} ${path}` : service;
  const what: Record<ApiErrorKind, string> = {
    unreachable: "not reachable",
    upstream: "client not answering",
    http: status !== undefined ? `HTTP ${status}` : "error",
    timeout: "timed out",
    invalid: "unexpected response",
    rejected: "rejected",
  };
  return `${where}: ${what[kind]}${detail ? ` (${detail})` : ""}`;
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/**
 * True when the client (or its package) is not answering right now: starting,
 * stopped, restarting or unreachable. Pages show "Nimbus is starting" style
 * copy for these instead of an error.
 */
export const isClientUnavailable = (e: unknown): boolean =>
  isApiError(e) && (e.kind === "unreachable" || e.kind === "upstream" || e.kind === "timeout");
