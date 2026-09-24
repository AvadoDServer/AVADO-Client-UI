/**
 * Times and durations for people. Smartnode sends durations as Go
 * `time.Duration` (nanoseconds) and times as RFC 3339; the zero time
 * ("0001-01-01T00:00:00Z") means "never".
 */
import { toBigInt, type BigNumberish } from "./units";

const NS_PER_MS = 1_000_000n;

/** Nanoseconds → milliseconds, or null when it isn't a whole non-negative number. */
export function nsToMs(ns: BigNumberish | null | undefined): number | null {
  const v = toBigInt(ns);
  if (v === null || v < 0n) return null;
  return Number(v / NS_PER_MS);
}

/** The time in ms, or null for a missing, invalid or zero ("never") time. */
export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= Date.parse("1970-01-02T00:00:00Z")) return null;
  return t;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "28 days", "3 days 4 hours", "5 hours 10 minutes", "less than a minute". Rounds down. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE) return "less than a minute";
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return hours > 0 ? `${plural(days, "day")} ${plural(hours, "hour")}` : plural(days, "day");
  if (hours > 0) return minutes > 0 ? `${plural(hours, "hour")} ${plural(minutes, "minute")}` : plural(hours, "hour");
  return plural(minutes, "minute");
}

/** "23 Sep 2026, 10:00" in the viewer's time zone (or the given one). */
export function formatDateTime(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

/** "23 Sep 2026". */
export function formatDate(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(timeZone ? { timeZone } : {}) });
}
