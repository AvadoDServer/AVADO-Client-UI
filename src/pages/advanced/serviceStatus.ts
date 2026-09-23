/**
 * Pure helpers for presenting `ProcessInfo` (supervisord's `getAllProcessInfo`,
 * as `/service/status` returns it — see `src/api/types.ts`) in plain language.
 */
import type { ProcessInfo } from "../../api/types";
import type { StatusTone } from "../../components/ui";

const STATUS_PRESENTATION: Record<string, { tone: StatusTone; label: string }> = {
  RUNNING: { tone: "success", label: "Running" },
  STARTING: { tone: "accent", label: "Starting" },
  STOPPING: { tone: "accent", label: "Stopping" },
  BACKOFF: { tone: "warning", label: "Restarting" },
  STOPPED: { tone: "neutral", label: "Stopped" },
  EXITED: { tone: "warning", label: "Exited" },
  FATAL: { tone: "danger", label: "Failed" },
  UNKNOWN: { tone: "neutral", label: "Unknown" },
};

/** Plain-language status + StatusPill tone for a supervisord statename. */
export function processStatus(statename: string | undefined): { tone: StatusTone; label: string } {
  const key = (statename ?? "").trim().toUpperCase();
  return STATUS_PRESENTATION[key] ?? { tone: "neutral", label: statename?.trim() || "Unknown" };
}

/** "3d 4h", "5h 12m", "9m 2s" or "12s" — always at least seconds. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** A short "pid …, up …" line for a process row; falls back to its own description. */
export function processDetail(p: ProcessInfo): string {
  const parts: string[] = [];
  if (p.pid) parts.push(`pid ${p.pid}`);
  if (typeof p.start === "number" && typeof p.now === "number" && p.now > p.start) {
    parts.push(`up ${formatDuration(p.now - p.start)}`);
  }
  if (parts.length) return parts.join(", ");
  return p.description?.trim() || "—";
}
