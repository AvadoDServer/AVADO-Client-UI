import { useId } from "react";
import { Badge } from "../../components/ui";
import type { ExecutionClientCandidate } from "../../config/executionClients";

export interface ExecutionClientFieldProps {
  candidates: ExecutionClientCandidate[];
  value: string;
  /** `null` while DAPPMANAGER's package list hasn't loaded (or failed to). */
  installedPackages: string[] | null;
  onChange: (packageName: string) => void;
}

/** Radio picker for the execution-client candidates, each marked installed or not. */
export function ExecutionClientField({ candidates, value, installedPackages, onChange }: ExecutionClientFieldProps) {
  const name = useId();
  const checking = installedPackages === null;
  const isInstalled = (packageName: string) => (installedPackages ?? []).includes(packageName);
  const selectedKnown = value !== "" && candidates.some((c) => c.packageName === value);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-fg-muted">Execution client</legend>

      {candidates.length === 0 ? (
        <p className="text-sm text-fg-muted">No execution clients are known for this network yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {candidates.map((c) => {
            const installed = isInstalled(c.packageName);
            const inputId = `${name}-${c.packageName}`;
            return (
              <div
                key={c.packageName}
                className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-3.5 py-2.5 text-sm"
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    id={inputId}
                    name={name}
                    value={c.packageName}
                    checked={value === c.packageName}
                    disabled={!installed}
                    onChange={() => onChange(c.packageName)}
                    className="h-4 w-4 accent-accent disabled:cursor-not-allowed"
                  />
                  {/* A dedicated label (not a wrapping one) keeps the accessible name to just the client name, not the badge text beside it. */}
                  <label htmlFor={inputId} className="cursor-pointer text-fg">
                    {c.name}
                  </label>
                </span>
                <Badge variant={installed ? "success" : "neutral"}>
                  {checking ? "Checking…" : installed ? "Installed" : "Not installed"}
                </Badge>
              </div>
            );
          })}
        </div>
      )}

      {value !== "" && !selectedKnown && (
        <p className="text-xs text-fg-muted">
          Currently set to {value}, which is not one of the known execution clients for this network.
        </p>
      )}
      {selectedKnown && !checking && !isInstalled(value) && (
        <p className="text-xs text-danger-text">The selected execution client is not installed. Install it, or pick one that is.</p>
      )}
    </fieldset>
  );
}

export default ExecutionClientField;
