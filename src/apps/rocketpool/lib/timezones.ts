/**
 * Time zones for registering the node. Rocket Pool stores the node's zone on
 * chain (it is public) to draw its node map; it has no other use.
 */

/** "Europe/Ljubljana", "America/Argentina/Buenos_Aires", "Etc/UTC". */
const ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/;

export const isTimezone = (v: string): boolean => ZONE.test(v);

/** Used when the browser can't list its zones. */
const FALLBACK_ZONES = [
  "Africa/Johannesburg",
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Etc/UTC",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Ljubljana",
  "Europe/London",
  "Europe/Paris",
  "Europe/Zurich",
];

/** Every zone the browser knows, sorted, plus Etc/UTC. */
export function timezoneOptions(): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const valid = zones.filter(isTimezone);
  const list = valid.length > 0 ? valid : FALLBACK_ZONES;
  return [...new Set([...list, "Etc/UTC"])].sort();
}

/** The browser's own zone when it is a proper "Region/City" name, else Etc/UTC. */
export function defaultTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isTimezone(zone)) return zone;
  } catch {
    /* no Intl zone */
  }
  return "Etc/UTC";
}
