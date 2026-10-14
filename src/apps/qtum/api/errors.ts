/**
 * Errors from the Qtum package's backend, with the plain words the UI shows.
 *
 * - `unreachable`: no answer from the package at all (network error, package
 *   restarting). For a write we can't tell whether it arrived.
 * - `timeout`: no answer in time.
 * - `http`: the backend answered with an error status. `detail` carries the
 *   monitor's own message, which is already written for the owner.
 * - `rpc`: the Qtum node answered with an error (`code` is its error code).
 * - `invalid`: an answer that isn't what the API promises.
 */
export type QtumErrorKind = "unreachable" | "timeout" | "http" | "rpc" | "invalid";

export interface QtumApiErrorInit {
  kind: QtumErrorKind;
  /** The request path (`/monitor/walletstatus`) or the RPC method (`rpc getbalances`). */
  path: string;
  status?: number;
  /** The server's own message. */
  detail?: string;
  /** The Qtum node's RPC error code. */
  code?: number;
  cause?: unknown;
}

export class QtumApiError extends Error {
  readonly kind: QtumErrorKind;
  readonly path: string;
  readonly status?: number;
  readonly detail?: string;
  readonly code?: number;

  constructor(init: QtumApiErrorInit) {
    super(
      `${init.path}: ${init.kind}${init.status !== undefined ? ` ${init.status}` : ""}${init.code !== undefined ? ` code ${init.code}` : ""}${
        init.detail ? ` (${init.detail})` : ""
      }`,
    );
    this.name = "QtumApiError";
    this.kind = init.kind;
    this.path = init.path;
    this.status = init.status;
    this.detail = init.detail;
    this.code = init.code;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }
}

export const isQtumApiError = (e: unknown): e is QtumApiError => e instanceof QtumApiError;

/** Qtum RPC error codes the app explains. */
export const RPC = {
  /** RPC_IN_WARMUP: the node is starting (loading blocks, verifying). */
  WARMUP: -28,
  /** RPC_WALLET_NOT_FOUND: no wallet loaded. */
  WALLET_NOT_FOUND: -18,
  /** RPC_WALLET_PASSPHRASE_INCORRECT. */
  WRONG_PASSPHRASE: -14,
  /** RPC_WALLET_UNLOCK_NEEDED. */
  UNLOCK_NEEDED: -13,
  /** RPC_WALLET_WRONG_ENC_STATE: e.g. unlocking a wallet without a password. */
  WRONG_ENC_STATE: -15,
} as const;

/** The node is starting or not running: its RPC isn't there yet. */
export function isNodeStarting(e: unknown): boolean {
  if (!isQtumApiError(e)) return false;
  if (e.kind === "rpc") return e.code === RPC.WARMUP;
  return e.kind === "http" && e.status !== undefined && [502, 503, 504].includes(e.status);
}

/** No answer from the package at all. */
export const isUnreachable = (e: unknown): boolean => isQtumApiError(e) && (e.kind === "unreachable" || e.kind === "timeout");

export const TALKING_TO_AVADO = "Something went wrong talking to your AVADO. Reload the page and try again.";

/** Monitor and node messages that are for a developer, not an owner. */
const TECHNICAL = /\bcode\s*[=:-]|json|stack|[{}[\]<>]|(?:^|\s)\/[a-z0-9_.-]+\/[a-z0-9_./-]+|\bat [A-Za-z]+\.|ECONN|EACCES|ENOENT/i;

/**
 * The sentence(s) the UI shows for an error: what it means and what to do.
 * The monitor's own messages are already plain and pass through; the node's
 * known errors are put in plain words; anything technical is replaced.
 */
export function plainError(e: unknown): string {
  if (!isQtumApiError(e)) return "Something went wrong on this page. Reload the page and try again.";
  switch (e.kind) {
    case "unreachable":
      return "The Qtum package is not answering. It may be restarting: try again in a minute.";
    case "timeout":
      return "The Qtum package did not answer in time. Try again in a minute.";
    case "invalid":
      return "The Qtum package gave an answer this page doesn't understand. Reload the page; if it keeps happening, update the Qtum package.";
    case "rpc":
      switch (e.code) {
        case RPC.WARMUP:
          return "The Qtum node is still starting. Please try again in a few minutes.";
        case RPC.WALLET_NOT_FOUND:
          return "Your wallet is not loaded yet. Please wait a moment and try again.";
        case RPC.WRONG_PASSPHRASE:
          return "That password is not right. Please check it and try again.";
        case RPC.UNLOCK_NEEDED:
          return "Your wallet is locked with a password. Unlock it for staking on the Wallet page first.";
        case RPC.WRONG_ENC_STATE:
          return "Your wallet has no password, so it does not need to be unlocked.";
        default:
          return "The Qtum node could not do this right now. Try again in a minute; if it keeps happening, contact AVADO support.";
      }
    case "http":
      if (e.status === 403) return TALKING_TO_AVADO;
      if (e.status === 404 && (!e.detail || /not ?found/i.test(e.detail))) {
        return "This version of the Qtum package can't do this yet. Update the package in the AVADO Admin and try again.";
      }
      if (e.detail && !TECHNICAL.test(e.detail)) return e.detail;
      if (e.status !== undefined && [502, 503, 504].includes(e.status)) {
        return "The Qtum node is not running yet. It may still be starting: try again in a few minutes.";
      }
      return "The Qtum package ran into a problem. Try again in a minute; if it keeps happening, contact AVADO support.";
  }
}

/** The raw error for the Advanced "Details": path, status, code and the server's own text. */
export function errorDetails(e: unknown): string | null {
  if (!isQtumApiError(e)) return e instanceof Error && e.message ? e.message : null;
  const parts = [e.path, e.kind, e.status !== undefined ? `HTTP ${e.status}` : "", e.code !== undefined ? `code ${e.code}` : "", e.detail ?? ""].filter(
    Boolean,
  );
  return parts.join(" · ");
}
