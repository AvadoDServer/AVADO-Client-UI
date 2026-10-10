/**
 * Reading the key/fee-recipient loop's status safely (backend status file
 * version 2; version 1 files are read too). The file is written by another
 * process and may be from an older or newer backend: every field is checked,
 * anything missing or of the wrong type gets a safe default, and a file that
 * isn't a status at all gives undefined.
 *
 * Nothing that could mean danger is dropped: a key with a state this UI
 * doesn't know is kept as `unknown` (counted as "not running"), and a key
 * loaded in more than one client is always reported as loaded twice.
 */
import {
  RECONCILE_STATUS_VERSION,
  type ReconcileClient,
  type ReconcileClientReport,
  type ReconcileFeeState,
  type ReconcileKey,
  type ReconcileKeyState,
  type ReconcileState,
  type ReconcileStatus,
  type ReconcileView,
} from "./models";

const STATES: readonly ReconcileState[] = ["ok", "waiting", "attention", "error"];
const KEY_STATES: readonly ReconcileKeyState[] = [
  "loaded",
  "imported",
  "loaded-twice",
  "elsewhere",
  "awaiting-approval",
  "settling",
  "import-blocked",
  "client-update-needed",
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
/** v2 lists; v1 wrote a single string. */
const stringOrList = (v: unknown): string[] => (typeof v === "string" ? strings([v]) : strings(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

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

function clientReport(v: unknown, chosenPackage: string | null): ReconcileClientReport | null {
  const base = client(v);
  if (!base || !isObject(v)) return null;
  const fee = isObject(v.feeRecipients) ? v.feeRecipients : {};
  return {
    ...base,
    version: str(v.version),
    chosen: typeof v.chosen === "boolean" ? v.chosen : base.package === chosenPackage,
    checked: v.checked === true,
    ...(str(v.error) ? { error: v.error as string } : {}),
    rocketPoolKeys: count(v.rocketPoolKeys),
    feeRecipients: { ok: count(fee.ok), fixed: count(fee.fixed), failed: count(fee.failed) },
  };
}

function key(v: unknown): ReconcileKey | null {
  if (!isObject(v)) return null;
  const pubkey = normalizePubkey(v.pubkey);
  if (!pubkey) return null;
  const rawState = str(v.state) ?? "";
  const loadedIn = [...new Set(stringOrList(v.loadedIn))];
  let state: ReconcileKeyState = oneOf(rawState, KEY_STATES) ?? "unknown";
  // Loaded in two clients is slashing danger whatever the state field says.
  if (loadedIn.length > 1) state = "loaded-twice";
  const fee = isObject(v.feeRecipient) ? v.feeRecipient : {};
  const out: ReconcileKey = {
    pubkey,
    kind: v.kind === "megapool" ? "megapool" : "minipool",
    ref: typeof v.ref === "string" || typeof v.ref === "number" ? String(v.ref) : "",
    state,
    rawState,
    loadedIn,
    feeRecipient: {
      rule: str(fee.rule) ?? "",
      expected: str(fee.expected),
      state: oneOf(fee.state, FEE_STATES) ?? "not-loaded",
      clients: arr(fee.clients).flatMap((c) => {
        if (!isObject(c) || !str(c.package)) return [];
        return [
          {
            package: c.package as string,
            ...(c.found !== undefined ? { found: str(c.found) } : {}),
            state: oneOf(c.state, FEE_STATES) ?? "failed",
            ...(str(c.error) ? { error: c.error as string } : {}),
          },
        ];
      }),
    },
  };
  if (str(v.settlesAt)) out.settlesAt = v.settlesAt as string;
  if (str(v.error)) out.error = v.error as string;
  return out;
}

/** The status from `GET /api/avado/reconcile`, normalised; undefined when there is none or it isn't one. */
export function parseReconcileStatus(raw: unknown): ReconcileStatus | undefined {
  if (!isObject(raw)) return undefined;
  const version = count(raw.version);
  const known = oneOf(raw.state, STATES);
  // A newer backend may add states; read an unknown one as "attention" rather than dropping the file.
  const state: ReconcileState | null = known ?? (version > RECONCILE_STATUS_VERSION && str(raw.state) ? "attention" : null);
  if (!state) return undefined;
  const keys = isObject(raw.keys) ? raw.keys : {};
  const fee = isObject(raw.feeRecipients) ? raw.feeRecipients : {};
  const choice = isObject(raw.clientChoice) ? raw.clientChoice : null;
  const choiceSource = choice ? oneOf(choice.source, CHOICE_SOURCES) : null;
  const total = count(keys.total);
  const inSync = Math.min(count(keys.inSync), total);
  const awaiting = [...new Set(arr(raw.awaitingApproval).map(normalizePubkey))].filter((k): k is string => k !== null);
  const chosen = client(raw.client);
  const validators = arr(raw.validators)
    .map(key)
    .filter((k): k is ReconcileKey => k !== null);

  // Loaded twice: the backend's list, plus any key it reports in more than one client.
  const twice = new Map<string, string[]>();
  for (const t of arr(raw.loadedTwice)) {
    if (!isObject(t)) continue;
    const pk = normalizePubkey(t.pubkey);
    if (pk) twice.set(pk, [...new Set(stringOrList(t.packages))]);
  }
  for (const v of validators) {
    if (v.state === "loaded-twice" && !twice.has(v.pubkey)) twice.set(v.pubkey, v.loadedIn);
  }

  // v2 `clients[]`; a v1 file had `otherClients` (without the chosen one).
  const clientList = Array.isArray(raw.clients) ? raw.clients : arr(raw.otherClients);

  return {
    version,
    newerThanUi: version > RECONCILE_STATUS_VERSION,
    state,
    message: str(raw.message) ?? "",
    startedAt: str(raw.startedAt),
    finishedAt: str(raw.finishedAt),
    trigger: oneOf(raw.trigger, TRIGGERS),
    nextRunAt: str(raw.nextRunAt),
    client: chosen,
    configuredClient: str(raw.configuredClient),
    clientChoice: choice && choiceSource ? { source: choiceSource, why: str(choice.why) ?? "" } : null,
    awaitingApproval: awaiting,
    importBlockedReasons: strings(raw.importBlockedReasons),
    loadedTwice: [...twice].map(([pubkey, packages]) => ({ pubkey, packages })),
    clients: clientList.map((c) => clientReport(c, chosen?.package ?? null)).filter((c): c is ReconcileClientReport => c !== null),
    unknownValidatorPackages: strings(raw.unknownValidatorPackages),
    keys: { total, inSync, imported: count(keys.imported), summary: str(keys.summary) ?? `${inSync}/${total}` },
    feeRecipients: { total: count(fee.total), ok: count(fee.ok), fixed: count(fee.fixed), failed: count(fee.failed) },
    validators,
    errors: strings(raw.errors),
  };
}

/** The parsed status of a reconcile answer, if it has one. */
export const reconcileStatusOf = (view: ReconcileView | null | undefined): ReconcileStatus | undefined =>
  view?.available ? parseReconcileStatus(view.status) : undefined;
