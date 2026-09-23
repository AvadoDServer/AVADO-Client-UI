import { Card, CardDescription, CardTitle, StatusPill, type StatusTone } from "../../../components/ui";
import { POLL_MS, usePoll } from "../../../hooks/usePoll";
import { isMock, useRocketpoolApi } from "../api/RocketpoolApiProvider";

function backendStatus(reachable: boolean | undefined): { tone: StatusTone; label: string } {
  if (reachable === undefined) return { tone: "neutral", label: "Checking" };
  return reachable ? { tone: "success", label: "Connected" } : { tone: "danger", label: "Not reachable" };
}

/** Placeholder home page until the real screens land. */
export default function HomePage() {
  const api = useRocketpoolApi();
  const backend = usePoll(() => api.ping(), POLL_MS.nodeStatus);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-fg">Rocket Pool</h1>
      <Card className="flex flex-col gap-3">
        <CardTitle>Coming soon</CardTitle>
        <CardDescription>The new Rocket Pool app is being built. Your node keeps running meanwhile.</CardDescription>
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg" data-testid="backend-status">
          <span>Backend</span>
          <StatusPill status={backendStatus(backend.data)} />
          {isMock() && <StatusPill status={{ tone: "accent", label: "Demo data" }} />}
        </div>
      </Card>
    </div>
  );
}
