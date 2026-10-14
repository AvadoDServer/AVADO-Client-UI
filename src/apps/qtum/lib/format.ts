/** Numbers and times in plain words, en-US like the rest of the AVADO UI. */

const fmt = (n: number, max: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: max });

/** "1,234.5678 QTUM": up to 4 decimals, all 8 for amounts below 0.0001. */
export function formatQtum(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  return `${fmt(n, abs > 0 && abs < 0.0001 ? 8 : 4)} QTUM`;
}

/** "1,234" */
export const formatCount = (n: number) => n.toLocaleString("en-US");

const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Seconds as "about 3 days", "about 5 hours", "about 20 minutes", "less than a minute". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "less than a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${unit(minutes, "minute")}`;
  const hours = Math.round(seconds / 3600);
  if (hours < 48) return `about ${unit(hours, "hour")}`;
  const days = Math.round(seconds / 86400);
  if (days < 60) return `about ${unit(days, "day")}`;
  return `about ${unit(Math.round(days / 30), "month")}`;
}

/** An ISO time as "5 minutes ago", "3 hours ago", "4 days ago", or the date. */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${unit(Math.floor(s / 60), "minute")} ago`;
  if (s < 86400) return `${unit(Math.floor(s / 3600), "hour")} ago`;
  if (s < 30 * 86400) return `${unit(Math.floor(s / 86400), "day")} ago`;
  return new Date(at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
