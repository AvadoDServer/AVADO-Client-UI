/**
 * Settings writes (spec §2.5). The backend overwrites settings.json with
 * whatever it is sent and restarts the client, so a partial POST would erase
 * fields. Always save through `saveSettingsMerged`.
 *
 * A `timeout` on the save does not mean nothing was written: the backend
 * writes the file first and then restarts the client, which can outlast the
 * time limit. Tell the user it was saved and the client is restarting, and
 * re-GET the settings afterwards (the start script may also rewrite
 * `execution_engine`/`ee_endpoint`) rather than trusting the returned object.
 *
 * Page pattern:
 *   const loaded = await backend.getSettings();              // keep this exact object
 *   const initial = { ...defaults, ...loaded };              // defaults shown, not written
 *   ...user edits `form`...
 *   await saveSettingsMerged(backend, changedFields(initial, form), loaded);
 *
 * Guard (final review I1): the deno backend answers `GET /settings` with
 * `defaultsettings()` whenever reading or parsing settings.json fails (a
 * half-written file during another save, a corrupt file). Merging a patch
 * into that and POSTing it would silently reset the fee recipient,
 * MEV-Boost and the execution client. So the caller passes the settings it
 * loaded (`expected`); if the fresh re-read differs from it in any field the
 * patch doesn't set, or if the re-read is exactly `/defaultsettings` while
 * `expected` was not, nothing is written and a `SettingsChangedError` is
 * thrown. The page then asks the owner to reload.
 */
import type { PackageBackend, Settings } from "./types";

export const SETTINGS_CHANGED_MESSAGE = "Your settings changed or couldn't be read — reload and try again";

/** The settings on the box are not the ones the page loaded (changed elsewhere, or the backend fell back to defaults). Nothing was written. */
export class SettingsChangedError extends Error {
  /** The fields whose value on the box differs from what the page loaded. Empty when the re-read was the defaults. */
  readonly fields: string[];
  readonly reason: "changed" | "defaults";

  constructor(reason: "changed" | "defaults", fields: string[] = []) {
    super(SETTINGS_CHANGED_MESSAGE);
    this.name = "SettingsChangedError";
    this.reason = reason;
    this.fields = fields;
  }
}

export const isSettingsChangedError = (e: unknown): e is SettingsChangedError => e instanceof SettingsChangedError;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural equality for JSON values; object key order doesn't matter. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * GET the file as it is now, check it is still what the page loaded
 * (`expected`, see the guard above), apply only the fields in `patch`
 * (undefined values are skipped, never deleted), then POST the whole object
 * back. Every field this UI doesn't know survives. If the GET fails, or the
 * guard trips, nothing is written. Returns the object that was saved.
 */
export async function saveSettingsMerged(
  backend: PackageBackend,
  patch: Partial<Settings>,
  expected: Settings,
): Promise<Settings> {
  const current = await backend.getSettings();

  const patched = new Set(Object.keys(patch).filter((k) => patch[k] !== undefined));
  const changed = [...new Set([...Object.keys(current), ...Object.keys(expected)])].filter(
    (k) => !patched.has(k) && !deepEqual(current[k], expected[k]),
  );
  if (changed.length > 0) throw new SettingsChangedError("changed", changed);

  // The fallback can only be recognised by comparing with the defaults. If
  // they can't be read, the per-field check above still stands on its own.
  let defaults: Settings | null = null;
  try {
    defaults = await backend.getDefaultSettings();
  } catch {
    defaults = null;
  }
  if (defaults && deepEqual(current, defaults) && !deepEqual(expected, defaults)) {
    throw new SettingsChangedError("defaults");
  }

  const merged: Settings = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  await backend.saveSettings(merged);
  return merged;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The fields of `after` whose value differs from `before`: what the user actually edited. */
export function changedFields(before: Settings, after: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && !same(before[key], value)) out[key] = value;
  }
  return out;
}
