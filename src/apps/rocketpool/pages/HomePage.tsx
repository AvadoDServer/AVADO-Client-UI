import { Card, CardDescription, CardTitle, StatusPill } from "../../../components/ui";
import { isMock } from "../api/RocketpoolApiProvider";
import { useAppStatus } from "../status/AppStatus";
import { serviceStatus } from "../status/daemon";

/** Home: the service status for now; balances, validators and rewards follow. */
export default function HomePage() {
  const status = useAppStatus();
  const version = status.avado?.packageVersion;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-fg">Home</h1>
      <Card className="flex flex-col gap-3">
        <CardTitle>Rocket Pool service</CardTitle>
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg" data-testid="service-status">
          <StatusPill status={serviceStatus(status)} />
          {isMock() && <StatusPill status={{ tone: "accent", label: "Demo data" }} />}
        </div>
        {version && <CardDescription>Package version {version}</CardDescription>}
      </Card>
    </div>
  );
}
