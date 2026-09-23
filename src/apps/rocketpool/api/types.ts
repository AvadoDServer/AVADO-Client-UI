/**
 * The Rocket Pool app's adapters. A placeholder for now: the full client for
 * the package backend (`/api/sn/*`, `/api/avado/*`) replaces it.
 */
export interface RocketpoolApi {
  /** Whether the package backend answers. Never throws. */
  ping(): Promise<boolean>;
}
