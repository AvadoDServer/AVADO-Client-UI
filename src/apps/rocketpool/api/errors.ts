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

/**
 * Smartnode and client messages that mean something to an owner, in plain
 * words with the next step. First match wins.
 */
const KNOWN: Array<[RegExp, string]> = [
  [/insufficient funds/i, "The node wallet doesn't have enough ETH to pay for this, including the network fee. Add ETH to the node wallet and try again."],
  [/nonce too low|replacement transaction underpriced|already known/i, "Another transaction from the node wallet is still waiting to go through. Wait a few minutes, then try again."],
  [/execution reverted|revert/i, "Ethereum would reject this transaction, so it was not sent and no fee was paid. Reload the page and check again; if it keeps happening, contact AVADO support."],
  [/wallet (?:has not been|is not|not) initiali[sz]ed/i, "There is no node wallet on this AVADO yet. Set up your node first."],
  [/password (?:has not been|is not|not) set/i, "The node wallet has no password yet. Set up your node first, or contact AVADO support."],
  [/\b(?:ec|cc|execution client|consensus client|beacon (?:node|client)|clients?)\b[^.]*\bnot (?:yet )?synced|still syncing|is syncing/i, "Your Ethereum clients are still catching up with the network. Try again once they are in sync (Home shows their progress)."],
  [/connection refused|dial tcp|no such host|\bEOF\b|could not connect|connection reset/i, "Rocket Pool couldn't reach one of your Ethereum clients. Check that they are running on your AVADO, then try again."],
  [/deadline exceeded|timed? ?out/i, "Rocket Pool took too long to answer. Try again in a minute."],
];

/** Text that is for a developer, not an owner: codes, hashes, internal addresses, stack traces. */
const TECHNICAL = /0x[0-9a-f]{16,}|rpc error|\bcode\s*[=:]|json:|panic|goroutine|(?:^|\s)\/[a-z0-9_.-]+\/[a-z0-9_./-]+|\bstatus code\b|\berr(?:or)?:\s*\w+:|[{}[\]<>]/i;

/** Statuses at which the backend refuses the request itself (403 CSRF, 405 method, 415 content type, 421 Host). */
const TALKING_STATUSES: ReadonlySet<number> = new Set([403, 405, 415, 421]);
export const TALKING_TO_AVADO = "Something went wrong talking to your AVADO. Reload the page and try again.";

/**
 * The sentence(s) the UI shows for an error: what it means and what to do.
 * Never includes secrets. Known Smartnode messages are put in plain words;
 * anything technical (codes, hashes, paths) is left out: `errorDetails`
 * keeps it for the Advanced details.
 */
export function plainError(e: unknown): string {
  if (!isRpApiError(e)) return "Something went wrong on this page. Reload the page and try again.";
  switch (e.kind) {
    case "unreachable":
      return "The Rocket Pool package is not answering. It may be restarting: try again in a minute.";
    case "timeout":
      return "The Rocket Pool package did not answer in time. Try again in a minute.";
    case "invalid":
      return "The Rocket Pool package gave an answer this page doesn't understand. Reload the page; if it keeps happening, update the Rocket Pool package.";
    case "aborted":
      return "Cancelled.";
    case "smartnode":
      return e.detail ? readable(e.detail) : "Rocket Pool couldn't do this right now. Try again in a minute.";
    case "http":
      // The backend's own guards (CSRF, Host, method, content type): nothing the owner did, nothing to read.
      if (e.status !== undefined && TALKING_STATUSES.has(e.status)) return TALKING_TO_AVADO;
      if (e.status === 404 && (!e.detail || /^(not found|unknown api route)\.?$/i.test(e.detail.trim()))) {
        return "This version of the Rocket Pool package can't do this yet. Update the package in the AVADO Admin and try again.";
      }
      if (e.detail) return readable(e.detail);
      if (e.status === 503) return "Rocket Pool is still starting. Try again in a minute.";
      if (e.status === 502) return "The Rocket Pool service is not running yet. It may still be starting: try again in a minute.";
      if (e.status === 504) return "The Rocket Pool service did not answer in time. Try again in a minute.";
      return "The Rocket Pool package ran into a problem. Try again in a minute; if it keeps happening, contact AVADO support.";
  }
}

/** The raw error for the Advanced "Details": route, status and the server's own text. Null when there is nothing more to say. */
export function errorDetails(e: unknown): string | null {
  if (!isRpApiError(e)) return e instanceof Error && e.message ? e.message : null;
  const parts = [e.path, e.kind, e.status !== undefined ? `HTTP ${e.status}` : "", e.detail ?? ""].filter(Boolean);
  return parts.join(" · ");
}

/**
 * A status message from the backend (not an error) as the owner reads it:
 * known ones translated, URLs and CLI advice dropped. A technical one (codes,
 * hashes, paths) gives "": the caller shows its own plain words instead, and
 * the raw text only in the Advanced details.
 */
export function plainMessage(message: string): string {
  if (!message.trim()) return "";
  const text = readable(message, "");
  return text;
}

/** A server message as the owner reads it: known ones translated, technical ones replaced by `fallback`, CLI advice dropped. */
function readable(
  message: string,
  fallback = "Rocket Pool couldn't do this right now. Try again in a minute; if it keeps happening, contact AVADO support.",
): string {
  // Internal addresses mean nothing to an owner: "the execution client URL http://… does not answer" reads fine without it.
  const text = tidy(message.replace(/\s*\(?https?:\/\/[^\s,;)]+\)?/gi, "").replace(/\s{2,}/g, " "));
  const known = KNOWN.find(([re]) => re.test(text));
  if (known) return known[1];
  if (TECHNICAL.test(text)) return fallback;
  return text;
}

/** Smartnode messages often end in CLI advice ("Please run 'rocketpool …'"); drop it, it doesn't apply here. */
function tidy(message: string): string {
  const text = message.trim().replace(/\s*Please run '?rocketpool[^.]*\.?/gi, "").trim();
  const out = text || message.trim();
  return /[.!?]$/.test(out) ? out : `${out}.`;
}
