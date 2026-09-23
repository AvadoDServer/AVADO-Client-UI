import type { StatusTone } from "../../../components/ui";
import type { AppStatus } from "./AppStatus";

const STOPPED = new Set(["FATAL", "BACKOFF", "EXITED", "STOPPED", "STOPPING"]);

/** The Rocket Pool service's state in one word, for a status pill. */
export function serviceStatus(s: Pick<AppStatus, "avado" | "avadoFailed" | "loading" | "daemonReady">): { tone: StatusTone; label: string } {
  if (s.avadoFailed) return { tone: "danger", label: "Not reachable" };
  if (!s.avado) return { tone: "neutral", label: "Checking" };
  if (s.avado.startupError || STOPPED.has(String(s.avado.daemon.state).toUpperCase())) return { tone: "danger", label: "Stopped" };
  if (s.daemonReady) return { tone: "success", label: "Running" };
  return { tone: "accent", label: "Starting" };
}
