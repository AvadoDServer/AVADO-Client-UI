import { useApi } from "../../api/ApiProvider";
import { usePoll } from "../../hooks/usePoll";

export const ROCKET_POOL_PACKAGE = "rocketpool.avado.dnp.dappnode.eth";

/** Installed packages change rarely; a failed read says "not installed". */
const PACKAGES_POLL_MS = 60_000;

/**
 * Whether Rocket Pool is installed on this box. Rocket Pool adds its minipool
 * keys to the consensus client by itself, so removing, exiting or changing the
 * fee recipient of those keys belongs in the Rocket Pool app.
 */
export function useRocketPoolInstalled(): boolean {
  const api = useApi();
  const { data } = usePoll(async () => {
    const packages = await api.dappmanager.listPackageStates();
    return packages.some((p) => p.name === ROCKET_POOL_PACKAGE);
  }, PACKAGES_POLL_MS);
  return data === true;
}

/** One caution line for a validator dialog when Rocket Pool is installed. */
export function RocketPoolCaution({ children }: { children: string }) {
  return (
    <p role="note" className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning-text">
      {children}
    </p>
  );
}

export const ROCKET_POOL_TEXT = {
  page: (client: string) =>
    `Rocket Pool is installed. If it uses ${client}, it adds its minipool validators here by itself. Manage those in the Rocket Pool app: don't remove them, exit them or change their fee recipient here.`,
  remove: "If this is a Rocket Pool minipool validator, Rocket Pool adds it back. Manage it in the Rocket Pool app instead.",
  exit: "If this is a Rocket Pool minipool validator, exit it from the Rocket Pool app instead.",
  fee: "If this is a Rocket Pool minipool validator, leave its fee recipient to Rocket Pool. Another address can cost you a penalty.",
} as const;
