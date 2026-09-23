/**
 * Errors from the package backend, with the plain words the UI shows.
 *
 * - `unreachable`: no answer from the package at all (network error, package
 *   restarting). For a write this means we don't know if it arrived.
 * - `timeout`: no answer in time. For a write: it may still have been sent.
 * - `http`: the backend answered with an error status. `detail` carries its
 *   message (Smartnode's own error text is passed through as is, as are the
 *   backend's messages such as the wallet-exists refusal).
 * - `smartnode`: HTTP 200 but the envelope says `status: "error"`.
 * - `invalid`: an answer that isn't the JSON the API promises.
 * - `aborted`: the page cancelled the request itself (e.g. a wait no longer needed).
 */
export type RpErrorKind = "unreachable" | "timeout" | "http" | "smartnode" | "invalid" | "aborted";

export interface RpApiErrorInit {
  kind: RpErrorKind;
  /** The request path, e.g. `/api/sn/node/status`. */
  path: string;
  status?: number;
  /** The server's own message. */
  detail?: string;
  cause?: unknown;
}

export class RpApiError extends Error {
  readonly kind: RpErrorKind;
  readonly path: string;
  readonly status?: number;
  readonly detail?: string;

  constructor(init: RpApiErrorInit) {
    super(`${init.path}: ${init.kind}${init.status !== undefined ? ` ${init.status}` : ""}${init.detail ? ` (${init.detail})` : ""}`);
    this.name = "RpApiError";
    this.kind = init.kind;
    this.path = init.path;
    this.status = init.status;
    this.detail = init.detail;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }
}

export const isRpApiError = (e: unknown): e is RpApiError => e instanceof RpApiError;

/**
 * For a write: true when we can't tell whether the request reached the node
 * (no answer, timed out, or the backend reports that the daemon timed out).
 * The UI must then not offer to send again without the owner checking first.
 */
export function isOutcomeUnknown(e: unknown): boolean {
  if (!isRpApiError(e)) return true;
  if (e.kind === "unreachable" || e.kind === "timeout" || e.kind === "invalid" || e.kind === "aborted") return true;
  // 504: the backend's time limit towards the daemon ran out; 499/502 on a
  // write can also come after the daemon received it.
  return e.kind === "http" && (e.status === 504 || e.status === 502 || e.status === 499);
}

/** Statuses at which the backend refuses before anything reaches the daemon. */
const REFUSED_BEFORE_DAEMON = new Set([400, 403, 404, 405, 409, 413, 415, 421, 429, 503]);

/**
 * For a write: true only when the backend itself refused it (bad request,
 * CSRF, wallet guard, busy, daemon token missing), so it certainly never
 * reached the daemon. A Smartnode error (500, or a 200 with status "error")
 * means it was most likely not sent, but not certainly.
 */
export const isDefinitelyNotSent = (e: unknown): boolean =>
  isRpApiError(e) && e.kind === "http" && e.status !== undefined && REFUSED_BEFORE_DAEMON.has(e.status);

/**
 * For `wait`: true only when Smartnode says the transaction was mined and
 * failed. Any other error while waiting (a lost connection, the execution
 * client restarting) leaves the outcome unknown.
 */
export const isTxReverted = (e: unknown): boolean =>
  isRpApiError(e) && (e.kind === "http" || e.kind === "smartnode") && /failed with status 0/i.test(e.detail ?? "");

/** The sentence(s) the UI shows for an error. Never includes secrets: only server messages and fixed text. */
export function plainError(e: unknown): string {
  if (!isRpApiError(e)) return "Something went wrong in this page. Reload it and try again.";
  switch (e.kind) {
    case "unreachable":
      return "The Rocket Pool package is not answering. It may be restarting; try again in a minute.";
    case "timeout":
      return "The Rocket Pool package did not answer in time.";
    case "invalid":
      return "The Rocket Pool package gave an answer this page does not understand.";
    case "aborted":
      return "Cancelled.";
    case "smartnode":
      return e.detail ? tidy(e.detail) : "Rocket Pool refused the request.";
    case "http":
      if (e.detail) return tidy(e.detail);
      if (e.status === 503) return "Rocket Pool is still starting. Try again in a minute.";
      if (e.status === 502) return "The Rocket Pool service is not reachable. It may still be starting.";
      if (e.status === 504) return "The Rocket Pool service did not answer in time.";
      return `The Rocket Pool package answered with an error (HTTP ${e.status ?? "?"}).`;
  }
}

/** Smartnode messages often end in CLI advice ("Please run 'rocketpool …'"); drop it, it doesn't apply here. */
function tidy(message: string): string {
  const text = message.trim().replace(/\s*Please run '?rocketpool[^.]*\.?/gi, "").trim();
  const out = text || message.trim();
  return /[.!?]$/.test(out) ? out : `${out}.`;
}
