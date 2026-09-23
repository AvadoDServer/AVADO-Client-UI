import type { PackageBackend, Settings } from "../../api/types";

/**
 * Read-modify-write settings save (spec §2.5): GET the current
 * `settings.json` right before saving, overlay only the fields in `patch`,
 * and POST the whole merged object — because the backend always overwrites
 * the file (nimbus.md §2.2: `write_settings()` does a full overwrite, no
 * server-side merge).
 *
 * GETting fresh (instead of reusing whatever was loaded when the page
 * opened) matters because the box can rewrite `settings.json` on its own —
 * `startNimbus.sh`'s execution-engine auto-detect rewrites `execution_engine`
 * and `ee_endpoint` in place on every boot (nimbus.md §1.4). Fetching right
 * before the merge keeps that field, and every other field this UI doesn't
 * model, intact.
 *
 * Task 2 provides the real adapter-backed version of this exact name and
 * signature in `src/api/settings.ts`; this local copy is what `SettingsPage`
 * is written against until that lands, so the swap is a one-line import
 * change.
 */
export async function saveSettingsMerged(backend: PackageBackend, patch: Settings): Promise<void> {
  const current = await backend.getSettings();
  const merged: Settings = { ...current, ...patch };
  await backend.saveSettings(merged);
}
