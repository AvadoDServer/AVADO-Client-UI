import type { DappManager } from "../../api/types";

/** An installed package (running or stopped). */
export interface PackageState {
  name: string;
  running: boolean;
}

type WithStates = DappManager & { listPackageStates?: () => Promise<PackageState[]> };

/**
 * Installed packages with their running state. Uses
 * `dappmanager.listPackageStates()` when the adapter has it (Task 2);
 * otherwise falls back to `listPackages()` names, counted as running.
 * Errors propagate: a failed read is "unknown", never "not installed".
 */
export async function readPackageStates(dm: DappManager): Promise<PackageState[]> {
  const withStates = dm as WithStates;
  if (typeof withStates.listPackageStates === "function") {
    const states = await withStates.listPackageStates();
    return states.map((s) => ({ name: s.name, running: Boolean(s.running) }));
  }
  const names = await dm.listPackages();
  return names.map((name) => ({ name, running: true }));
}
