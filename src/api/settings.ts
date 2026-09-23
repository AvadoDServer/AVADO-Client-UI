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
 *   const initial = { ...defaults, ...await backend.getSettings() }; // defaults shown, not written
 *   ...user edits `form`...
 *   await saveSettingsMerged(backend, changedFields(initial, form));
 */
import type { PackageBackend, Settings } from "./types";

/**
 * GET the file as it is now, apply only the fields in `patch` (undefined
 * values are skipped, never deleted), then POST the whole object back. Every
 * field this UI doesn't know survives. If the GET fails nothing is written.
 * Returns the object that was saved.
 */
export async function saveSettingsMerged(backend: PackageBackend, patch: Partial<Settings>): Promise<Settings> {
  const current = await backend.getSettings();
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
