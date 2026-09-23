/**
 * Fired on `window` after a settings save, so the shell re-reads the settings
 * and the problem banners (e.g. the fee-recipient one) update at once.
 */
export const SETTINGS_SAVED_EVENT = "avado:settings-saved";

/** Tell the shell the settings changed. */
export function notifySettingsSaved(): void {
  window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
}
