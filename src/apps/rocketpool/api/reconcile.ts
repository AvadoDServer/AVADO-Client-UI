/**
 * Reading the key/fee-recipient loop's status safely. The file is written by
 * another process and may be from an older or newer backend: every field is
 * checked, anything missing or of the wrong type gets a safe default, and a
 * file that isn't a status at all gives undefined.
 */
import type {
  ReconcileClient,
  ReconcileFeeState,
  ReconcileKey,
  ReconcileKeyState,
  ReconcileState,
  ReconcileStatus,
  ReconcileView,
} from "./models";

const STATES: readonly ReconcileState[] = ["ok", "waiting", "attention", "error"];
const KEY_STATES: readonly ReconcileKeyState[] = [
  "loaded",
  "imported",
  "elsewhere",
  "awaiting-approval",
  "import-blocked",
  "missing-keystore",
  "import-failed",
  "retry-limit",
  "deferred",
  "no-client",
];
const FEE_STATES: readonly ReconcileFeeState[] = ["ok", "fixed", "failed", "no-address", "not-loaded"];
const TRIGGERS = ["startup", "timer", "request"] as const;
const CHOICE_SOURCES = ["setting", "only-installed", "none"] as const;

const PUBKEY = /^[0-9a-f]{96}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);

/** "0xABC…" or "abc…" → 96 lower-case hex, or null. */
export function normalizePubkey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const hex = (v.startsWith("0x") || v.startsWith("0X") ? v.slice(2) : v).toLowerCase();
  return PUBKEY.test(hex) ? hex : null;
}

function client(v: unknown): ReconcileClient | null {
  if (!isObject(v)) return null;
  const pkg = str(v.package);
  if (!pkg) return null;
  return { id: str(v.id) ?? pkg, name: str(v.name) ?? pkg, package: pkg };
}

function key(v: unknown): ReconcileKey | null {
  if (!isObject(v)) return null;
  const pubkey = normalizePubkey(v.pubkey);
  const state = oneOf(v.state, KEY_STATES);
  if (!pubkey || !state) return null;
  const fee = isObject(v.feeRecipient) ? v.feeRecipient : {};
  const out: ReconcileKey = {
    pubkey,
    kind: v.kind === "megapool" ? "megapool" : "minipool",
    ref: typeof v.ref === "string" || typeof v.ref === "number" ? String(v.ref) : "",
    state,
    feeRecipient: {
      rule: str(fee.rule) ?? "",
      expected: str(fee.expected),
      state: oneOf(fee.state, FEE_STATES) ?? "not-loaded",
    },
  };
  if (fee.found !== undefined) out.feeRecipient.found = str(fee.found);
  if (str(v.loadedIn)) out.loadedIn = v.loadedIn as string;
  if (str(v.error)) out.error = v.error as string;
  return out;
}

/** The status from `GET /api/avado/reconcile`, normalised; undefined when there is none or it isn't one. */
export function parseReconcileStatus(raw: unknown): ReconcileStatus | undefined {
  if (!isObject(raw)) return undefined;
  const state = oneOf(raw.state, STATES);
  if (!state) return undefined;
  const keys = isObject(raw.keys) ? raw.keys : {};
  const fee = isObject(raw.feeRecipients) ? raw.feeRecipients : {};
  const choice = isObject(raw.clientChoice) ? raw.clientChoice : null;
  const choiceSource = choice ? oneOf(choice.source, CHOICE_SOURCES) : null;
  const total = count(keys.total);
  const inSync = Math.min(count(keys.inSync), total);
  const awaiting = [...new Set((Array.isArray(raw.awaitingApproval) ? raw.awaitingApproval : []).map(normalizePubkey))].filter(
    (k): k is string => k !== null,
  );
  return {
    version: count(raw.version),
    state,
    message: str(raw.message) ?? "",
    startedAt: str(raw.startedAt),
    finishedAt: str(raw.finishedAt),
    trigger: oneOf(raw.trigger, TRIGGERS),
    nextRunAt: str(raw.nextRunAt),
    client: client(raw.client),
    configuredClient: str(raw.configuredClient),
    clientChoice: choice && choiceSource ? { source: choiceSource, why: str(choice.why) ?? "" } : null,
    awaitingApproval: awaiting,
    otherClients: (Array.isArray(raw.otherClients) ? raw.otherClients : []).flatMap((c) => {
      const base = client(c);
      if (!base || !isObject(c)) return [];
      return [{ ...base, checked: c.checked === true, ...(str(c.error) ? { error: c.error as string } : {}) }];
    }),
    unknownValidatorPackages: strings(raw.unknownValidatorPackages),
    keys: { total, inSync, imported: count(keys.imported), summary: str(keys.summary) ?? `${inSync}/${total}` },
    feeRecipients: { total: count(fee.total), ok: count(fee.ok), fixed: count(fee.fixed), failed: count(fee.failed) },
    validators: (Array.isArray(raw.validators) ? raw.validators : []).map(key).filter((k): k is ReconcileKey => k !== null),
    errors: strings(raw.errors),
  };
}

/** The parsed status of a reconcile answer, if it has one. */
export const reconcileStatusOf = (view: ReconcileView | null | undefined): ReconcileStatus | undefined =>
  view?.available ? parseReconcileStatus(view.status) : undefined;
